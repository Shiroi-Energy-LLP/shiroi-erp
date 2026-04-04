import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

export interface ProposalFilters {
  status?: ProposalStatus;
  search?: string;
  systemType?: string;
  isBudgetary?: boolean;
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

export async function getProposals(filters: ProposalFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getProposals]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('proposals')
    .select(
      'id, proposal_number, status, system_size_kwp, system_type, total_after_discount, gross_margin_pct, created_at, valid_until, lead_id, revision_number, margin_approval_required, margin_approved_by, is_budgetary, leads!inner(customer_name, phone)',
      { count: 'exact' }
    );

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.systemType) query = query.eq('system_type', filters.systemType as any);
  if (filters.isBudgetary !== undefined) query = query.eq('is_budgetary', filters.isBudgetary);
  if (filters.search) {
    query = query.or(`proposal_number.ilike.%${filters.search}%,leads.customer_name.ilike.%${filters.search}%`);
  }

  const sortColumn = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortColumn, { ascending: sortAsc });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load proposals: ${error.message}`);
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

export async function getProposal(id: string) {
  const op = '[getProposal]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('*, leads(customer_name, phone, email, city), proposal_bom_lines(*), proposal_payment_schedule(*)')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load proposal: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { id });
    return null;
  }
  return data;
}

export async function getProposalRevisions(proposalNumber: string) {
  const op = '[getProposalRevisions]';
  console.log(`${op} Starting for: ${proposalNumber}`);
  if (!proposalNumber) throw new Error(`${op} Missing required parameter: proposalNumber`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id, revision_number, status, total_after_discount, created_at')
    .eq('proposal_number', proposalNumber)
    .order('revision_number', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load revisions: ${error.message}`);
  }
  return data ?? [];
}

export async function getLeadsForProposal() {
  const op = '[getLeadsForProposal]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('id, customer_name, phone, city, segment, system_type, estimated_size_kwp')
    .is('deleted_at', null)
    .in('status', ['site_survey_done', 'proposal_sent', 'negotiation'])
    .order('customer_name');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }
  return data ?? [];
}
