import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

export interface ProposalFilters {
  status?: ProposalStatus;
  systemType?: string;
  isBudgetary?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedProposals {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getProposals(filters: ProposalFilters = {}): Promise<PaginatedProposals> {
  const op = '[getProposals]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sortCol = filters.sort || 'created_at';
  const sortDir = filters.dir === 'asc';

  let query = supabase
    .from('proposals')
    .select('id, proposal_number, status, system_size_kwp, system_type, total_after_discount, gross_margin_pct, created_at, valid_until, lead_id, revision_number, is_budgetary, margin_approval_required, margin_approved_by, leads!inner(customer_name, phone)', { count: 'exact' })
    .order(sortCol, { ascending: sortDir });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.systemType) query = query.eq('system_type', filters.systemType as any);
  if (filters.isBudgetary === 'true') query = query.eq('is_budgetary', true);
  if (filters.isBudgetary === 'false') query = query.eq('is_budgetary', false);
  if (filters.search) {
    query = query.or(`proposal_number.ilike.%${filters.search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load proposals: ${error.message}`);
  }

  // Flatten for DataTable
  const rows = (data ?? []).map((p: any) => ({
    ...p,
    customer_name: p.leads?.customer_name ?? '—',
    total_price: p.total_after_discount,
    margin_pct: p.gross_margin_pct,
    proposal_type: p.is_budgetary ? 'budgetary' : 'detailed',
  }));

  const total = count ?? 0;
  return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
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
