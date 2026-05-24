'use server';

/**
 * knowledge-qa-rate-limit.ts — per-user daily rate limiting for /ask.
 *
 * Non-founder users are limited to NON_FOUNDER_DAILY_LIMIT questions per 24h
 * (rolling window, counted from rag_query_log rows).
 * Founder is unlimited.
 *
 * We count existing rows only — the caller is responsible for inserting the
 * log row after a successful answer. This keeps this function read-only and
 * avoids a write on every rate-limit check.
 */

import { createAdminClient } from '@repo/supabase/admin';

// ── Constants ──────────────────────────────────────────────────────────────────

const NON_FOUNDER_DAILY_LIMIT = 30;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  /** Whether this call is allowed. */
  allowed: boolean;
  /**
   * Questions remaining after this call would be counted.
   * null for founder (unlimited).
   */
  remaining: number | null;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * checkAndIncrementRateLimit — read-only rate-limit check for /ask.
 *
 * Does NOT insert a row — the caller inserts the rag_query_log row after a
 * successful answer, so we count existing rows for the window.
 *
 * @param callerId   - The authenticated user's UUID
 * @param callerRole - The user's app_role string
 * @returns          { allowed, remaining }
 */
export async function checkAndIncrementRateLimit(
  callerId: string,
  callerRole: string,
): Promise<RateLimitResult> {
  const op = '[checkAndIncrementRateLimit]';

  // Founder: unlimited
  if (callerRole === 'founder') {
    return { allowed: true, remaining: null };
  }

  // For everyone else: count rows in the rolling 24-hour window
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  const { count, error } = await admin
    .from('rag_query_log')
    .select('id', { count: 'exact', head: true })
    .eq('caller_id', callerId)
    .gte('created_at', windowStart);

  if (error) {
    // Non-fatal: log and allow rather than block on a count error.
    // Better to allow a spurious extra question than to deny a legitimate user.
    console.error(`${op} count query failed`, {
      callerId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    return { allowed: true, remaining: NON_FOUNDER_DAILY_LIMIT };
  }

  const used = count ?? 0;

  if (used >= NON_FOUNDER_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  // remaining = limit - used - 1 (subtract 1 for the question about to be asked)
  const remaining = NON_FOUNDER_DAILY_LIMIT - used - 1;
  return { allowed: true, remaining };
}
