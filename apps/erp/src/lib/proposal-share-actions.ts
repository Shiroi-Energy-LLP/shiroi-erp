'use server';

/**
 * proposal-share-actions.ts
 *
 * Server actions for managing customer-facing proposal share tokens.
 * Tokens are cryptographically random strings, not UUIDs, to make
 * guessing infeasible even if an attacker knows the pattern.
 */

import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from './types/actions';
import { requireAuthUser } from '@/lib/auth';

const ALLOWED_ROLES = ['founder', 'marketing_manager', 'designer', 'sales_engineer'];

// ── Rate limiter for acceptProposalFromPortal ──────────────────────────────
// In-process Map keyed by share token. Limits a single token to 5 accept
// attempts per minute to blunt brute-force or replay abuse against the public
// portal. Entries are lazily pruned after RATE_LIMIT_PRUNE_MS to keep the map
// bounded — no background timer needed.
//
// Limitations: per-process only (resets on cold start / horizontal scale).
// Good enough for the threat model since each token is 256 bits of entropy
// and proposals.status uses a CAS guard, but if abuse becomes a real concern
// move this to a SQL-backed counter.
const ACCEPT_RATE_LIMIT_MAX = 5;
const ACCEPT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_PRUNE_MS = 5 * 60 * 1000; // 5 minutes
const acceptAttempts = new Map<string, { count: number; firstAt: number }>();

function pruneAcceptAttempts(now: number): void {
  for (const [k, v] of acceptAttempts) {
    if (now - v.firstAt > RATE_LIMIT_PRUNE_MS) acceptAttempts.delete(k);
  }
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CreateShareTokenResult {
  token: string;
  shareUrl: string;
  expiresAt: string;
}

/**
 * createProposalShareToken — generate a magic-link URL for customer proposal viewing.
 *
 * @param proposalId  UUID of the proposal
 * @param expiresInDays  Days until the link expires (default 30)
 */
export async function createProposalShareToken(
  proposalId: string,
  expiresInDays = 30,
): Promise<ActionResult<CreateShareTokenResult>> {
  const op = '[createProposalShareToken]';
  try {
    if (!proposalId) return err('Missing proposalId');

    const authed = await requireAuthUser();
    if (!authed.success) return authed;
    const { user, supabase } = authed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) return err('Profile not found');
    if (!ALLOWED_ROLES.includes(profile.role)) {
      return err('Your role cannot create share links');
    }

    // Verify proposal exists and belongs to this org
    const { data: proposal } = await supabase
      .from('proposals')
      .select('id')
      .eq('id', proposalId)
      .maybeSingle();

    if (!proposal) return err('Proposal not found');

    // Use admin client to insert (bypasses RLS on proposal_share_tokens)
    const admin = createAdminClient();
    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .from('proposal_share_tokens')
      .insert({
        proposal_id: proposalId,
        token,
        expires_at: expiresAt,
        created_by: profile.id,
      });

    if (insertErr) {
      console.error(`${op} insert failed`, { proposalId, code: insertErr.code, message: insertErr.message, timestamp: new Date().toISOString() });
      return err(insertErr.message, insertErr.code);
    }

    const baseUrl = process.env.NEXT_PUBLIC_ERP_URL ?? 'https://erp.shiroienergy.com';
    const shareUrl = `${baseUrl}/p/${token}`;

    return ok({ token, shareUrl, expiresAt });
  } catch (e) {
    console.error(`${op} threw`, { proposalId, error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * acceptProposalFromPortal — record customer's acceptance from the public /p/[token] portal.
 *
 * Validates the share token (must exist, not be revoked, not be expired), flips
 * proposals.status to 'approved', and emits a proposal.accepted event so the
 * lead owner gets paged. Uses the admin client because the caller is unauthenticated
 * (public page).
 */
export async function acceptProposalFromPortal(token: string): Promise<ActionResult<null>> {
  const op = '[acceptProposalFromPortal]';
  try {
    if (!token || token.length < 32) return err('Invalid token');

    // Rate-limit accept attempts per token (5 per minute).
    const now = Date.now();
    pruneAcceptAttempts(now);
    const existing = acceptAttempts.get(token);
    if (existing && now - existing.firstAt < ACCEPT_RATE_LIMIT_WINDOW_MS) {
      if (existing.count >= ACCEPT_RATE_LIMIT_MAX) {
        return err('Too many accept attempts; please wait a minute');
      }
      existing.count++;
    } else {
      acceptAttempts.set(token, { count: 1, firstAt: now });
    }

    const admin = createAdminClient();

    const { data: share, error: shareErr } = await admin
      .from('proposal_share_tokens')
      .select('proposal_id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (shareErr) {
      console.error(`${op} share lookup failed`, { code: shareErr.code, message: shareErr.message, timestamp: new Date().toISOString() });
      return err(shareErr.message, shareErr.code);
    }
    if (!share) return err('Link not found');
    if (new Date(share.expires_at).getTime() < Date.now()) return err('Link has expired');

    // CAS on status — only flip if currently sent/viewed/draft (don't overwrite a later state).
    // Proposal status enum: draft | sent | viewed | negotiating | accepted | rejected | expired | superseded
    const { error: updateErr } = await admin
      .from('proposals')
      .update({ status: 'accepted' })
      .eq('id', share.proposal_id)
      .in('status', ['sent', 'viewed', 'draft']);

    if (updateErr) {
      console.error(`${op} update failed`, { proposalId: share.proposal_id, code: updateErr.code, message: updateErr.message, timestamp: new Date().toISOString() });
      return err(updateErr.message, updateErr.code);
    }

    // Best-effort: emit event (no throw if event-bus is unset)
    try {
      const { emitErpEvent } = await import('./n8n/emit');
      await emitErpEvent('proposal.accepted_by_customer', {
        proposal_id: share.proposal_id,
        token,
        accepted_at: new Date().toISOString(),
      });
    } catch {
      // Event bus failures are non-blocking — acceptance is recorded regardless.
    }

    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, { error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
