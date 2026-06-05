import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

// Row shape returned by search_proposals RPC. The leads embed comes back as
// lead_customer_name / lead_phone scalars — we reshape into the leads
// sub-object the page expects.
type SearchProposalRow = {
  id: string;
  proposal_number: string;
  status: ProposalStatus;
  system_size_kwp: number | string;
  system_type: string;
  total_after_discount: number | string;
  gross_margin_pct: number | string;
  created_at: string;
  valid_until: string | null;
  lead_id: string;
  revision_number: number;
  is_budgetary: boolean;
  margin_approval_required: boolean;
  margin_approved_by: string | null;
  lead_customer_name: string | null;
  lead_phone: string | null;
  total_count: number | string;
};

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

  // Item 2b: parameter-bound RPC replaces .or() interpolation. Sort column
  // is whitelisted server-side inside the RPC. Total count travels back on
  // each row as total_count (CROSS JOIN) so we can drop the separate count
  // query the old .select({ count: 'estimated' }) gave us.
  const trimmed = filters.search?.trim();
  const { data, error } = await (supabase.rpc as any)('search_proposals', {
    p_query: trimmed && trimmed.length > 0 ? trimmed : null,
    p_status: filters.status ?? null,
    p_system_type: filters.systemType ?? null,
    p_is_budgetary:
      filters.isBudgetary === 'true' ? true : filters.isBudgetary === 'false' ? false : null,
    p_sort: filters.sort || 'created_at',
    p_dir: filters.dir === 'asc' ? 'asc' : 'desc',
    p_limit: pageSize,
    p_offset: from,
  });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load proposals: ${error.message}`);
  }

  const rpcRows = (data ?? []) as SearchProposalRow[];
  const total = rpcRows.length > 0 ? Number(rpcRows[0]!.total_count ?? 0) : 0;

  // Flatten for DataTable (preserve the exact shape callers consume).
  const rows = rpcRows.map((p) => ({
    id: p.id,
    proposal_number: p.proposal_number,
    status: p.status,
    system_size_kwp: p.system_size_kwp,
    system_type: p.system_type,
    total_after_discount: p.total_after_discount,
    gross_margin_pct: p.gross_margin_pct,
    created_at: p.created_at,
    valid_until: p.valid_until,
    lead_id: p.lead_id,
    revision_number: p.revision_number,
    is_budgetary: p.is_budgetary,
    margin_approval_required: p.margin_approval_required,
    margin_approved_by: p.margin_approved_by,
    leads: { customer_name: p.lead_customer_name ?? '', phone: p.lead_phone ?? '' },
    customer_name: p.lead_customer_name ?? '—',
    total_price: p.total_after_discount,
    margin_pct: p.gross_margin_pct,
    proposal_type: p.is_budgetary ? 'budgetary' : 'detailed',
  }));

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
