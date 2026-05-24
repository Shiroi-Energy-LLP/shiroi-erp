'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { type ActionResult, ok, err } from '@/lib/types/actions';

type CompletionComponent = Database['public']['Tables']['project_completion_items']['Row']['component'];

const ALL_COMPONENTS: CompletionComponent[] = [
  'site_preparation',
  'structure_mounting',
  'panel_installation',
  'dc_wiring',
  'inverter_installation',
  'ac_wiring',
  'earthing',
  'net_metering_applied',
  'commissioning',
  'handover',
];

// ---------------------------------------------------------------------------
// Init all 10 rows for a project (idempotent — uses ON CONFLICT DO NOTHING)
// ---------------------------------------------------------------------------

export async function initProjectCompletionItems(projectId: string): Promise<ActionResult<void>> {
  const op = '[initProjectCompletionItems]';
  console.log(`${op} Starting`, { projectId });

  if (!projectId) return err('Missing project ID');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const rows = ALL_COMPONENTS.map((component) => ({
    project_id: projectId,
    component,
    completed: false,
  }));

  const { error } = await supabase
    .from('project_completion_items')
    .upsert(rows, { onConflict: 'project_id,component', ignoreDuplicates: true });

  if (error) {
    console.error(`${op} Failed`, { code: error.code, message: error.message, projectId, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  revalidatePath(`/projects/${projectId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Mark a component complete
// ---------------------------------------------------------------------------

export async function markComponentComplete(
  projectId: string,
  component: CompletionComponent,
  notes?: string,
): Promise<ActionResult<void>> {
  const op = '[markComponentComplete]';
  console.log(`${op} Starting`, { projectId, component });

  if (!projectId || !component) return err('Missing required fields');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Verify role
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager', 'site_supervisor'].includes(profile.role)) {
    return err('Only founders, project managers, and site supervisors can mark components complete');
  }

  // Upsert to handle init-less flow
  const { error } = await supabase
    .from('project_completion_items')
    .upsert(
      {
        project_id: projectId,
        component,
        completed: true,
        completed_at: new Date().toISOString(),
        completed_by: profile.id,
        notes: notes?.trim() ?? null,
      },
      { onConflict: 'project_id,component' },
    );

  if (error) {
    console.error(`${op} Failed`, { code: error.code, message: error.message, projectId, component, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  revalidatePath(`/projects/${projectId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Mark a component incomplete (founder-only rollback)
// ---------------------------------------------------------------------------

export async function markComponentIncomplete(
  projectId: string,
  component: CompletionComponent,
): Promise<ActionResult<void>> {
  const op = '[markComponentIncomplete]';
  console.log(`${op} Starting`, { projectId, component });

  if (!projectId || !component) return err('Missing required fields');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager'].includes(profile.role)) {
    return err('Only founders and project managers can revert a completed component');
  }

  const { error } = await supabase
    .from('project_completion_items')
    .update({
      completed: false,
      completed_at: null,
      completed_by: null,
    })
    .eq('project_id', projectId)
    .eq('component', component);

  if (error) {
    console.error(`${op} Failed`, { code: error.code, message: error.message, projectId, component, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  revalidatePath(`/projects/${projectId}`);
  return ok(undefined);
}
