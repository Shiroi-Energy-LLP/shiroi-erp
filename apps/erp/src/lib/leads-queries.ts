import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

// Re-export pure helpers for convenience
export { isValidTransition, normalizePhone, getValidNextStatuses } from './leads-helpers';

export interface LeadFilters {
  status?: LeadStatus | LeadStatus[];
  source?: Database['public']['Enums']['lead_source'];
  segment?: string;
  search?: string;
  assignedTo?: string;
  referrer?: string;
  /** Resolved list of channel_partner IDs for 'internal_all' sentinel */
  referrerIds?: string[];
  /**
   * "Referred by Clients" filter: source='referral' AND channel_partner_id IS NOT NULL
   * AND that partner has is_internal=FALSE. Callers must pass externalPartnerIds
   * (all is_internal=FALSE partner IDs) when referredBy='clients'.
   */
  referredBy?: 'clients' | 'internal' | 'any';
  /** Resolved list of external (is_internal=FALSE) channel_partner IDs for referredBy='clients' */
  externalPartnerIds?: string[];
  kwpMin?: number;
  kwpMax?: number;
  closeFrom?: string;
  closeTo?: string;
  /**
   * Convenience filter for KPI card drill-down. When set, restricts
   * expected_close_date to the current week (Mon–Sun) or current month
   * (first to last day), computed in IST, and excludes terminal statuses.
   */
  closing?: 'this_week' | 'this_month';
  includeConverted?: boolean;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedLeads {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getLeads(filters: LeadFilters = {}): Promise<PaginatedLeads> {
  const op = '[getLeads]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sortCol = filters.sort || 'created_at';
  const sortDir = filters.dir === 'asc';

  let query = supabase
    .from('leads')
    .select('id, customer_name, phone, email, city, state, segment, source, status, estimated_size_kwp, address_line1, pincode, is_qualified, next_followup_date, expected_close_date, close_probability, is_archived, assigned_to, created_at, employees!leads_assigned_to_fkey(full_name), channel_partners!leads_channel_partner_id_fkey(partner_name, is_internal)', { count: 'estimated' })
    .is('deleted_at', null)
    .order(sortCol, { ascending: sortDir });

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  } else if (!filters.includeConverted) {
    query = query.not('status', 'eq', 'converted');
  }
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.segment) query = query.eq('segment', filters.segment as any);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.search) query = query.or(`customer_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
  if (filters.kwpMin !== undefined) query = query.gte('estimated_size_kwp', filters.kwpMin);
  if (filters.kwpMax !== undefined) query = query.lte('estimated_size_kwp', filters.kwpMax);
  if (filters.closeFrom) query = query.gte('expected_close_date', filters.closeFrom);
  if (filters.closeTo) query = query.lte('expected_close_date', filters.closeTo);
  if (filters.closing) {
    // Compute date range in IST (UTC+5:30). We use a fixed offset rather than
    // the Intl API so this stays pure TypeScript with no external deps.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const toDateStr = (d: Date) => d.toISOString().split('T')[0]!;

    let closingStart: string;
    let closingEnd: string;

    if (filters.closing === 'this_week') {
      // Monday–Sunday of the current IST week
      const dayOfWeek = nowIST.getUTCDay(); // 0=Sun … 6=Sat
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(nowIST);
      monday.setUTCDate(nowIST.getUTCDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      closingStart = toDateStr(monday);
      closingEnd = toDateStr(sunday);
    } else {
      // First to last day of the current IST month
      const firstDay = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), 1));
      const lastDay = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth() + 1, 0));
      closingStart = toDateStr(firstDay);
      closingEnd = toDateStr(lastDay);
    }

    query = query
      .gte('expected_close_date', closingStart)
      .lte('expected_close_date', closingEnd)
      .not('status', 'in', '(won,lost,disqualified,converted)');
  }
  if (filters.referrer) {
    if (filters.referrer === 'internal_all') {
      // Caller (page) is responsible for resolving internal partner IDs and
      // passing them via referrerIds. If referrerIds is also provided, that
      // filter handles it. Otherwise fall through without filtering by partner.
    } else {
      query = query.eq('channel_partner_id', filters.referrer);
    }
  }
  if (filters.referrerIds && filters.referrerIds.length > 0) {
    query = query.in('channel_partner_id', filters.referrerIds);
  }
  if (filters.referredBy === 'clients') {
    // source='referral' AND channel_partner_id IS NOT NULL AND partner is external
    query = query.eq('source', 'referral').not('channel_partner_id', 'is', null);
    if (filters.externalPartnerIds && filters.externalPartnerIds.length > 0) {
      query = query.in('channel_partner_id', filters.externalPartnerIds);
    }
  }

  // Archive filtering
  if (filters.archivedOnly) {
    query = query.eq('is_archived', true);
  } else if (!filters.includeArchived) {
    query = query.eq('is_archived', false);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }

  // Flatten joined relations for DataTable
  const rows = (data ?? []).map((lead) => {
    const emp = lead.employees as { full_name: string } | null;
    const cp = lead.channel_partners as { partner_name: string; is_internal: boolean } | null;
    return {
      ...lead,
      assigned_to_name: emp?.full_name ?? '—',
      weighted_value: (lead.estimated_size_kwp ?? 0) * 60000 * (lead.close_probability ?? 0) / 100,
      referrer_name: cp?.partner_name ?? null,
      referrer_is_internal: cp != null ? !!cp.is_internal : null,
    };
  });

  const total = count ?? 0;
  return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getLead(id: string) {
  const op = '[getLead]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('*, employees!leads_assigned_to_fkey(full_name)')
    .eq('id', id)
    .single();
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load lead: ${error.message}`);
  }
  if (!data) return null;
  return data;
}

