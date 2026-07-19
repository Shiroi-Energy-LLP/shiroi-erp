'use server';

/**
 * referral-actions.ts — write operations over referral_payouts.
 *
 * Roles that may call approve/reject: founder only.
 * Roles that may call markPaid: finance + founder.
 */

import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from './types/actions';
import { requireAuthUser } from '@/lib/auth';

// ── Approve ──

export async function approveReferralPayout(
  payoutId: string,
): Promise<ActionResult<null>> {
  const op = '[approveReferralPayout]';
  try {
    if (!payoutId) return err('Missing payoutId');

    const authed = await requireAuthUser();
    if (!authed.success) return authed;
    const { user, supabase } = authed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) return err('Profile not found');
    if (profile.role !== 'founder') return err('Only the founder can approve referral payouts');

    const { error } = await supabase
      .from('referral_payouts')
      .update({
        status: 'approved',
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', payoutId)
      .eq('status', 'pending');

    if (error) {
      console.error(`${op} failed`, { payoutId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/referrals');
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, { payoutId, error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ── Mark paid ──

export async function markReferralPaid(
  payoutId: string,
  paymentReference: string,
): Promise<ActionResult<null>> {
  const op = '[markReferralPaid]';
  try {
    if (!payoutId) return err('Missing payoutId');
    if (!paymentReference?.trim()) return err('Payment reference is required');

    const authed = await requireAuthUser();
    if (!authed.success) return authed;
    const { user, supabase } = authed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !['founder', 'finance'].includes(profile.role)) {
      return err('Only finance or founder can mark payouts as paid');
    }

    // Fetch payout to get channel_partner_id and commission_amount for counter update
    const { data: payout } = await supabase
      .from('referral_payouts')
      .select('channel_partner_id, commission_amount, status')
      .eq('id', payoutId)
      .maybeSingle();

    if (!payout) return err('Payout not found');
    if (payout.status === 'paid') return err('Already marked as paid');
    if (payout.status !== 'approved') return err('Payout must be approved before marking paid');

    const { error } = await supabase
      .from('referral_payouts')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_reference: paymentReference.trim(),
      })
      .eq('id', payoutId);

    if (error) {
      console.error(`${op} failed`, { payoutId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    // Bump lifetime_commission on the partner via the atomic SQL RPC
    // (mig 134 increment_partner_commission). Best-effort; payout is already marked paid.
    const { error: bumpErr } = await supabase.rpc('increment_partner_commission', {
      p_partner_id: payout.channel_partner_id,
      p_amount: Number(payout.commission_amount),
    });
    if (bumpErr) {
      console.error(`${op} commission counter bump failed (non-fatal)`, {
        payoutId,
        partnerId: payout.channel_partner_id,
        code: bumpErr.code,
        message: bumpErr.message,
        timestamp: new Date().toISOString(),
      });
    }

    revalidatePath('/referrals');
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, { payoutId, error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ── Reject ──

export async function rejectReferralPayout(
  payoutId: string,
  reason: string,
): Promise<ActionResult<null>> {
  const op = '[rejectReferralPayout]';
  try {
    if (!payoutId) return err('Missing payoutId');

    const authed = await requireAuthUser();
    if (!authed.success) return authed;
    const { user, supabase } = authed.data;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.role !== 'founder') {
      return err('Only the founder can reject referral payouts');
    }

    const { error } = await supabase
      .from('referral_payouts')
      .update({
        status: 'rejected',
        notes: reason || null,
      })
      .eq('id', payoutId)
      .in('status', ['pending', 'approved']);

    if (error) {
      console.error(`${op} failed`, { payoutId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/referrals');
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, { payoutId, error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
