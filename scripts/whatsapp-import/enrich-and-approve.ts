// scripts/whatsapp-import/enrich-and-approve.ts
// Enriches existing WhatsApp queue records with better parsing + fuzzy matching,
// then bulk-inserts into target tables and marks as approved.
// Usage: npx tsx enrich-and-approve.ts [--dry-run]
//
// Requires: SUPABASE_URL, SUPABASE_SECRET_KEY in env (or .env file)

import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local — try worktree root first, then main repo root
const envPaths = [
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  'C:/Users/vivek/Projects/shiroi-erp/.env.local',
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const SUPABASE_KEY = process.env['SUPABASE_SECRET_KEY'] ?? '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATION_EMPLOYEE_ID = '589b7878-46eb-4d6c-ba24-079d167d0e89';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueRow {
  id: string;
  chat_profile: string;
  extraction_type: string;
  raw_message_text: string;
  sender_name: string;
  message_timestamp: string;
  media_filenames: string[] | null;
  extracted_data: Record<string, unknown>;
  confidence_score: number;
  matched_project_id: string | null;
  matched_lead_id: string | null;
  matched_project_name: string | null;
  review_status: string;
}

interface ProjectRef {
  id: string;
  customer_name: string;
  system_size_kwp: number | null;
  site_city: string | null;
  lead_id: string | null;
}

