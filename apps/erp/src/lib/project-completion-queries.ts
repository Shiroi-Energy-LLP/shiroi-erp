import { createClient } from '@repo/supabase/server';

/**
 * Weighted milestone completion % via the get_project_completion_pct RPC
 * (rewritten in mig 173: task-ratio per milestone × master-table weight).
 * The manual project_completion_items checklist is deprecated — table kept,
 * UI removed 2026-06-10.
 */
export async function getProjectCompletionPct(projectId: string): Promise<number> {
  const op = '[getProjectCompletionPct]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc('get_project_completion_pct', { p_project_id: projectId });

  if (error) {
    console.error(`${op} RPC failed`, { code: error.code, message: error.message, projectId });
    return 0;
  }

  return Number(data ?? 0);
}