export async function getLeadActivities(leadId: string) {
  const op = '[getLeadActivities]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*, employees!lead_activities_performed_by_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('activity_date', { ascending: false });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, leadId });
    throw new Error(`Failed to load activities: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Returns true if the given lead already has a non-deleted project.
 * Used by the lead detail layout to decide whether to render the
 * manual `CreateProjectFromLeadButton` fallback for won leads where
 * the cascade missed.
 */
export async function leadHasProject(leadId: string): Promise<boolean> {
  const op = '[leadHasProject]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`${op} query failed:`, {
      code: error.code,
      message: error.message,
      leadId,
    });
    throw new Error(`Failed to check project existence: ${error.message}`);
  }
  return !!data;
}

/**
 * Returns true if the given lead has any proposal (any status).
 * Mig 107's BEFORE UPDATE trigger blocks the won transition when this
 * is false; the lead detail layout uses this to show a "create a
 * proposal first" banner before the user hits the error.
 */
export async function leadHasProposal(leadId: string): Promise<boolean> {
  const op = '[leadHasProposal]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`${op} query failed:`, {
      code: error.code,
      message: error.message,
      leadId,
    });
    throw new Error(`Failed to check proposal existence: ${error.message}`);
  }
  return !!data;
}

/**
 * Returns true when the lead has at least one detailed (non-budgetary) proposal.
 * Used to decide whether to show the "Create Detailed Quote" nudge in the lead header.
 */
export async function leadHasDetailedProposal(leadId: string): Promise<boolean> {
  const op = '[leadHasDetailedProposal]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id')
    .eq('lead_id', leadId)
    .eq('is_budgetary', false)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`${op} query failed:`, {
      code: error.code,
      message: error.message,
      leadId,
    });
    throw new Error(`Failed to check detailed proposal existence: ${error.message}`);
  }
  return !!data;
}

export async function getSalesEngineers() {
  const op = '[getSalesEngineers]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load sales engineers: ${error.message}`);
  }
  return data ?? [];
}
