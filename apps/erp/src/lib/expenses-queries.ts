import { cache } from 'react';
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { sanitizeForIlike } from './helpers/sanitize-or-filter';
import { getSessionContext, getCurrentEmployeeId } from '@/lib/auth';
import { EXPENSE_STATUSES, EXPENSE_SCOPES } from './expenses-constants';

export type Expense = Database['public']['Tables']['expenses']['Row'];
export type ExpenseStatus = 'submitted' | 'verified' | 'approved' | 'rejected';

// Re-exported from the no-server-imports constants module so client components
// can `import type` / read these without dragging the server client in (#21).
export { EXPENSE_STATUSES, EXPENSE_SCOPES };

export interface ExpenseListRow {
  id: string;
  voucher_number: string;
  project_id: string | null;
  project_number: string | null;
  project_name: string | null;
  customer_name: string | null;
  submitted_by: string | null;
  submitter_name: string | null;
  entered_by: string | null;
  entered_by_name: string | null;
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

/**
 * id → full_name for every employee the caller may see on an expense screen,
 * via the `list_expense_employees` RPC (mig 215 §E).
 *
 * Why not a PostgREST embed on `employees`? `expenses_select_own` lets
 * founder/project_manager/finance read EVERY voucher, but `employees_read` only
 * lets founder/hr_manager read every employee — so the embed silently returned
 * NULL and the PM saw 'Submitter —' on 5,114 of the 6,283 rows they can
 * otherwise see (measured on dev, 2026-07-30). The RPC is a narrow
 * SECURITY DEFINER projection of id/full_name/is_active only.
 *
 * Request-scoped `cache()`: the list page resolves names, filter options and
 * the on-behalf picker from one round-trip. Identity is NOT cached here — this
 * is a name lookup, not a session (NEVER-DO #22).
 */
const getExpenseEmployeeDirectory = cache(async (): Promise<
  Array<{ id: string; full_name: string; is_active: boolean }>
> => {
  const op = '[getExpenseEmployeeDirectory]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_expense_employees');
  if (error) {
    console.error(`${op} failed`, { error, timestamp: new Date().toISOString() });
    return [];
  }
  if (!data) return [];
  return data.map((e) => ({ id: e.id, full_name: e.full_name ?? '', is_active: e.is_active }));
});

const getExpenseEmployeeNames = cache(async (): Promise<Map<string, string>> => {
  const directory = await getExpenseEmployeeDirectory();
  return new Map(directory.map((e) => [e.id, e.full_name]));
});