interface LeadRef {
  id: string;
  customer_name: string;
  estimated_size_kwp: number | null;
  city: string | null;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const stats = {
  total: 0,
  enriched: 0,
  inserted: { activities: 0, daily_site_reports: 0, contacts: 0, project_boq_items: 0, customer_payments: 0, tasks: 0 },
  skipped: { no_project: 0, duplicate: 0, insufficient_data: 0 },
  approved: 0,
  errors: 0,
};

// ---------------------------------------------------------------------------
// Load reference data
// ---------------------------------------------------------------------------

let projects: ProjectRef[] = [];
let leads: LeadRef[] = [];
let existingPhones: Set<string> = new Set();

async function loadReferenceData() {
  console.log('[loadReferenceData] Loading projects...');
  const { data: projData } = await supabase
    .from('projects')
    .select('id, customer_name, system_size_kwp, site_city, lead_id');
  projects = (projData ?? []) as ProjectRef[];
  console.log(`  ${projects.length} projects loaded`);

  console.log('[loadReferenceData] Loading leads...');
  const { data: leadData } = await supabase
    .from('leads')
    .select('id, customer_name, estimated_size_kwp, city')
    .is('deleted_at', null);
  leads = (leadData ?? []) as LeadRef[];
  console.log(`  ${leads.length} leads loaded`);

  console.log('[loadReferenceData] Loading existing contact phones...');
  const { data: contacts } = await supabase
    .from('contacts')
    .select('phone');
  for (const c of (contacts ?? [])) {
    const p = (c as { phone: string | null }).phone;
    if (p) existingPhones.add(normalizePhone(p));
  }
  console.log(`  ${existingPhones.size} existing phones loaded`);
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(p: string): string {
  return p.replace(/[\s\-+()]/g, '').slice(-10);
}

function fuzzyScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Word overlap
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const common = wordsA.filter(w => w.length > 2 && wordsB.some(wb => wb.includes(w) || w.includes(wb)));
  if (common.length === 0) return 0;
  return common.length / Math.max(wordsA.length, wordsB.length);
}

function findBestProject(text: string): { project: ProjectRef | null; lead: LeadRef | null; score: number } {
  if (!text) return { project: null, lead: null, score: 0 };
  const normalized = normalize(text);

  let bestProject: ProjectRef | null = null;
  let bestScore = 0;

  for (const p of projects) {
    if (!p.customer_name) continue;
    const score = fuzzyScore(text, p.customer_name);
    if (score > bestScore) {
      bestScore = score;
      bestProject = p;
    }
  }

  let bestLead: LeadRef | null = null;
  let bestLeadScore = 0;

  for (const l of leads) {
    if (!l.customer_name) continue;
    const score = fuzzyScore(text, l.customer_name);
    if (score > bestLeadScore) {
      bestLeadScore = score;
      bestLead = l;
    }
  }

  // Also check against city names in the message text
  if (bestScore < 0.5) {
    for (const p of projects) {
      if (p.site_city && normalized.includes(normalize(p.site_city)) && normalize(p.site_city).length > 3) {
        const cityScore = 0.4;
        if (cityScore > bestScore) {
          bestScore = cityScore;
          bestProject = p;
        }
      }
    }
  }

  if (bestLeadScore > bestScore) {
    // Find the project for this lead
    const matchedProject = projects.find(p => p.lead_id === bestLead!.id) ?? null;
    return { project: matchedProject, lead: bestLead, score: bestLeadScore };
  }

  // Find the lead for the matched project
  const matchedLead = bestProject?.lead_id ? leads.find(l => l.id === bestProject!.lead_id) ?? null : null;
  return { project: bestProject, lead: matchedLead ?? bestLead, score: bestScore };
}

// ---------------------------------------------------------------------------
// Amount parsing — Indian formats
// ---------------------------------------------------------------------------

function parseIndianAmount(text: string): number | null {
  if (!text) return null;

  // Direct number with optional commas: 3,87,000 or 387000 or 1,71,537
  const directMatch = text.match(/(?:rs\.?\s*|₹\s*)?(\d{1,3}(?:,\d{2,3})*(?:,\d{3})?|\d+)(?:\.\d{1,2})?/i);
  if (directMatch) {
    const numStr = directMatch[1]!.replace(/,/g, '');
    const num = parseFloat(numStr);
    if (!isNaN(num) && num > 0) {
      // Check for lakhs/crores in surrounding text
      const lower = text.toLowerCase();
      if (lower.includes('crore') || lower.includes('cr')) return num * 10_000_000;
      if (lower.includes('lakh') || lower.includes('lac') || lower.includes('lakhs')) return num * 100_000;
      if (lower.includes('k ') || lower.includes('k.')) return num * 1_000;
      return num;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Re-parse extracted_data for better quality
// ---------------------------------------------------------------------------

function enrichExtractedData(row: QueueRow): { data: Record<string, unknown>; confidence: number } {
  const text = row.raw_message_text ?? '';
  const existing = row.extracted_data ?? {};
  const enriched = { ...existing };

  // Try to extract amount if missing
  if (!enriched['amount'] && text) {
    const amount = parseIndianAmount(text);
    if (amount && amount > 100) {
      enriched['amount'] = amount;
    }
  }

  // For activities: ensure body field exists
  const VALID_ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'site_visit', 'whatsapp', 'task', 'status_change'];
  if (row.extraction_type === 'activity') {
    if (!enriched['body']) {
      enriched['body'] = text;
    }
    if (!enriched['title']) {
      enriched['title'] = text.slice(0, 100) + (text.length > 100 ? '...' : '');
    }
    // Always validate activity_type — old extractions may have invalid values
    const existingType = enriched['activity_type'] as string | undefined;
    if (!existingType || !VALID_ACTIVITY_TYPES.includes(existingType)) {
      enriched['activity_type'] = classifyActivity(text);
    }
    enriched['occurred_at'] = enriched['occurred_at'] ?? row.message_timestamp;
  }

  // For daily_report: ensure summary
  if (row.extraction_type === 'daily_report') {
    if (!enriched['summary']) {
      enriched['summary'] = text;
    }
  }

  // For contacts: try to extract phone
  if (row.extraction_type === 'contact') {
    if (!enriched['phone']) {
      const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
      if (phoneMatch) enriched['phone'] = phoneMatch[0].replace(/[\s-]/g, '');
    }
    if (!enriched['name']) {
      enriched['name'] = row.sender_name ?? 'Unknown';
    }
  }

  // For boq_item: parse brand, quantity, size
  if (row.extraction_type === 'boq_item') {
    if (!enriched['category']) {
      enriched['category'] = classifyBoqCategory(text);
    }
  }

  // For customer_payment: parse method
  if (row.extraction_type === 'customer_payment') {
    if (!enriched['payment_method'] || enriched['payment_method'] === 'unknown') {
      enriched['payment_method'] = classifyPaymentMethod(text);
    }
  }

  // Re-score confidence
  let confidence = row.confidence_score;
  if (row.extraction_type === 'activity' && enriched['body']) confidence = Math.max(confidence, 0.65);
  if (row.extraction_type === 'contact' && enriched['phone']) confidence = Math.max(confidence, 0.80);
  if (row.extraction_type === 'customer_payment' && enriched['amount']) confidence = Math.max(confidence, 0.75);
  if (row.extraction_type === 'daily_report' && enriched['summary']) confidence = Math.max(confidence, 0.70);
  if (row.extraction_type === 'boq_item' && (enriched['brand'] || enriched['quantity'])) confidence = Math.max(confidence, 0.65);

  return { data: enriched, confidence };
}

// Valid activity_type values: note, call, email, meeting, site_visit, whatsapp, task, status_change
function classifyActivity(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('visit') || lower.includes('site')) return 'site_visit';
  if (lower.includes('meeting') || lower.includes('met ') || lower.includes('discussed')) return 'meeting';
  if (lower.includes('call') || lower.includes('spoke') || lower.includes('contacted') || lower.includes('didn\'t pick')) return 'call';
  if (lower.includes('email') || lower.includes('mail')) return 'email';
  // Everything from WhatsApp is... whatsapp
  return 'whatsapp';
}

function classifyPaymentMethod(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('cheque') || lower.includes('check') || lower.includes('pdc')) return 'cheque';
  if (lower.includes('upi') || lower.includes('gpay') || lower.includes('phonepe')) return 'upi';
  if (lower.includes('neft') || lower.includes('rtgs') || lower.includes('bank transfer') || lower.includes('transferred')) return 'bank_transfer';
  if (lower.includes('cash')) return 'cash';
  return 'bank_transfer';
}

function classifyBoqCategory(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('panel') || lower.includes('module') || lower.includes('540w') || lower.includes('545w') || lower.includes('550w')) return 'solar_panels';
  if (lower.includes('inverter') || lower.includes('growatt') || lower.includes('sungrow')) return 'inverter';
  if (lower.includes('structure') || lower.includes('mms') || lower.includes('mount')) return 'mms';
  if (lower.includes('cable') || lower.includes('wire') || lower.includes('conduit')) return 'dc_accessories';
  if (lower.includes('earth') || lower.includes('grounding')) return 'earthing';
  if (lower.includes('meter') || lower.includes('gen meter')) return 'gen_meter';
  return 'others';
}

