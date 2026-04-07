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

    switch (item.extraction_type as string) {
      case 'customer_payment': {
        if (!projectId || !data['amount']) {
          return { success: false, error: 'Missing project or amount for payment' };
        }
        const employeeId = await getEmployeeId(supabase, userId);
        if (!employeeId) {
          return { success: false, error: 'Employee profile not found — cannot record payment' };
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
        const employeeId = await getEmployeeId(supabase, userId);
        if (!employeeId) {
          return { success: false, error: 'Employee profile not found — cannot create task' };
        }
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

      // Financial types: just mark approved — Vivek reviews and manually enters if needed
      case 'purchase_order':
      case 'vendor_payment':
      case 'boq_item':
      default:
        break;
    }

    const { error: updateError } = await supabase
      .from('whatsapp_import_queue')
      .update({
        review_status: 'approved',
        reviewed_by: userId,
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
