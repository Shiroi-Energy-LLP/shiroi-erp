// scripts/whatsapp-import/router.ts
// Routes extracted records to the whatsapp_import_queue table.
// High-confidence non-financial records are also auto-inserted into their target tables.

import { supabase, getAllEmployees } from './db.js';
import type { ClusterExtractionResult, ExtractedRecord, ExtractionType } from './types.js';
import type { MessageCluster } from './types.js';
import { hashMessage } from './dedup.js';

const AUTO_INSERT_THRESHOLD = 0.85;
const AUTO_INSERT_PROJECT_THRESHOLD = 0.75;

// Sender name → employee id mapping
const SENDER_MAP: Record<string, string> = {};

async function resolveEmployeeIds(): Promise<void> {
  const employees = await getAllEmployees();
  for (const emp of employees) {
    // Direct name match
    SENDER_MAP[emp.name] = emp.id;
    // Also map first name only for fuzzy sender matching
    const firstName = emp.name.split(' ')[0];
    if (firstName) SENDER_MAP[firstName.toLowerCase()] = emp.id;
  }
}

function getEmployeeId(senderName: string): string | null {
  // Try exact match first
  if (SENDER_MAP[senderName]) return SENDER_MAP[senderName] ?? null;
  // Try first-word match
  const firstWord = senderName.split(' ')[0]?.toLowerCase();
  if (firstWord && SENDER_MAP[firstWord]) return SENDER_MAP[firstWord] ?? null;
  // Try substring match
  for (const [key, id] of Object.entries(SENDER_MAP)) {
    if (
      senderName.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(senderName.toLowerCase().split(' ')[0]?.toLowerCase() ?? '')
    ) {
      return id;
    }
  }
  return null;
}

async function insertQueueRecord(
  cluster: MessageCluster,
  record: ExtractedRecord,
  messageHash: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .insert({
      chat_profile: cluster.profile,
      message_hash: messageHash,
      message_timestamp: cluster.startTime.toISOString(),
      sender_name: cluster.sender,
      raw_message_text: cluster.combinedText.slice(0, 2000),
      media_filenames: cluster.mediaFiles.length > 0 ? cluster.mediaFiles : null,
      extraction_type: record.extraction_type,
      extracted_data: record.data,
      confidence_score: record.confidence,
      matched_project_id: record.project_match.project_id,
      matched_lead_id: record.project_match.lead_id,
      matched_project_name: record.project_match.matched_name,
      review_status: 'pending',
      requires_finance_review: record.requires_finance_review,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return null; // duplicate hash — skip silently
    console.error('[insertQueueRecord] Error:', { code: error.code, message: error.message });
    return null;
  }
  return data?.id ?? null;
}

async function autoInsertActivity(
  record: ExtractedRecord,
  cluster: MessageCluster,
  queueId: string
): Promise<void> {
  const d = record.data;
  const empId = getEmployeeId(cluster.sender);

  const { data: actData, error: actError } = await supabase
    .from('activities')
    .insert({
      activity_type: (d['activity_type'] as string) ?? 'note',
      title: (d['title'] as string) ?? null,
      body: (d['body'] as string) ?? cluster.combinedText.slice(0, 1000),
      occurred_at: (d['occurred_at'] as string) ?? cluster.startTime.toISOString(),
      owner_id: empId ?? null,
      metadata: { whatsapp_import: true, chat_profile: cluster.profile },
    })
    .select('id')
    .single();

  if (actError || !actData) {
    console.warn('[autoInsertActivity]', actError?.message);
    return;
  }

  const assocInserts: Array<{ activity_id: string; entity_type: string; entity_id: string }> = [];
  if (record.project_match.project_id) {
    assocInserts.push({
      activity_id: actData.id,
      entity_type: 'project',
      entity_id: record.project_match.project_id,
    });
  }
  if (record.project_match.lead_id) {
    assocInserts.push({
      activity_id: actData.id,
      entity_type: 'lead',
      entity_id: record.project_match.lead_id,
    });
  }
  if (assocInserts.length > 0) {
    await supabase.from('activity_associations').insert(assocInserts);
  }

  await supabase
    .from('whatsapp_import_queue')
    .update({ review_status: 'auto_inserted', inserted_table: 'activities', inserted_id: actData.id })
    .eq('id', queueId);
}

async function autoInsertTask(
  record: ExtractedRecord,
  cluster: MessageCluster,
  queueId: string
): Promise<void> {
  const d = record.data;
  if (!d['title']) return;
  const empId = getEmployeeId(cluster.sender);
  const entityType = (d['entity_type'] as string) ?? 'project';
  const entityId = record.project_match.project_id ?? record.project_match.lead_id;

  const { data: taskData, error } = await supabase
    .from('tasks')
    .insert({
      entity_type: entityType,
      entity_id: entityId ?? null,
      project_id: record.project_match.project_id ?? null,
      title: d['title'] as string,
      description: (d['notes'] as string) ?? null,
      created_by: empId ?? null,
      assigned_to: empId ?? null,
      priority: 'medium',
      due_date: (d['due_date'] as string) ?? null,
    })
    .select('id')
    .single();

  if (error || !taskData) {
    console.warn('[autoInsertTask]', error?.message);
    return;
  }

  await supabase
    .from('whatsapp_import_queue')
    .update({ review_status: 'auto_inserted', inserted_table: 'tasks', inserted_id: taskData.id })
    .eq('id', queueId);
}

export async function routeResults(
  results: ClusterExtractionResult[],
  clusters: MessageCluster[]
): Promise<void> {
  const op = '[routeResults]';
  await resolveEmployeeIds();

  let queued = 0;
  let autoInserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    // Use corresponding cluster; fall back to last cluster for batch-attributed records
    const cluster = clusters[i] ?? clusters[clusters.length - 1]!;

    for (const record of result.records) {
      if (record.extraction_type === 'unknown') { skipped++; continue; }

      // Generate dedup hash: message hash + extraction type + a position index
      const baseHash = cluster.messages[0]
        ? hashMessage(cluster.messages[0])
        : result.cluster_id;
      const recordHash = `${baseHash}_${record.extraction_type}_${result.records.indexOf(record)}`;

      const queueId = await insertQueueRecord(cluster, record, recordHash);
      if (!queueId) { duplicates++; continue; }

      // Auto-insert if high confidence, not financial, and good project match
      const canAutoInsert =
        record.confidence >= AUTO_INSERT_THRESHOLD &&
        !record.requires_finance_review &&
        (record.project_match.confidence >= AUTO_INSERT_PROJECT_THRESHOLD ||
         record.project_match.project_id !== null);

      if (canAutoInsert) {
        switch (record.extraction_type) {
          case 'activity':
            await autoInsertActivity(record, cluster, queueId);
            autoInserted++;
            break;
          case 'task':
            await autoInsertTask(record, cluster, queueId);
            autoInserted++;
            break;
          default:
            queued++;
        }
      } else {
        queued++;
      }
    }
  }

  console.log(`${op} Results: queued=${queued}, auto_inserted=${autoInserted}, skipped=${skipped}, duplicates=${duplicates}`);
}