// ---------------------------------------------------------------------------
// Insertion logic — one function per target table
// ---------------------------------------------------------------------------

async function insertActivity(row: QueueRow, data: Record<string, unknown>, projectId: string | null, leadId: string | null): Promise<string | null> {
  const body = (data['body'] as string | undefined) ?? row.raw_message_text;
  if (!body || body.length < 5) return null;

  const { data: actData, error } = await supabase
    .from('activities')
    .insert({
      activity_type: (data['activity_type'] as string) ?? 'note',
      title: (data['title'] as string | undefined) ?? body.slice(0, 100),
      body,
      occurred_at: (data['occurred_at'] as string) ?? row.message_timestamp,
      owner_id: null, // No auth user context in batch
      metadata: { whatsapp_import: true, chat_profile: row.chat_profile, sender: row.sender_name },
    })
    .select('id')
    .single();

  if (error) { console.error(`  [activity] Insert error: ${error.message}`); return null; }
  const actId = (actData as { id: string }).id;

  // Link to project/lead
  const assocs: Array<{ activity_id: string; entity_type: string; entity_id: string }> = [];
  if (projectId) assocs.push({ activity_id: actId, entity_type: 'project', entity_id: projectId });
  if (leadId) assocs.push({ activity_id: actId, entity_type: 'lead', entity_id: leadId });
  if (assocs.length > 0) {
    await supabase.from('activity_associations').insert(assocs);
  }

  stats.inserted.activities++;
  return actId;
}

async function insertDailyReport(row: QueueRow, data: Record<string, unknown>, projectId: string): Promise<string | null> {
  const summary = (data['summary'] as string | undefined) ?? row.raw_message_text;
  if (!summary) return null;

  const reportDate = row.message_timestamp.slice(0, 10);
  const workDesc = `[WhatsApp ${row.sender_name}]: ${summary}`;

  // Check uniqueness constraint (project_id, report_date)
  const { data: existing } = await supabase
    .from('daily_site_reports')
    .select('id, work_description')
    .eq('project_id', projectId)
    .eq('report_date', reportDate)
    .single();

  if (existing) {
    // Append
    const { error } = await supabase
      .from('daily_site_reports')
      .update({ work_description: `${existing.work_description}\n\n${workDesc}` })
      .eq('id', existing.id);
    if (error) { console.error(`  [daily_report] Update error: ${error.message}`); return null; }
    stats.inserted.daily_site_reports++;
    return existing.id;
  }

  const { data: rptData, error } = await supabase
    .from('daily_site_reports')
    .insert({
      project_id: projectId,
      submitted_by: MIGRATION_EMPLOYEE_ID,
      report_date: reportDate,
      work_description: workDesc,
    })
    .select('id')
    .single();

  if (error) { console.error(`  [daily_report] Insert error: ${error.message}`); return null; }
  stats.inserted.daily_site_reports++;
  return (rptData as { id: string }).id;
}

