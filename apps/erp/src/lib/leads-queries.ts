import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

// Re-export pure helpers for convenience
export { isValidTransition, normalizePhone, getValidNextStatuses } from './leads-helpers';

export interface LeadFilters {
  status?: LeadStatus;
  source?: Database['public']['Enums']['lead_source'];
  segment?: string;
  search?: string;
  assignedTo?: string;
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
    .select('id, customer_name, phone, email, city, state, segment, source, status, estimated_size_kwp, address_line1, pincode, is_qualified, next_followup_date, expected_close_date, close_probability, is_archived, assigned_to, created_at, employees!leads_assigned_to_fkey(full_name)', { count: 'estimated' })
    .is('deleted_at', null)
    .order(sortCol, { ascending: sortDir });

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else if (!filters.includeConverted) {
    query = query.not('status', 'eq', 'converted');
  }
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.segment) query = query.eq('segment', filters.segment as any);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.search) query = query.or(`customer_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);

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

  // Flatten employee name for DataTable
  const rows = (data ?? []).map((lead: any) => ({
    ...lead,
    assigned_to_name: lead.employees?.full_name ?? '—',
    weighted_value: (lead.estimated_size_kwp ?? 0) * 60000 * (lead.close_probability ?? 0) / 100,
  }));

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
