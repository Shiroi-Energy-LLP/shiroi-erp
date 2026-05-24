'use server';

/**
 * proposal-share-actions.ts
 *
 * Server actions for managing customer-facing proposal share tokens.
 * Tokens are cryptographically random strings, not UUIDs, to make
 * guessing infeasible even if an attacker knows the pattern.
 */

import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from './types/actions';

const ALLOWED_ROLES = ['founder', 'marketing_manager', 'designer', 'sales_engineer'];

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

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

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