async function insertContact(row: QueueRow, data: Record<string, unknown>): Promise<string | null> {
  const phone = (data['phone'] as string | undefined) ?? null;
  const name = (data['name'] as string | undefined) ?? row.sender_name ?? 'Unknown';

  // Dedup by phone
  if (phone) {
    const norm = normalizePhone(phone);
    if (existingPhones.has(norm)) {
      stats.skipped.duplicate++;
      return null;
    }
    existingPhones.add(norm);
  }

  const nameParts = name.trim().split(/\s+/);
  const { data: ctData, error } = await supabase
    .from('contacts')
    .insert({
      name,
      first_name: nameParts[0] ?? name,
      last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
      phone,
      source: 'whatsapp',
      lifecycle_stage: 'lead',
      notes: `Imported from WhatsApp (${row.chat_profile})`,
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      stats.skipped.duplicate++;
      return null;
    }
    console.error(`  [contact] Insert error: ${error.message}`);
    return null;
  }
  stats.inserted.contacts++;
  return (ctData as { id: string }).id;
}

async function insertBoqItem(row: QueueRow, data: Record<string, unknown>, projectId: string): Promise<string | null> {
  const category = (data['category'] as string | undefined) ?? 'others';
  const description = (data['summary'] as string | undefined) ?? (data['brand'] as string | undefined) ?? row.raw_message_text;

  const { data: boqData, error } = await supabase
    .from('project_boq_items')
    .insert({
      project_id: projectId,
      item_category: category,
      item_description: description.slice(0, 500),
      brand: (data['brand'] as string | undefined) ?? null,
      quantity: (data['quantity'] as number | undefined) ?? 0,
      notes: `WhatsApp import (${row.chat_profile}). Sender: ${row.sender_name}`,
    })
    .select('id')
    .single();

  if (error) { console.error(`  [boq_item] Insert error: ${error.message}`); return null; }
  stats.inserted.project_boq_items++;
  return (boqData as { id: string }).id;
}

