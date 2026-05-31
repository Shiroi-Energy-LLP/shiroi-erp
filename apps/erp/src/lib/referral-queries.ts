import { createClient } from '@repo/supabase/server';

// ── KPI strip ──

export async function getReferralKpis() {
  const op = '[getReferralKpis]';
  const supabase = await createClient();

  // Pending count
  const { count: pendingCount, error: pendingErr } = await supabase
    .from('referral_payouts')
    .select('id', { count: 'estimated', head: true })
    .eq('status', 'pending');

  if (pendingErr) {
    console.error(`${op} pending count failed`, { error: pendingErr, timestamp: new Date().toISOString() });
  }

  // This month commission (approved + paid, current IST calendar month) via RPC
  // (mig 144 get_referral_commission_this_month). RPC returns TABLE(total NUMERIC),
  // so PostgREST hands back an array with one row.
  // TODO: drop the cast once packages/types/database.ts is regenerated.
  const { data: monthData, error: monthErr } = await supabase
    .rpc('get_referral_commission_this_month' as never);

  if (monthErr) {
    console.error(`${op} month commission failed`, { error: monthErr, timestamp: new Date().toISOString() });
  }

  // Lifetime commission paid (mig 144 get_referral_commission_lifetime).
  const { data: lifetimeData, error: lifetimeErr } = await supabase
    .rpc('get_referral_commission_lifetime' as never);

  if (lifetimeErr) {
    console.error(`${op} lifetime commission failed`, { error: lifetimeErr, timestamp: new Date().toISOString() });
  }

  const monthRows = (monthData ?? []) as Array<{ total: number | string | null }>;
  const lifetimeRows = (lifetimeData ?? []) as Array<{ total: number | string | null }>;

  return {
    pendingCount: pendingCount ?? 0,
    thisMonthCommission: Number(monthRows[0]?.total ?? 0),
    lifetimeCommission: Number(lifetimeRows[0]?.total ?? 0),
  };
}

// ── Payout list by status ──

export async function getReferralPayouts(status: 'pending' | 'approved' | 'paid' | 'rejected') {
  const op = '[getReferralPayouts]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('referral_payouts')
    .select(`
      id,
      commission_pct,
      base_amount,
      commission_amount,
      status,
      approved_at,
      paid_at,
      payment_reference,
      notes,
      created_at,
      channel_partners!referral_payouts_channel_partner_id_fkey (
        id,
        partner_name,
        contact_person,
        phone
      ),
      leads!referral_payouts_lead_id_fkey (
        id,
        customer_name,
        city,
        system_size_kw
      )
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`${op} failed`, { status, error, timestamp: new Date().toISOString() });
    return [];
  }
  return data ?? [];
}

// ── Per-partner detail ──

export async function getPartnerReferralDetail(partnerId: string) {
  const op = '[getPartnerReferralDetail]';
  const supabase = await createClient();

  const { data: partner, error: partnerErr } = await supabase
    .from('channel_partners')
    .select(`
      id,
      partner_name,
      contact_person,
      phone,
      email,
      bank_ifsc,
      bank_account_number,
      default_commission_pct,
      lifetime_referrals,
      lifetime_commission,
      is_active
    `)
    .eq('id', partnerId)
    .maybeSingle();

  if (partnerErr) {
    console.error(`${op} partner failed`, { partnerId, error: partnerErr, timestamp: new Date().toISOString() });
    return null;
  }
  if (!partner) return null;

  const { data: payouts, error: payoutsErr } = await supabase
    .from('referral_payouts')
    .select(`
      id,
      commission_pct,
      base_amount,
      commission_amount,
      status,
      approved_at,
      paid_at,
      payment_reference,
      created_at,
      leads!referral_payouts_lead_id_fkey (
        id,
        customer_name,
        city
      )
    `)
    .eq('channel_partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (payoutsErr) {
    console.error(`${op} payouts failed`, { partnerId, error: payoutsErr, timestamp: new Date().toISOString() });
  }

  return { partner, payouts: payouts ?? [] };
}
