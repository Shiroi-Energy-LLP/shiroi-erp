/**
 * partners-queries.ts — read operations over channel_partners (the broader
 * table that contains both consultants and referrers post-revamp).
 *
 * UI label in the sidebar is "/partners" — maps to channel_partners in DB.
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type ChannelPartner = Database['public']['Tables']['channel_partners']['Row'];
export type ChannelPartnerType = 'individual_broker' | 'aggregator' | 'ngo' | 'housing_society' | 'corporate' | 'consultant' | 'referral' | 'electrical_contractor' | 'architect' | 'mep_firm' | 'other';

export interface ListPartnersOptions {
  search?: string;
  partnerType?: ChannelPartnerType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListPartnersResult {
  rows: ChannelPartner[];
  total: number;
}

export async function listPartners(opts: ListPartnersOptions = {}): Promise<ListPartnersResult> {
  const op = '[listPartners]';
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(opts.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const supabase = await createClient();
    let query = supabase
      .from('channel_partners')
      .select('*', { count: 'estimated' })
      .is('deleted_at', null);

    if (opts.search && opts.search.trim() !== '') {
      const q = opts.search.trim();
      query = query.or(`partner_name.ilike.%${q}%,contact_person.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    if (opts.partnerType) {
      query = query.eq('partner_type', opts.partnerType);
    }
    if (typeof opts.isActive === 'boolean') {
      query = query.eq('is_active', opts.isActive);
    }

    query = query.order('partner_name', { ascending: true }).range(from, to);

    const { data, error, count } = await query;
    if (error) {
      console.error(`${op} query failed`, { code: error.code, message: error.message });
      throw new Error(`Failed to list partners: ${error.message}`);
    }

    return {
      rows: (data ?? []) as ChannelPartner[],
      total: count ?? 0,
    };
  } catch (e) {
    console.error(`${op} threw`, e);
    throw e;
  }
}

export async function getPartner(id: string): Promise<ChannelPartner | null> {
  const op = '[getPartner]';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('channel_partners')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      console.error(`${op} query failed`, { id, code: error.code, message: error.message });
      throw new Error(`Failed to fetch partner: ${error.message}`);
    }
    return (data as ChannelPartner | null) ?? null;
  } catch (e) {
    console.error(`${op} threw`, e);
    throw e;
  }
}

export interface PartnerLeadsRow {
  id: string;
  customer_name: string;
  phone: string;
  status: string;
  estimated_size_kwp: number | null;
  consultant_commission_amount: number | null;
  base_quote_price: number | null;
  created_at: string;
  assigned_to_name: string | null;
}

export async function getPartnerLeads(partnerId: string): Promise<PartnerLeadsRow[]> {
  const op = '[getPartnerLeads]';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .select(
        `id, customer_name, phone, status, estimated_size_kwp, consultant_commission_amount,
         base_quote_price, created_at,
         employees!leads_assigned_to_fkey(full_name)`,
      )
      .eq('channel_partner_id', partnerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`${op} failed`, { partnerId, code: error.code, message: error.message });
      throw new Error(`Failed to fetch partner leads: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const emp = row.employees as unknown as { full_name: string } | null;
      return {
        id: row.id,
        customer_name: row.customer_name,
        phone: row.phone,
        status: row.status,
        estimated_size_kwp: row.estimated_size_kwp as number | null,
        consultant_commission_amount: row.consultant_commission_amount as number | null,
        base_quote_price: row.base_quote_price as number | null,
        created_at: row.created_at,
        assigned_to_name: emp?.full_name ?? null,
      };
    });
  } catch (e) {
    console.error(`${op} threw`, e);
    throw e;
  }
}

export type CommissionPayout = Database['public']['Tables']['consultant_commission_payouts']['Row'];

export interface CommissionPayoutWithContext extends CommissionPayout {
  project_number: string | null;
  customer_name: string | null;
}

export async function getPartnerPayouts(
  partnerId: string,
  filter?: { status?: 'pending' | 'paid' | 'on_hold' | 'cancelled' },
): Promise<CommissionPayoutWithContext[]> {
  const op = '[getPartnerPayouts]';
  try {
    const supabase = await createClient();
    let query = supabase
      .from('consultant_commission_payouts')
      .select(
        `id, lead_id, channel_partner_id, project_id, customer_payment_id, tranche_pct,
         gross_amount, tds_amount, net_amount, status, paid_at, paid_by, payment_reference,
         notes, created_at, updated_at,
         projects!consultant_commission_payouts_project_id_fkey(project_number, customer_name)`,
      )
      .eq('channel_partner_id', partnerId)
      .order('created_at', { ascending: false });

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`${op} failed`, { partnerId, code: error.code, message: error.message });
      throw new Error(`Failed to fetch partner payouts: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const proj = row.projects as unknown as { project_number: string; customer_name: string } | null;
      return {
        ...(row as CommissionPayout),
        project_number: proj?.project_number ?? null,
        customer_name: proj?.customer_name ?? null,
      };
    });
  } catch (e) {
    console.error(`${op} threw`, e);
    throw e;
  }
}

export interface PartnerSummary {
  total_leads: number;
  total_won: number;
  pending_commission: number;
  paid_commission_ytd: number;
}

export async function getPartnerSummary(partnerId: string): Promise<PartnerSummary> {
  const supabase = await createClient();

  const [leadsCountRes, wonCountRes, pendingRes, paidRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('channel_partner_id', partnerId)
      .is('deleted_at', null),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('channel_partner_id', partnerId)
      .in('status', ['won', 'converted'])
      .is('deleted_at', null),
    supabase
      .from('consultant_commission_payouts')
      .select('net_amount')
      .eq('channel_partner_id', partnerId)
      .eq('status', 'pending'),
    supabase
      .from('consultant_commission_payouts')
      .select('net_amount, paid_at')
      .eq('channel_partner_id', partnerId)
      .eq('status', 'paid')
      .gte('paid_at', new Date(new Date().getFullYear(), 3, 1).toISOString()),
  ]);

  const pendingSum = (pendingRes.data ?? []).reduce((s, r) => s + Number(r.net_amount ?? 0), 0);
  const paidYtdSum = (paidRes.data ?? []).reduce((s, r) => s + Number(r.net_amount ?? 0), 0);

  return {
    total_leads: leadsCountRes.count ?? 0,
    total_won: wonCountRes.count ?? 0,
    pending_commission: pendingSum,
    paid_commission_ytd: paidYtdSum,
  };
}
