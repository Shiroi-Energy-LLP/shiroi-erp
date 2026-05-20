'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getUserProfile } from '@/lib/auth';

/**
 * Toggle the org-wide proposal gate.
 *
 * Only founder can call this — checked both here (fast-fail) and enforced by
 * RLS on system_settings (DB-level guarantee). Returns ok(null) on success,
 * err(...) on any failure. Never throws (NEVER-DO #19).
 *
 * `caller.id` is a profile id (auth.uid()). We resolve it to the matching
 * employee id before writing the audit column, because system_settings.updated_by
 * FK-references employees(id), not profiles(id).
 */
export async function setProposalGateEnabled(
  enabled: boolean,
): Promise<ActionResult<null>> {
  const op = '[setProposalGateEnabled]';
  try {
    const caller = await getUserProfile();
    if (!caller) {
      return err('You must be signed in');
    }
    if (caller.role !== 'founder') {
      return err('Only founder can change system settings');
    }

    const supabase = await createClient();

    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', caller.id)
      .maybeSingle();
    if (empErr) {
      console.error(`${op} employee lookup failed`, {
        callerId: caller.id,
        error: empErr,
        timestamp: new Date().toISOString(),
      });
    }
    const employeeId = emp?.id ?? null;

    const { data, error } = await supabase
      .from('system_settings')
      .update({
        proposal_gate_enabled: enabled,
        updated_at: new Date().toISOString(),
        updated_by: employeeId,
      })
      .eq('id', true)
      .select('proposal_gate_enabled, updated_at, updated_by');

    if (error) {
      console.error(`${op} update failed`, {
        enabled,
        callerId: caller.id,
        error,
        timestamp: new Date().toISOString(),
      });
      return err(error.message || 'Could not update system settings');
    }

    // Zero rows returned = RLS blocked the write (shouldn't happen for founder,
    // but guard defensively).
    if (!data || data.length === 0) {
      console.error(`${op} zero rows updated — RLS may have blocked`, {
        enabled,
        callerId: caller.id,
        timestamp: new Date().toISOString(),
      });
      return err('Update was blocked — check permissions');
    }

    // Revalidate all pages that render the proposal-gate banner or the settings tab.
    revalidatePath('/settings');
    revalidatePath('/dashboard');
    revalidatePath('/sales');
    revalidatePath('/sales/[id]', 'page');
    revalidatePath('/leads');
    revalidatePath('/leads/[id]', 'page');

    return ok(null);
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      enabled,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}
