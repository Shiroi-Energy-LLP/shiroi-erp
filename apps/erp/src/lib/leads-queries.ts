import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadSource = Database['public']['Enums']['lead_source'];
type CustomerSegment = Database['public']['Enums']['customer_segment'];

export { isValidTransition, normalizePhone, getValidNextStatuses } from './leads-helpers';

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  segment?: CustomerSegment;
  search?: string;
  assignedTo?: string;
  includeConverted?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getLeads(filters: LeadFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getLeads]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('leads')
    .select(
      'id, customer_name, phone, email, city, segment, source, status, estimated_size_kwp, assigned_to, next_followup_date, created_at, employees!leads_assigned_to_fkey(full_name)',
      { count: 'exact' }
    )
    .is('deleted_at', null);

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else if (!filters.includeConverted) {
    query = query.not('status', 'eq', 'converted');
  }
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.segment) query = query.eq('segment', filters.segment);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.search) {
    query = query.or(`customer_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
  }

  const sortColumn = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortColumn, { ascending: sortAsc });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    data: data ?? [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
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
