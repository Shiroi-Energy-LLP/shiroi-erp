import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type CompletionItemRow = Database['public']['Tables']['project_completion_items']['Row'];
type CompletionComponent = CompletionItemRow['component'];

// Component weights (must match the SQL RPC)
export const COMPONENT_WEIGHTS: Record<CompletionComponent, number> = {
  site_preparation: 5,
  structure_mounting: 20,
  panel_installation: 25,
  dc_wiring: 10,
  inverter_installation: 15,
  ac_wiring: 10,
  earthing: 5,
  net_metering_applied: 5,
  commissioning: 5,
  handover: 0, // milestone only, not weighted
};

export const COMPONENT_LABELS: Record<CompletionComponent, string> = {
  site_preparation: 'Site Preparation',
  structure_mounting: 'Structure Mounting',
  panel_installation: 'Panel Installation',
  dc_wiring: 'DC Wiring',
  inverter_installation: 'Inverter Installation',
  ac_wiring: 'AC Wiring',
  earthing: 'Earthing',
  net_metering_applied: 'Net Metering Applied',
  commissioning: 'Commissioning',
  handover: 'Handover',
};

export const COMPONENT_ORDER: CompletionComponent[] = [
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
