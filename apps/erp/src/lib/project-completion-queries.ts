import { createClient } from '@repo/supabase/server';
import type { CompletionItemRow, CompletionComponent } from './project-completion-constants';

// Re-export constants + types so server-side code can keep importing from here.
// Client components must import directly from `./project-completion-constants`.
export type { CompletionItemRow, CompletionComponent };
export {
  COMPONENT_WEIGHTS,
  COMPONENT_LABELS,
  COMPONENT_ORDER,
} from './project-completion-constants';

export interface CompletionItemWithProfile extends CompletionItemRow {
  profiles: { full_name: string | null } | null;
}

/**
 * Get all completion items for a project with the completer's name.
 * Returns all 10 possible components (even if rows don't exist yet) by
 * filling in defaults.
 */
export async function getProjectCompletionItems(
  projectId: string,
): Promise<CompletionItemWithProfile[]> {
  const op = '[getProjectCompletionItems]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_completion_items')
    .select('*, profiles!project_completion_items_completed_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`${op} Query failed`, { code: error.code, message: error.message, projectId });
    return [];
  }

  return (data ?? []) as CompletionItemWithProfile[];
}

/**
 * Get the completion % for a project via RPC.
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
