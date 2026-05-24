/**
 * O&M Profitability queries.
 * All Supabase reads for the O&M profitability analytics page.
 */

import { createClient } from '@repo/supabase/server';

export interface OmProfitabilityRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  ticket_count: number;
  ticket_parts_cost: number;
  ticket_service_amount: number;
  profit_loss: number;
  sla_compliant_count: number;
  sla_breach_count: number;
  sla_compliance_pct: number | null;
}

export type OmProfitabilityResult =
  | { ok: true; rows: OmProfitabilityRow[] }
  | { ok: false; error: string };

/**
 * Fetches the O&M profitability data for a date range via the get_om_profitability RPC.
 * Returns { ok: true, rows } on success, { ok: false, error } on failure.
 */
export async function getOmProfitability(
  startDate: string,
  endDate: string,
): Promise<OmProfitabilityResult> {
  const op = 'getOmProfitability';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_om_profitability', {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error(`[${op}] RPC failed`, { startDate, endDate, error, timestamp: new Date().toISOString() });
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: true, rows: [] };
  }

  return { ok: true, rows: data as OmProfitabilityRow[] };
}

/**
 * Fetches the current user and their role.
 * Returns null if unauthenticated.
 */
export async function getCurrentUserRole(): Promise<{ userId: string; role: string } | null> {
  const op = 'getCurrentUserRole';
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    console.error(`[${op}] Failed to fetch profile`, { userId: user.id, error, timestamp: new Date().toISOString() });
    return null;
  }

  return { userId: user.id, role: profile.role as string };
}
