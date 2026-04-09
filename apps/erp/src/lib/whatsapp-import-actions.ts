'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

async function getCurrentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function getEmployeeId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

// Migration System employee — used as fallback when the current user has no employee record
const MIGRATION_EMPLOYEE_ID = '589b7878-46eb-4d6c-ba24-079d167d0e89';

export async function approveQueueItem(
  id: string,
  overrideProjectId?: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[approveQueueItem]';
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from('whatsapp_import_queue')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !item) {
    return { success: false, error: 'Queue item not found' };
  }

  const projectId = overrideProjectId ?? (item.matched_project_id as string | null);
  const data = item.extracted_data as Record<string, unknown>;
  let insertedTable: string | null = null;
  let insertedId: string | null = null;

  try {
    const userId = await getCurrentUserId(supabase);
    // Resolve employee ID once — fallback to Migration System if user has no employee record
    const employeeId = (await getEmployeeId(supabase, userId)) ?? MIGRATION_EMPLOYEE_ID;

    switch (item.extraction_type as string) {
      case 'customer_payment': {
        if (!projectId || !data['amount']) {
          return { success: false, error: 'Missing project or amount for payment' };
        }
        const receiptDate = (item.message_timestamp as string).slice(0, 10).replace(/-/g, '');
        const receiptNumber = `WA-${receiptDate}-${id.slice(0, 8).toUpperCase()}`;
        const { data: payData, error } = await supabase
          .from('customer_payments')
          .insert({
            project_id: projectId,
            recorded_by: employeeId,
            receipt_number: receiptNumber,
            amount: data['amount'] as number,
            payment_date: (data['payment_date'] as string | undefined) ?? (item.message_timestamp as string).slice(0, 10),
            payment_method: (data['payment_method'] as string | undefined) ?? 'bank_transfer',
            payment_reference: (data['payment_reference'] as string | undefined) ?? null,
            is_advance: (data['is_advance'] as boolean | undefined) ?? false,
            notes: `WhatsApp import (${item.chat_profile as string}). ${(data['notes'] as string | undefined) ?? ''}`.trim(),
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        insertedTable = 'customer_payments';
        insertedId = (payData as { id: string } | null)?.id ?? null;
        break;
      }

      case 'task': {
        const { data: taskData, error } = await supabase
          .from('tasks')
          .insert({
            entity_type: (data['entity_type'] as string | undefined) ?? 'project',
            entity_id: projectId ?? null,
            project_id: projectId ?? null,
            title: data['title'] as string,
            description: (data['notes'] as string | undefined) ?? null,
            created_by: employeeId,
            assigned_to: employeeId,
            priority: 'medium',
            due_date: (data['due_date'] as string | undefined) ?? null,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        insertedTable = 'tasks';
        insertedId = (taskData as { id: string } | null)?.id ?? null;
        break;
      }

      case 'activity': {
        const { data: actData, error: actError } = await supabase
          .from('activities')
          .insert({
            activity_type: (data['activity_type'] as string | undefined) ?? 'note',
            title: (data['title'] as string | undefined) ?? null,
            body: (data['body'] as string | undefined) ?? (item.raw_message_text as string | null),
            occurred_at: (data['occurred_at'] as string | undefined) ?? item.message_timestamp,
            owner_id: userId,
            metadata: { whatsapp_import: true, chat_profile: item.chat_profile, approved: true },
          })
          .select('id')
          .single();
        if (actError || !actData) throw new Error(actError?.message ?? 'Insert failed');
        const actId = (actData as { id: string }).id;

        const assocs: Array<{ activity_id: string; entity_type: string; entity_id: string }> = [];
        if (projectId) assocs.push({ activity_id: actId, entity_type: 'project', entity_id: projectId });
        if (item.matched_lead_id) assocs.push({ activity_id: actId, entity_type: 'lead', entity_id: item.matched_lead_id as string });
        if (assocs.length > 0) await supabase.from('activity_associations').insert(assocs);

        insertedTable = 'activities';
        insertedId = actId;
        break;
      }

      case 'daily_report': {
        if (!projectId) {
          // No project match — just mark approved with note
          break;
        }
        const reportDate = (item.message_timestamp as string).slice(0, 10);
        const workDesc = (data['summary'] as string | undefined) ?? (item.raw_message_text as string);

        // Check for existing report on same project+date (unique constraint)
        const { data: existing } = await supabase
          .from('daily_site_reports')
          .select('id, work_description')
          .eq('project_id', projectId)
          .eq('report_date', reportDate)
          .single();

        if (existing) {
          // Append to existing report
          const { error: updErr } = await supabase
            .from('daily_site_reports')
            .update({
              work_description: `${existing.work_description}\n\n[WhatsApp ${item.sender_name as string}]: ${workDesc}`,
            })
            .eq('id', existing.id);
          if (updErr) throw new Error(updErr.message);
          insertedTable = 'daily_site_reports';
          insertedId = existing.id;
        } else {
          const { data: rptData, error: rptErr } = await supabase
            .from('daily_site_reports')
            .insert({
              project_id: projectId,
              submitted_by: employeeId,
              report_date: reportDate,
              work_description: `[WhatsApp ${item.sender_name as string}]: ${workDesc}`,
            })
            .select('id')
            .single();
          if (rptErr) throw new Error(rptErr.message);
          insertedTable = 'daily_site_reports';
          insertedId = (rptData as { id: string } | null)?.id ?? null;
        }
        break;
      }

      case 'contact': {
        const phone = (data['phone'] as string | undefined) ?? null;
        const contactName = (data['name'] as string | undefined) ?? (item.sender_name as string) ?? 'Unknown';

        // Phone dedup check
        if (phone) {
          const normalized = phone.replace(/[\s\-+]/g, '').slice(-10);
          const { data: dup } = await supabase
            .from('contacts')
            .select('id')
            .ilike('phone', `%${normalized}`)
            .limit(1);
          if (dup && dup.length > 0) {
            // Duplicate — skip insert, just mark approved
            insertedTable = 'contacts';
            insertedId = (dup[0] as { id: string }).id;
            break;
          }
        }

        const nameParts = contactName.trim().split(/\s+/);
        const { data: ctData, error: ctErr } = await supabase
          .from('contacts')
          .insert({
            name: contactName,
            first_name: nameParts[0] ?? contactName,
            last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            phone: phone,
            source: 'whatsapp',
            lifecycle_stage: 'lead',
            notes: `Imported from WhatsApp (${item.chat_profile as string})`,
          })
          .select('id')
          .single();
        if (ctErr) throw new Error(ctErr.message);
        insertedTable = 'contacts';
        insertedId = (ctData as { id: string } | null)?.id ?? null;
        break;
      }

      case 'boq_item': {
        if (!projectId) {
          // No project match — just mark approved with note
          break;
        }
        const category = (data['category'] as string | undefined) ?? 'others';
        const description = (data['summary'] as string | undefined) ??
          (data['brand'] as string | undefined) ??
          (item.raw_message_text as string);

        const { data: boqData, error: boqErr } = await supabase
          .from('project_boq_items')
          .insert({
            project_id: projectId,
            item_category: category,
            item_description: description,
            brand: (data['brand'] as string | undefined) ?? null,
            quantity: (data['quantity'] as number | undefined) ?? 0,
            notes: `WhatsApp import (${item.chat_profile as string}). ${(data['notes'] as string | undefined) ?? ''}`.trim(),
          })
          .select('id')
          .single();
        if (boqErr) throw new Error(boqErr.message);
        insertedTable = 'project_boq_items';
        insertedId = (boqData as { id: string } | null)?.id ?? null;
        break;
      }

      // Financial types without direct table insert — mark approved for manual entry
      case 'purchase_order':
      case 'vendor_payment':
      default:
        break;
    }

    // Use employee ID (not profile ID) for reviewed_by FK
    const { error: updateError } = await supabase
      .from('whatsapp_import_queue')
      .update({
        review_status: 'approved',
        reviewed_by: employeeId,
        reviewed_at: new Date().toISOString(),
        matched_project_id: projectId,
        inserted_table: insertedTable,
        inserted_id: insertedId,
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);
  } catch (err) {
    console.error(`${op} Failed:`, err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

export async function rejectQueueItem(
  id: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[rejectQueueItem]';
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);

  const { error } = await supabase
    .from('whatsapp_import_queue')
    .update({
      review_status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, error.message);
    return { success: false, error: error.message };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

export async function reassignProject(
  id: string,
  newProjectId: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[reassignProject]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_import_queue')
    .update({ matched_project_id: newProjectId })
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, error.message);
    return { success: false, error: error.message };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

export async function batchApproveQueueItems(
  ids: string[]
): Promise<{ success: boolean; approved: number; failed: number; errors: string[] }> {
  const op = '[batchApproveQueueItems]';
  let approved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of ids) {
    const result = await approveQueueItem(id);
    if (result.success) {
      approved++;
    } else {
      failed++;
      errors.push(`${id}: ${result.error ?? 'Unknown error'}`);
      console.error(`${op} Failed for ${id}:`, result.error);
    }
  }

  revalidatePath('/whatsapp-import');
  return { success: failed === 0, approved, failed, errors };
}

export async function batchRejectQueueItems(
  ids: string[],
  notes?: string
): Promise<{ success: boolean; rejected: number; failed: number }> {
  const op = '[batchRejectQueueItems]';
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);
  const employeeId = (await getEmployeeId(supabase, userId)) ?? MIGRATION_EMPLOYEE_ID;

  const { error, count } = await supabase
    .from('whatsapp_import_queue')
    .update({
      review_status: 'rejected',
      reviewed_by: employeeId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? 'Batch rejected',
    })
    .in('id', ids);

  if (error) {
    console.error(`${op} Failed:`, error.message);
    return { success: false, rejected: 0, failed: ids.length };
  }

  revalidatePath('/whatsapp-import');
  return { success: true, rejected: count ?? ids.length, failed: 0 };
}
