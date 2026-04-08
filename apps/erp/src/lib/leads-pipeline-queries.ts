import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

export interface StageCounts {
  status: LeadStatus;
  count: number;
  total_value: number;
  weighted_value: number;
}

/**
 * Get lead counts + weighted pipeline value grouped by status.
 * Excludes deleted and converted leads.
 */
export async function getLeadStageCounts(includeArchived = false): Promise<StageCounts[]> {
  const op = '[getLeadStageCounts]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  // Use RPC function — GROUP BY in SQL instead of fetching all 1,115 leads to JS
  const { data, error } = await supabase.rpc('get_lead_stage_counts', {
    p_include_archived: includeArchived,
  });

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load stage counts: ${error.message}`);
  }

  return (data ?? []).map((row: any) => ({
    status: row.status as LeadStatus,
    count: Number(row.lead_count),
    total_value: Number(row.total_value),
    weighted_value: Number(row.weighted_value),
  }));
}

/**
 * Get leads expected to close within a date range (for "closing this week" view).
 */
export async function getLeadsClosingBetween(startDate: string, endDate: string) {
  const op = '[getLeadsClosingBetween]';
  console.log(`${op} Starting: ${startDate} to ${endDate}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('leads')
    .select('id, customer_name, phone, status, expected_close_date, close_probability, estimated_size_kwp, assigned_to, employees!leads_assigned_to_fkey(full_name)')
    .is('deleted_at', null)
    .eq('is_archived', false)
    .not('status', 'in', '(won,lost,disqualified,converted)')
    .gte('expected_close_date', startDate)
    .lte('expected_close_date', endDate)
    .order('expected_close_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load closing leads: ${error.message}`);
  }
  return data ?? [];
}
