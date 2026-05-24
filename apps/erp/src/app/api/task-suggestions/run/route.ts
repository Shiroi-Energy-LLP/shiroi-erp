import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import type { Database } from '@repo/types/database';
import { scanStaleItems } from '@/lib/ai/task-suggestion-scanner';
import { generateSuggestedTask } from '@/lib/ai/task-suggestion-generator';
import { howManyMoreCanThisUserReceive } from '@/lib/ai/task-suggestion-cap';

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

/** Sentinel prefix for AI-suggested tasks — filterable via LIKE '[AI] %'. */
const AI_TITLE_PREFIX = '[AI] ';

/** Sentinel content prefix in the remarks field for quick identification. */
const AI_REMARKS_SENTINEL = '[AI suggested]';

type TaskSuggestionQueueInsert = Database['public']['Tables']['task_suggestion_queue']['Insert'];
type TaskSuggestionQueueUpdate = Database['public']['Tables']['task_suggestion_queue']['Update'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];

interface RunResult {
  stale_found: number;
  suggestions_created: number;
  capped: number;
  errors: number;
  detail: string[];
}

export async function POST(req: NextRequest) {
  // ── Auth: validate x-webhook-secret header ──
  const secret = req.headers.get('x-webhook-secret');
  if (!secret || secret !== N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const op = '[task-suggestions/run]';
  const admin = createAdminClient();
  const result: RunResult = {
    stale_found: 0,
    suggestions_created: 0,
    capped: 0,
    errors: 0,
    detail: [],
  };

  try {
    // ── Step 1: Scan for stale items ──
    const staleItems = await scanStaleItems();
    result.stale_found = staleItems.length;
    result.detail.push(`Scanned: ${staleItems.length} stale items found`);

    if (staleItems.length === 0) {
      return NextResponse.json({ ...result }, { status: 200 });
    }

    // ── Step 2: Insert all stale items into task_suggestion_queue ──
    const queueInserts: TaskSuggestionQueueInsert[] = staleItems.map((item) => ({
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      staleness_signal: item.staleness_signal,
      suggested_assignee_employee_id: item.suggested_assignee_employee_id ?? null,
      status: 'pending',
    }));

    const { data: insertedRows, error: insertError } = await admin
      .from('task_suggestion_queue')
      .insert(queueInserts)
      .select('id, entity_type, entity_id, suggested_assignee_employee_id, staleness_signal');

    if (insertError || !insertedRows) {
      console.error(`${op} Queue insert failed:`, { error: insertError, timestamp: new Date().toISOString() });
      result.detail.push(`Queue insert failed: ${insertError?.message ?? 'no data returned'}`);
      return NextResponse.json({ ...result }, { status: 500 });
    }

    // ── Step 3: Process each pending queue row ──
    for (let i = 0; i < insertedRows.length; i++) {
      const row = insertedRows[i]!;
      const staleItem = staleItems[i]!;
      const assigneeId = row.suggested_assignee_employee_id ?? null;

      // Check per-user daily cap
      if (assigneeId) {
        const remaining = await howManyMoreCanThisUserReceive(assigneeId);
        if (remaining <= 0) {
          const dismissed: TaskSuggestionQueueUpdate = {
            status: 'dismissed',
            processed_at: new Date().toISOString(),
            ai_task_title: null,
            ai_task_description: null,
          };
          await admin
            .from('task_suggestion_queue')
            .update(dismissed)
            .eq('id', row.id);

          result.capped++;
          result.detail.push(`Capped for assignee ${assigneeId} (entity ${row.entity_type}:${row.entity_id})`);
          continue;
        }
      }

      // Generate AI task title + description
      let generated: { title: string; description: string; tokens_used: number };
      try {
        generated = await generateSuggestedTask(staleItem);
      } catch (genErr) {
        const msg = genErr instanceof Error ? genErr.message : String(genErr);
        console.error(`${op} AI generation failed:`, {
          queueId: row.id,
          entity: `${row.entity_type}:${row.entity_id}`,
          error: msg,
          timestamp: new Date().toISOString(),
        });
        await admin
          .from('task_suggestion_queue')
          .update({ status: 'dismissed', processed_at: new Date().toISOString() } satisfies TaskSuggestionQueueUpdate)
          .eq('id', row.id);
        result.errors++;
        result.detail.push(`AI gen error for ${row.entity_type}:${row.entity_id}: ${msg.slice(0, 80)}`);
        continue;
      }

      // Build the task insert
      // Title gets '[AI] ' prefix for filterability (cap enforcer + UI badge use LIKE '[AI] %')
      // Remarks gets '[AI suggested]' sentinel for display in notes column
      const aiTitle = `${AI_TITLE_PREFIX}${generated.title}`;

      // Map entity_type to task category
      const categoryMap: Record<string, string> = {
        lead: 'lead_followup',
        project: 'project_followup',
        service_ticket: 'service_ticket_followup',
      };
      const category = categoryMap[row.entity_type] ?? row.entity_type;

      // project_id is required for project tasks; entity_id doubles as project_id for project type
      const projectId = row.entity_type === 'project' ? row.entity_id : null;

      // Due date: 2 business days from now
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);
      const dueDateStr = dueDate.toISOString().split('T')[0]!;

      // We need a created_by employee id — use any system/founder employee as fallback.
      // For cron context: query the admin employee (founder) as the task creator.
      const { data: creatorEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!creatorEmployee) {
        console.error(`${op} No active employee found for created_by`, { timestamp: new Date().toISOString() });
        result.errors++;
        continue;
      }

      // If no assignee, also assign to the creator (founder)
      const effectiveAssignee = assigneeId ?? creatorEmployee.id;

      const taskId = crypto.randomUUID();
      const taskInsert: TaskInsert = {
        id: taskId,
        title: aiTitle,
        description: generated.description,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        project_id: projectId,
        category,
        priority: 'medium',
        due_date: dueDateStr,
        assigned_to: effectiveAssignee,
        created_by: creatorEmployee.id,
        assigned_date: new Date().toISOString().split('T')[0]!,
        remarks: `${AI_REMARKS_SENTINEL} ${generated.description}`,
      };

      const { error: taskInsertError } = await admin
        .from('tasks')
        .insert(taskInsert);

      if (taskInsertError) {
        console.error(`${op} Task insert failed:`, {
          queueId: row.id,
          entity: `${row.entity_type}:${row.entity_id}`,
          error: taskInsertError,
          timestamp: new Date().toISOString(),
        });
        await admin
          .from('task_suggestion_queue')
          .update({ status: 'dismissed', processed_at: new Date().toISOString() } satisfies TaskSuggestionQueueUpdate)
          .eq('id', row.id);
        result.errors++;
        result.detail.push(`Task insert error for ${row.entity_type}:${row.entity_id}`);
        continue;
      }

      // Mark queue row as task_created
      const queueUpdate: TaskSuggestionQueueUpdate = {
        status: 'task_created',
        ai_task_title: generated.title,
        ai_task_description: generated.description,
        ai_tokens_used: generated.tokens_used,
        created_task_id: taskId,
        processed_at: new Date().toISOString(),
      };

      await admin
        .from('task_suggestion_queue')
        .update(queueUpdate)
        .eq('id', row.id);

      result.suggestions_created++;
      result.detail.push(`Created task for ${row.entity_type}:${row.entity_id} → assigned to ${effectiveAssignee}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${op} Unhandled error:`, { error: msg, timestamp: new Date().toISOString() });
    result.detail.push(`Unhandled error: ${msg}`);
    return NextResponse.json({ ...result }, { status: 500 });
  }

  return NextResponse.json({ ...result }, { status: 200 });
}

export const dynamic = 'force-dynamic';
