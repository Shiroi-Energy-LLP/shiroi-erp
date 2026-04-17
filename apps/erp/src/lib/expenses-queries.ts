import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type Expense = Database['public']['Tables']['expenses']['Row'];
export type ExpenseStatus = 'submitted' | 'verified' | 'approved' | 'rejected';

export interface ExpenseListRow {
  id: string;
  voucher_number: string;
  project_id: string | null;
  project_number: string | null;
  customer_name: string | null;
  submitted_by: string | null;
  submitter_name: string | null;
  category_id: string;
  category_label: string | null;
  category_code: string | null;
  description: string | null;
  amount: number;
  expense_date: string | null;
  status: ExpenseStatus;
  submitted_at: string | null;
  verified_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  document_count: number;
}

export interface ListExpensesFilters {
  search?: string;
  projectId?: string | null; // pass the literal string 'general' for general-only
  submittedBy?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  scope?: 'all' | 'project' | 'general';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listExpenses(filters: ListExpensesFilters = {}): Promise<{
  rows: ExpenseListRow[];
  total: number;
}> {
  const op = '[listExpenses]';
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('expenses')
    .select(
      `
      id, voucher_number, project_id, submitted_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason,
      projects:projects(project_number, customer_name),
      submitter:employees!expenses_submitted_by_fkey(full_name),
      category:expense_categories(label, code),
      documents:expense_documents(id)
    `,
      { count: 'estimated' },
    )
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + pageSize - 1);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.submittedBy) query = query.eq('submitted_by', filters.submittedBy);
  if (filters.scope === 'project') query = query.not('project_id', 'is', null);
  if (filters.scope === 'general') query = query.is('project_id', null);
  if (filters.projectId && filters.projectId !== 'general') query = query.eq('project_id', filters.projectId);
  if (filters.projectId === 'general') query = query.is('project_id', null);
  if (filters.dateFrom) query = query.gte('expense_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('expense_date', filters.dateTo);
  if (filters.search) {
    const s = filters.search.trim();
    query = query.or(
      `voucher_number.ilike.%${s}%,description.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} failed`, { filters, error });
    return { rows: [], total: 0 };
  }

  const rows: ExpenseListRow[] = (data ?? []).map((r) => {
    const project = (r.projects as unknown as { project_number: string | null; customer_name: string | null } | null) ?? null;
    const submitter = (r.submitter as unknown as { full_name: string | null } | null) ?? null;
    const cat = (r.category as unknown as { label: string | null; code: string | null } | null) ?? null;
    const docs = (r.documents as unknown as { id: string }[] | null) ?? [];
    return {
      id: r.id,
      voucher_number: r.voucher_number,
      project_id: r.project_id,
      project_number: project?.project_number ?? null,
      customer_name: project?.customer_name ?? null,
      submitted_by: r.submitted_by,
      submitter_name: submitter?.full_name ?? null,
      category_id: r.category_id,
      category_label: cat?.label ?? null,
      category_code: cat?.code ?? null,
      description: r.description,
      amount: Number(r.amount ?? 0),
      expense_date: r.expense_date,
      status: r.status as ExpenseStatus,
      submitted_at: r.submitted_at,
      verified_at: r.verified_at,
      approved_at: r.approved_at,
      rejected_at: r.rejected_at,
      rejected_reason: r.rejected_reason,
      document_count: docs.length,
    };
  });

  return { rows, total: count ?? 0 };
}

export async function getExpense(id: string): Promise<(ExpenseListRow & {
  verified_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  verified_by_name: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
  documents: Array<{
    id: string;
    file_path: string;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
    uploaded_at: string;
  }>;
}) | null> {
  const op = '[getExpense]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('expenses')
    .select(
      `
      id, voucher_number, project_id, submitted_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason, verified_by, approved_by, rejected_by,
      projects:projects(project_number, customer_name),
      submitter:employees!expenses_submitted_by_fkey(full_name),
      verifier:employees!expenses_verified_by_fkey(full_name),
      approver:employees!expenses_approved_by_fkey(full_name),
      rejecter:employees!expenses_rejected_by_fkey(full_name),
      category:expense_categories(label, code),
      documents:expense_documents(id, file_path, file_name, file_size, mime_type, uploaded_at)
    `,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} failed`, { id, error });
    return null;
  }
  if (!data) return null;

  const project = (data.projects as unknown as { project_number: string | null; customer_name: string | null } | null) ?? null;
  const submitter = (data.submitter as unknown as { full_name: string | null } | null) ?? null;
  const verifier = (data.verifier as unknown as { full_name: string | null } | null) ?? null;
  const approver = (data.approver as unknown as { full_name: string | null } | null) ?? null;
  const rejecter = (data.rejecter as unknown as { full_name: string | null } | null) ?? null;
  const cat = (data.category as unknown as { label: string | null; code: string | null } | null) ?? null;
  const docs = (data.documents as unknown as Array<{
    id: string;
    file_path: string;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
    uploaded_at: string;
  }> | null) ?? [];

  return {
    id: data.id,
    voucher_number: data.voucher_number,
    project_id: data.project_id,
    project_number: project?.project_number ?? null,
    customer_name: project?.customer_name ?? null,
    submitted_by: data.submitted_by,
    submitter_name: submitter?.full_name ?? null,
    verified_by: data.verified_by,
    verified_by_name: verifier?.full_name ?? null,
    approved_by: data.approved_by,
    approved_by_name: approver?.full_name ?? null,
    rejected_by: data.rejected_by,
    rejected_by_name: rejecter?.full_name ?? null,
    category_id: data.category_id,
    category_label: cat?.label ?? null,
    category_code: cat?.code ?? null,
    description: data.description,
    amount: Number(data.amount ?? 0),
    expense_date: data.expense_date,
    status: data.status as ExpenseStatus,
    submitted_at: data.submitted_at,
    verified_at: data.verified_at,
    approved_at: data.approved_at,
    rejected_at: data.rejected_at,
    rejected_reason: data.rejected_reason,
    document_count: docs.length,
    documents: docs,
  };
}

export async function getExpensesByProject(projectId: string): Promise<ExpenseListRow[]> {
  const { rows } = await listExpenses({ projectId, pageSize: 500 });
  return rows;
}

export async function getExpenseKPIs(): Promise<{
  total_count: number;
  submitted_count: number;
  pending_action_amt: number;
  approved_month_amt: number;
}> {
  const op = '[getExpenseKPIs]';
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { total_count: 0, submitted_count: 0, pending_action_amt: 0, approved_month_amt: 0 };
  }

  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.user.id).maybeSingle(),
    supabase.from('employees').select('id').eq('profile_id', user.user.id).maybeSingle(),
  ]);

  const { data, error } = await supabase.rpc('get_expense_kpis', {
    p_role: profile?.role ?? 'customer',
    p_employee_id: employee?.id ?? '00000000-0000-0000-0000-000000000000',
  });

  if (error) {
    console.error(`${op} failed`, { error });
    return { total_count: 0, submitted_count: 0, pending_action_amt: 0, approved_month_amt: 0 };
  }
  const row = (data ?? [])[0];
  return {
    total_count: Number(row?.total_count ?? 0),
    submitted_count: Number(row?.submitted_count ?? 0),
    pending_action_amt: Number(row?.pending_action_amt ?? 0),
    approved_month_amt: Number(row?.approved_month_amt ?? 0),
  };
}
