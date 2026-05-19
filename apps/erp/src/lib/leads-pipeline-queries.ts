import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { getCachedLeadStageCounts } from './cached-dashboard-queries';

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
 *
 * Delegates to getCachedLeadStageCounts which wraps the RPC in
 * unstable_cache (TTL 300s). See cached-dashboard-queries.ts.
 */
export async function getLeadStageCounts(includeArchived = false): Promise<StageCounts[]> {
  const rows = await getCachedLeadStageCounts(includeArchived);
  return rows.map((row) => ({
    status: row.status as LeadStatus,
    count: row.lead_count,
    total_value: row.total_value,
    weighted_value: row.weighted_value,
  }));
}

export interface PipelineCloseWindow {
  leadCount: number;
  totalKwp: number;
  totalValue: number;
}

/**
 * Aggregate count + kWp + ₹ for active (non-terminal) leads closing between two dates.
 * Calls the get_pipeline_close_window RPC (migration 109).
 * All aggregation done in SQL — NEVER-DO #12.
 */
export async function getPipelineCloseWindow(
  startDate: string,
  endDate: string,
): Promise<PipelineCloseWindow> {
  const op = '[getPipelineCloseWindow]';
  console.log(`${op} Starting: ${startDate} to ${endDate}`);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_pipeline_close_window', {
    start_date: startDate,
    end_date: endDate,
  });

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message, startDate, endDate });
    throw new Error(`Failed to load pipeline close window: ${error.message}`);
  }

  const row = (data ?? [])[0];
  return {
    leadCount: Number(row?.lead_count ?? 0),
    totalKwp: Number(row?.total_kwp ?? 0),
    totalValue: Number(row?.total_value ?? 0),
  };
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
