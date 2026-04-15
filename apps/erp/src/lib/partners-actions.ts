'use server';

/**
 * partners-actions.ts — write operations over channel_partners (consultants +
 * referrals + other introducer subtypes, per migrations 051-052).
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from './types/actions';

type ChannelPartnerInsert = Database['public']['Tables']['channel_partners']['Insert'];
type ChannelPartnerUpdate = Database['public']['Tables']['channel_partners']['Update'];

const PARTNER_TYPES = [
  'individual_broker',
  'aggregator',
  'ngo',
  'housing_society',
  'corporate',
  'consultant',
  'referral',
  'electrical_contractor',
  'architect',
  'mep_firm',
  'other',
] as const;
type PartnerType = (typeof PARTNER_TYPES)[number];

const COMMISSION_TYPES = ['per_kwp', 'percentage_of_revenue', 'fixed_per_deal'] as const;
type CommissionType = (typeof COMMISSION_TYPES)[number];

export interface CreatePartnerInput {
  partner_name: string;
  contact_person: string;
  phone: string;
  email?: string | null;
  whatsapp?: string | null;
  partner_type: PartnerType;
  commission_type: CommissionType;
  commission_rate: number;
  pan_number?: string | null;
  tds_applicable?: boolean;
  agreement_start_date?: string | null;
  agreement_end_date?: string | null;
}

export async function createPartner(
  input: CreatePartnerInput,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createPartner]';
  try {
    if (!input.partner_name || !input.contact_person || !input.phone) {
      return err('partner_name, contact_person, and phone are required');
    }
    if (!PARTNER_TYPES.includes(input.partner_type)) {
      return err(`Invalid partner_type: ${input.partner_type}`);
    }
    if (!COMMISSION_TYPES.includes(input.commission_type)) {
      return err(`Invalid commission_type: ${input.commission_type}`);
    }

    const supabase = await createClient();

    const payload: ChannelPartnerInsert = {
      partner_name: input.partner_name,
      contact_person: input.contact_person,
      phone: input.phone,
      email: input.email ?? null,
      whatsapp: input.whatsapp ?? null,
      partner_type: input.partner_type,
      commission_type: input.commission_type,
      commission_rate: input.commission_rate,
      pan_number: input.pan_number ?? null,
      tds_applicable: input.tds_applicable ?? false,
      agreement_start_date: input.agreement_start_date ?? null,
      agreement_end_date: input.agreement_end_date ?? null,
      is_active: true,
    };

    const { data, error } = await supabase
      .from('channel_partners')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error(`${op} failed`, { code: error.code, message: error.message });
      return err(error.message, error.code);
    }
    return ok({ id: data.id });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function updatePartner(
  id: string,
  patch: Partial<CreatePartnerInput>,
): Promise<ActionResult<null>> {
  const op = '[updatePartner]';
  try {
    if (!id) return err('Missing id');
    if (patch.partner_type && !PARTNER_TYPES.includes(patch.partner_type)) {
      return err(`Invalid partner_type: ${patch.partner_type}`);
    }
    if (patch.commission_type && !COMMISSION_TYPES.includes(patch.commission_type)) {
      return err(`Invalid commission_type: ${patch.commission_type}`);
    }

    const supabase = await createClient();
    const updatePayload: ChannelPartnerUpdate = { ...patch };
    const { error } = await supabase
      .from('channel_partners')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      console.error(`${op} failed`, { id, code: error.code, message: error.message });
      return err(error.message, error.code);
    }
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function disablePartner(id: string): Promise<ActionResult<null>> {
  const op = '[disablePartner]';
  try {
    if (!id) return err('Missing id');
    const supabase = await createClient();
    const { error } = await supabase
      .from('channel_partners')
      .update({ is_active: false })
      .eq('id', id);
    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function enablePartner(id: string): Promise<ActionResult<null>> {
  const op = '[enablePartner]';
  try {
    if (!id) return err('Missing id');
    const supabase = await createClient();
    const { error } = await supabase
      .from('channel_partners')
      .update({ is_active: true })
      .eq('id', id);
    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Assign a channel partner to a lead. This triggers the DB-level
 * fn_lock_consultant_commission_on_partner_assignment() trigger which computes
 * and locks consultant_commission_amount based on the partner's commission
 * structure and the lead's base_quote_price / kWp.
 */
export async function assignPartnerToLead(
  leadId: string,
  partnerId: string,
): Promise<ActionResult<{ lockedAmount: number | null }>> {
  const op = '[assignPartnerToLead]';
  try {
    if (!leadId || !partnerId) return err('Missing leadId or partnerId');
    const supabase = await createClient();

    // Resolve caller's employee id for the lock audit
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const { error } = await supabase
      .from('leads')
      .update({
        channel_partner_id: partnerId,
        consultant_commission_locked_by: employee?.id ?? null,
      })
      .eq('id', leadId);

    if (error) return err(error.message, error.code);

    // Read back the locked amount the trigger computed
    const { data: updated } = await supabase
      .from('leads')
      .select('consultant_commission_amount')
      .eq('id', leadId)
      .maybeSingle();

    return ok({ lockedAmount: updated?.consultant_commission_amount ?? null });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function unassignPartnerFromLead(
  leadId: string,
): Promise<ActionResult<null>> {
  const op = '[unassignPartnerFromLead]';
  try {
    if (!leadId) return err('Missing leadId');
    const supabase = await createClient();

    const { error } = await supabase
      .from('leads')
      .update({
        channel_partner_id: null,
        consultant_commission_amount: null,
        consultant_commission_locked_at: null,
        consultant_commission_locked_by: null,
      })
      .eq('id', leadId);

    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Mark a pending consultant_commission_payouts row as paid.
 * Records paid_at, paid_by, and optional payment_reference.
 */
export async function markPayoutPaid(
  payoutId: string,
  paymentReference?: string,
): Promise<ActionResult<null>> {
  const op = '[markPayoutPaid]';
  try {
    if (!payoutId) return err('Missing payoutId');
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const { error } = await supabase
      .from('consultant_commission_payouts')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: employee?.id ?? null,
        payment_reference: paymentReference ?? null,
      })
      .eq('id', payoutId);

    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
