import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import Decimal from 'decimal.js';

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

  let query = supabase
    .from('leads')
    .select('status, estimated_size_kwp, close_probability')
    .is('deleted_at', null)
    .not('status', 'eq', 'converted');

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load stage counts: ${error.message}`);
  }

  // Group by status and compute weighted values
  const grouped = new Map<LeadStatus, { count: number; total_value: Decimal; weighted_value: Decimal }>();

  for (const lead of data ?? []) {
    const existing = grouped.get(lead.status) ?? {
      count: 0,
      total_value: new Decimal(0),
      weighted_value: new Decimal(0),
    };
    existing.count++;
    // Rough value estimate: kWp * 60000 (avg ₹60K/kWp for solar)
    const estimatedValue = new Decimal(lead.estimated_size_kwp ?? 0).mul(60000);
    existing.total_value = existing.total_value.add(estimatedValue);
    const prob = new Decimal(lead.close_probability ?? 0).div(100);
    existing.weighted_value = existing.weighted_value.add(estimatedValue.mul(prob));
    grouped.set(lead.status, existing);
  }

  return Array.from(grouped.entries()).map(([status, vals]) => ({
    status,
    count: vals.count,
    total_value: vals.total_value.toNumber(),
    weighted_value: vals.weighted_value.toNumber(),
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
