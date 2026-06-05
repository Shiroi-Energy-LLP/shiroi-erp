'use server';

/**
 * S15 — B3 Plant anomaly log mutations (server actions).
 *
 * resolveAnomaly — marks an anomaly as resolved. Allowed roles: founder,
 * om_technician. Returns ActionResult<void> (NEVER-DO #19).
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';

// ── Role guard ────────────────────────────────────────────────────────────────

const RESOLVE_ALLOWED_ROLES = new Set(['founder', 'om_technician']);

async function getCallerRole(): Promise<string | null> {
  const authed = await requireAuthUser();
  if (!authed.success) return null;
  const { user, supabase } = authed.data;

  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return (data as { role: string } | null)?.role ?? null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Marks an anomaly as resolved. Sets resolved_at to NOW() and stores
 * optional resolution_notes.
 *
 * Allowed: founder, om_technician.
 */
export async function resolveAnomaly(
  anomalyId: string,
  notes: string,
): Promise<ActionResult<void>> {
  const op = '[resolveAnomaly]';

  const role = await getCallerRole();
  if (!role || !RESOLVE_ALLOWED_ROLES.has(role)) {
    console.warn(`${op} unauthorized`, { role, anomalyId, timestamp: new Date().toISOString() });
    return err('You do not have permission to resolve anomalies.', 'UNAUTHORIZED');
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('plant_anomaly_log')
    .update({
      resolved_at: new Date().toISOString(),
      resolution_notes: notes.trim() || null,
    })
    .eq('id', anomalyId)
    .is('resolved_at', null); // idempotent: only update if not already resolved

  if (error) {
    console.error(`${op} update failed`, {
      error: error.message,
      code: error.code,
      anomalyId,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  // Revalidate project performance pages so the anomaly disappears immediately
  revalidatePath('/projects', 'layout');

  return ok(undefined as void);
}
