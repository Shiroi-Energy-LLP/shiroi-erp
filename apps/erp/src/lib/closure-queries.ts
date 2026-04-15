/**
 * closure-queries.ts - read operations for closure approval UI.
 *
 * Separate from closure-actions.ts so server components can import these
 * without the 'use server' directive forcing a server-action round-trip.
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type LeadClosureApproval = Database['public']['Tables']['lead_closure_approvals']['Row'];

export interface PendingClosureApproval extends LeadClosureApproval {
  lead_customer_name: string;
  lead_city: string | null;
  requested_by_name: string | null;
}

/**
 * All pending amber-band closure approvals, newest first.
 * Used by the founder dashboard widget.
 */
export async function listPendingClosureApprovals(): Promise<PendingClosureApproval[]> {
  const op = '[listPendingClosureApprovals]';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('lead_closure_approvals')
      .select(
        `
        id, lead_id, requested_by, requested_at, approved_by, approved_at, rejected_at,
        band_at_request, gross_margin_at_request, final_base_price, reason, status,
        created_at, updated_at,
        leads!lead_closure_approvals_lead_id_fkey(customer_name, city),
        employees!lead_closure_approvals_requested_by_fkey(full_name)
      `,
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error(`${op} failed`, { code: error.code, message: error.message });
      throw new Error(`Failed to list closure approvals: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const lead = row.leads as unknown as { customer_name: string; city: string | null } | null;
      const emp = row.employees as unknown as { full_name: string } | null;
      return {
        ...(row as LeadClosureApproval),
        lead_customer_name: lead?.customer_name ?? '(unknown)',
        lead_city: lead?.city ?? null,
        requested_by_name: emp?.full_name ?? null,
      };
    });
  } catch (e) {
    console.error(`${op} threw`, e);
    throw e;
  }
}

export async function countPendingClosureApprovals(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('lead_closure_approvals')
    .select('id', { count: 'estimated', head: true })
    .eq('status', 'pending');
  if (error) return 0;
  return count ?? 0;
}
