'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// Split out of project-boq-actions.ts on 2026-06-06 (item 15b) so that the
// core BOQ CRUD module stays under the NEVER-DO #14 500-LOC ceiling.
// This file owns the hand-off from BOQ finalization to the procurement team.

// ── BOQ: Send to Purchase Team (mark items as yet_to_place) ──

export async function sendBoqToPurchase(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[sendBoqToPurchase]';
  console.log(`${op} Sending BOQ to purchase for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID for tracking
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  // Update all "yet_to_finalize" items to "yet_to_place"
  const { data, error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: 'yet_to_place' } as any)
    .eq('project_id', input.projectId)
    .eq('procurement_status', 'yet_to_finalize')
    .select('id');

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Set project-level procurement tracking
  if (data && data.length > 0) {
    await supabase
      .from('projects')
      .update({
        procurement_status: 'yet_to_place',
        boq_sent_to_purchase_at: new Date().toISOString(),
        boq_sent_to_purchase_by: employee?.id ?? null,
      } as any)
      .eq('id', input.projectId);

    // ── Best-effort: notify all purchase_officer users ─────────────────────
    // Spec §7 event 1 — "New Purchase Request for Project {X}".
    // Wrapped in try/catch so a notification failure doesn't roll back the
    // status flip the user actually cares about.
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, customer_name')
        .eq('id', input.projectId)
        .single();

      const { data: officers } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'purchase_officer')
        .eq('is_active', true);

      if (officers && officers.length > 0 && project) {
        const { data: officerEmployees } = await supabase
          .from('employees')
          .select('id')
          .in('profile_id', officers.map((o) => o.id));

        if (officerEmployees && officerEmployees.length > 0) {
          const notifs = officerEmployees.map((emp) => ({
            recipient_employee_id: emp.id,
            notification_type: 'procurement',
            title: `New Purchase Request for ${project.project_number}`,
            body: `BOQ for ${project.customer_name ?? 'project'} is ready for procurement.`,
            entity_type: 'project',
            entity_id: input.projectId,
          }));
          await supabase.from('notifications').insert(notifs);
        }
      }
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/procurement');
  return { success: true, count: data?.length ?? 0 };
}