async function insertCustomerPayment(row: QueueRow, data: Record<string, unknown>, projectId: string): Promise<string | null> {
  const amount = data['amount'] as number | undefined;
  if (!amount || amount <= 0) {
    stats.skipped.insufficient_data++;
    return null;
  }

  const receiptDate = row.message_timestamp.slice(0, 10).replace(/-/g, '');
  const receiptNumber = `WA-${receiptDate}-${row.id.slice(0, 8).toUpperCase()}`;

  const { data: payData, error } = await supabase
    .from('customer_payments')
    .insert({
      project_id: projectId,
      recorded_by: MIGRATION_EMPLOYEE_ID,
      receipt_number: receiptNumber,
      amount,
      payment_date: (data['payment_date'] as string | undefined) ?? row.message_timestamp.slice(0, 10),
      payment_method: (data['payment_method'] as string) ?? 'bank_transfer',
      payment_reference: (data['payment_reference'] as string | undefined) ?? null,
      is_advance: (data['is_advance'] as boolean | undefined) ?? false,
      notes: `WhatsApp import (${row.chat_profile}). ${(data['notes'] as string | undefined) ?? ''}`.trim(),
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      stats.skipped.duplicate++;
      return null;
    }
    console.error(`  [customer_payment] Insert error: ${error.message}`);
    return null;
  }
  stats.inserted.customer_payments++;
  return (payData as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Process a single queue record
// ---------------------------------------------------------------------------

async function processRecord(row: QueueRow): Promise<void> {
  stats.total++;

  // Step 1: Enrich extracted data
  const { data: enrichedData, confidence } = enrichExtractedData(row);

  // Step 2: Fuzzy match project/lead if not already matched
  let projectId = row.matched_project_id;
  let leadId = row.matched_lead_id;

  if (!projectId) {
    // Try to match from message text, extracted company, or sender
    const searchTexts = [
      enrichedData['company'] as string,
      enrichedData['project_name'] as string,
      row.raw_message_text,
    ].filter(Boolean);

    for (const txt of searchTexts) {
      const match = findBestProject(txt);
      if (match.score >= 0.5) {
        projectId = match.project?.id ?? null;
        leadId = match.lead?.id ?? leadId;
        break;
      }
    }
  }

  // Step 3: Insert into target table (skip on dry run)
  let insertedTable: string | null = null;
  let insertedId: string | null = null;

  if (DRY_RUN) {
    stats.approved++;
    if (stats.approved % 500 === 0) console.log(`  [dry-run] Progress: ${stats.approved}/${stats.total}`);
    return;
  }

  switch (row.extraction_type) {
    case 'activity': {
      insertedId = await insertActivity(row, enrichedData, projectId, leadId);
      insertedTable = insertedId ? 'activities' : null;
      break;
    }
    case 'daily_report': {
      if (!projectId) { stats.skipped.no_project++; break; }
      insertedId = await insertDailyReport(row, enrichedData, projectId);
      insertedTable = insertedId ? 'daily_site_reports' : null;
      break;
    }
    case 'contact': {
      insertedId = await insertContact(row, enrichedData);
      insertedTable = insertedId ? 'contacts' : null;
      break;
    }
    case 'boq_item': {
      if (!projectId) { stats.skipped.no_project++; break; }
      insertedId = await insertBoqItem(row, enrichedData, projectId);
      insertedTable = insertedId ? 'project_boq_items' : null;
      break;
    }
    case 'customer_payment': {
      if (!projectId) { stats.skipped.no_project++; break; }
      insertedId = await insertCustomerPayment(row, enrichedData, projectId);
      insertedTable = insertedId ? 'customer_payments' : null;
      break;
    }
    case 'purchase_order':
    case 'vendor_payment': {
      // Mark approved but don't insert — requires manual review
      insertedTable = null;
      insertedId = null;
      break;
    }
  }

  // Step 4: Update queue record
  if (!DRY_RUN) {
    const { error } = await supabase
      .from('whatsapp_import_queue')
      .update({
        review_status: 'approved',
        reviewed_by: MIGRATION_EMPLOYEE_ID,
        reviewed_at: new Date().toISOString(),
        extracted_data: enrichedData,
        confidence_score: confidence,
        matched_project_id: projectId,
        matched_lead_id: leadId,
        inserted_table: insertedTable,
        inserted_id: insertedId,
        review_notes: insertedTable
          ? `Auto-approved and inserted into ${insertedTable}`
          : `Auto-approved (no direct insert — ${!projectId ? 'no project match' : 'manual entry needed'})`,
      })
      .eq('id', row.id);

    if (error) {
      console.error(`  [update] Queue update error for ${row.id}: ${error.message}`);
      stats.errors++;
      return;
    }
  }

  stats.approved++;
  if (stats.approved % 100 === 0) {
    console.log(`  Progress: ${stats.approved}/${stats.total} approved`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== WhatsApp Queue Enrichment + Batch Approve ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  await loadReferenceData();

  // Fetch all pending records in batches
  // Always fetch from offset 0 since approved records won't appear again
  const batchSize = 200;
  let hasMore = true;
  let batchNum = 0;

  while (hasMore) {
    batchNum++;
    const { data: rows, error } = await supabase
      .from('whatsapp_import_queue')
      .select('*')
      .eq('review_status', 'pending')
      .order('message_timestamp', { ascending: true })
      .limit(batchSize);

    if (error) {
      console.error(`[main] Fetch error in batch ${batchNum}: ${error.message}`);
      break;
    }

    const batch = (rows ?? []) as QueueRow[];
    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`\nProcessing batch ${batchNum}: count=${batch.length}`);
    for (const row of batch) {
      try {
        await processRecord(row);
      } catch (err) {
        console.error(`  [main] Error processing ${row.id}:`, err instanceof Error ? err.message : err);
        stats.errors++;
      }
    }

    if (batch.length < batchSize) hasMore = false;
  }

  console.log('\n=== RESULTS ===');
  console.log(`Total records: ${stats.total}`);
  console.log(`Approved: ${stats.approved}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('\nInserted into target tables:');
  for (const [table, count] of Object.entries(stats.inserted)) {
    console.log(`  ${table}: ${count}`);
  }
  console.log('\nSkipped:');
  for (const [reason, count] of Object.entries(stats.skipped)) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