/** Resolve an employees.id to a display name, or null when unknown/unset. */
function employeeName(names: Map<string, string>, id: string | null): string | null {
  if (!id) return null;
  return names.get(id) || null;
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
      id, voucher_number, project_id, submitted_by, entered_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason,
      projects:projects(project_number, project_name, customer_name),
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
    const s = sanitizeForIlike(filters.search);
    query = query.or(
      `voucher_number.ilike.${s},description.ilike.${s}`,
    );
  }

  const [{ data, error, count }, names] = await Promise.all([query, getExpenseEmployeeNames()]);
  if (error) {
    console.error(`${op} failed`, { filters, error });
    return { rows: [], total: 0 };
  }

  const rows: ExpenseListRow[] = (data ?? []).map((r) => {
    const project = (r.projects as unknown as { project_number: string | null; project_name: string | null; customer_name: string | null } | null) ?? null;
    const cat = (r.category as unknown as { label: string | null; code: string | null } | null) ?? null;
    const docs = (r.documents as unknown as { id: string }[] | null) ?? [];
    return {
      id: r.id,
      voucher_number: r.voucher_number,
      project_id: r.project_id,
      project_number: project?.project_number ?? null,
      project_name: project?.project_name ?? null,
      customer_name: project?.customer_name ?? null,
      submitted_by: r.submitted_by,
      submitter_name: employeeName(names, r.submitted_by),
      entered_by: r.entered_by,
      entered_by_name: employeeName(names, r.entered_by),
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
      id, voucher_number, project_id, submitted_by, entered_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason, verified_by, approved_by, rejected_by,
      projects:projects(project_number, project_name, customer_name),
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

  // Stage names come from the RPC directory, not an employees embed — see the
  // getExpenseEmployeeDirectory comment for why the embed is RLS-blind here.
  const names = await getExpenseEmployeeNames();
  const project = (data.projects as unknown as { project_number: string | null; project_name: string | null; customer_name: string | null } | null) ?? null;
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
    project_name: project?.project_name ?? null,
    customer_name: project?.customer_name ?? null,
    submitted_by: data.submitted_by,
    submitter_name: employeeName(names, data.submitted_by),
    entered_by: data.entered_by,
    entered_by_name: employeeName(names, data.entered_by),
    verified_by: data.verified_by,
    verified_by_name: employeeName(names, data.verified_by),
    approved_by: data.approved_by,
    approved_by_name: employeeName(names, data.approved_by),
    rejected_by: data.rejected_by,
    rejected_by_name: employeeName(names, data.rejected_by),
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

/**
 * Exact count + SUM(amount) over the *same* filter set `listExpenses` applies —
 * feeds the filter-aware KPI card. Aggregation happens in SQL (NEVER-DO #12),
 * and the RPC is SECURITY INVOKER so RLS scopes it identically to the list.
 *
 * Note this count is exact, unlike the list's `count: 'estimated'` (NEVER-DO
 * #13) — the KPI is the number to trust when the two disagree.
 */
export async function getExpenseFilteredTotals(
  filters: ListExpensesFilters = {},
): Promise<{ count: number; total: number }> {
  const op = '[getExpenseFilteredTotals]';
  const supabase = await createClient();

  const search = filters.search?.trim();
  // 'general' in projectId is the sentinel for project_id IS NULL — the RPC
  // expresses that through p_scope, not p_project_id.
  const generalOnly = filters.projectId === 'general' || filters.scope === 'general';
  const projectId = filters.projectId && filters.projectId !== 'general' ? filters.projectId : undefined;

  const { data, error } = await supabase.rpc('get_expense_filtered_totals', {
    p_search: search || undefined,
    p_scope: generalOnly ? 'general' : (filters.scope ?? 'all'),
    p_status: filters.status ?? undefined,
    p_category_id: filters.categoryId || undefined,
    p_submitted_by: filters.submittedBy || undefined,
    p_project_id: projectId,
    p_date_from: filters.dateFrom || undefined,
    p_date_to: filters.dateTo || undefined,
  });

  if (error) {
    console.error(`${op} failed`, { filters, error, timestamp: new Date().toISOString() });
    return { count: 0, total: 0 };
  }
  const row = (data ?? [])[0];
  return { count: Number(row?.expense_count ?? 0), total: Number(row?.total_amount ?? 0) };
}

export interface SubmitterOption {
  id: string;
  full_name: string;
}

/**
 * Active employees for the Submitter filter + the on-behalf picker.
 *
 * Sourced from `list_expense_employees` rather than a direct `employees` read:
 * `employees_read` shows a project_manager only their own row plus direct
 * reports, which left the Submitter filter with a single option for the role
 * that can see every voucher.
 *
 * This is also the authorization list for delegated entry — `submitExpense`
 * accepts a submitter only if it appears here for that caller, so the picker
 * and the server-side check can never drift apart.
 */
export async function listSubmitterOptions(): Promise<SubmitterOption[]> {
  const directory = await getExpenseEmployeeDirectory();
  return directory
    .filter((e) => e.is_active)
    .map((e) => ({ id: e.id, full_name: e.full_name }));
}

export interface ExpenseProjectOption {
  id: string;
  project_number: string | null;
  project_name: string | null;
  customer_name: string | null;
}

/**
 * Project options for the auto-search comboboxes (filter bar + add dialog).
 *
 * Deliberately unbounded: the combobox filters client-side, so a `.limit()`
 * here silently makes the capped-out projects unfilterable (NEVER-DO #25). The
 * page previously capped at 500 while `projects` already held 507 rows. Payload
 * is 4 short columns per project; revisit with a server-side searched combobox
 * if the table grows past a few thousand rows.
 */
export async function listExpenseProjectOptions(): Promise<ExpenseProjectOption[]> {
  const op = '[listExpenseProjectOptions]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, project_name')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} failed`, { error, timestamp: new Date().toISOString() });
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    project_number: p.project_number,
    project_name: p.project_name,
    customer_name: p.customer_name,
  }));
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
  // Shares the request-scoped session + employee resolution (NEVER-DO #22 / master-ref §4.17).
  const { userId, role } = await getSessionContext();
  if (!userId) {
    return { total_count: 0, submitted_count: 0, pending_action_amt: 0, approved_month_amt: 0 };
  }
  const employeeId = await getCurrentEmployeeId();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_expense_kpis', {
    p_role: role ?? 'customer',
    p_employee_id: employeeId ?? '00000000-0000-0000-0000-000000000000',
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
