'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

const ALLOWED_CATEGORIES = [
  'travel',
  'food',
  'lodging',
  'site_material',
  'tools',
  'consumables',
  'labour_advance',
  'miscellaneous',
] as const;

type ExpenseCategory = (typeof ALLOWED_CATEGORIES)[number];

const APPROVAL_ROLES = new Set<string>(['founder', 'project_manager', 'finance']);

async function getCallerEmployee(): Promise<{
  userId: string;
  role: string | null;
  employeeId: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: '', role: null, employeeId: null };

  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('employees').select('id').eq('profile_id', user.id).maybeSingle(),
  ]);

  return {
    userId: user.id,
    role: (profile?.role as string) ?? null,
    employeeId: employee?.id ?? null,
  };
}

/**
 * Submit a new site-expense voucher. Created as `pending` so PM can
 * approve or reject from the vouchers queue.
 */
export async function submitSiteExpense(input: {
  projectId: string;
  amount: number;
  description: string;
  expenseCategory: ExpenseCategory;
  expenseDate?: string | null;
  receiptFilePath?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const op = '[submitSiteExpense]';
  const { projectId, amount, description, expenseCategory, expenseDate, receiptFilePath } =
    input;

  if (!projectId) return { success: false, error: 'Missing projectId' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Amount must be a positive number' };
  }
  if (!description.trim()) {
    return { success: false, error: 'Description is required' };
  }
  if (!ALLOWED_CATEGORIES.includes(expenseCategory)) {
    return { success: false, error: 'Invalid expense category' };
  }

  const { userId, employeeId } = await getCallerEmployee();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_site_expenses')
    .insert({
      project_id: projectId,
      amount,
      description: description.trim(),
      expense_category: expenseCategory,
      expense_date: expenseDate ?? new Date().toISOString().split('T')[0],
      receipt_file_path: receiptFilePath ?? null,
      status: 'pending',
      submitted_by: employeeId,
      submitted_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/vouchers');
  return { success: true, id: (data as { id: string }).id };
}

export async function approveSiteExpense(
  expenseId: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[approveSiteExpense]';
  const { userId, role, employeeId } = await getCallerEmployee();
  if (!userId) return { success: false, error: 'Not authenticated' };
  if (!role || !APPROVAL_ROLES.has(role)) {
    return { success: false, error: 'Only PM/Finance/Founder can approve vouchers' };
  }

  const supabase = await createClient();

  // Read the project_id for revalidation
  const { data: current } = await supabase
    .from('project_site_expenses')
    .select('project_id')
    .eq('id', expenseId)
    .maybeSingle();

  const { error } = await supabase
    .from('project_site_expenses')
    .update({
      status: 'approved',
      approved_by: employeeId,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    } as any)
    .eq('id', expenseId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (current?.project_id) {
    revalidatePath(`/projects/${current.project_id}`);
  }
  revalidatePath('/vouchers');
  return { success: true };
}

export async function rejectSiteExpense(
  expenseId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[rejectSiteExpense]';
  const { userId, role, employeeId } = await getCallerEmployee();
  if (!userId) return { success: false, error: 'Not authenticated' };
  if (!role || !APPROVAL_ROLES.has(role)) {
    return { success: false, error: 'Only PM/Finance/Founder can reject vouchers' };
  }
  if (!reason.trim()) {
    return { success: false, error: 'Rejection reason is required' };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('project_site_expenses')
    .select('project_id')
    .eq('id', expenseId)
    .maybeSingle();

  const { error } = await supabase
    .from('project_site_expenses')
    .update({
      status: 'rejected',
      rejected_reason: reason.trim(),
      approved_by: employeeId,
      approved_at: new Date().toISOString(),
    } as any)
    .eq('id', expenseId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (current?.project_id) {
    revalidatePath(`/projects/${current.project_id}`);
  }
  revalidatePath('/vouchers');
  return { success: true };
}

/**
 * List of pending vouchers across all projects, for the PM queue page.
 */
export async function getPendingSiteExpenses(): Promise<
  {
    id: string;
    project_id: string;
    project_number: string | null;
    customer_name: string | null;
    amount: number;
    description: string | null;
    expense_category: string | null;
    expense_date: string | null;
    status: string | null;
    submitted_at: string | null;
    submitted_by_name: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_site_expenses')
    .select(
      'id, project_id, amount, description, expense_category, expense_date, status, submitted_at, projects!project_site_expenses_project_id_fkey(project_number, customer_name), submitted_employee:employees!project_site_expenses_submitted_by_fkey(full_name)',
    )
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[getPendingSiteExpenses] Failed:', error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    project_id: row.project_id,
    project_number: row.projects?.project_number ?? null,
    customer_name: row.projects?.customer_name ?? null,
    amount: Number(row.amount ?? 0),
    description: row.description,
    expense_category: row.expense_category,
    expense_date: row.expense_date,
    status: row.status,
    submitted_at: row.submitted_at,
    submitted_by_name: row.submitted_employee?.full_name ?? null,
  }));
}

/**
 * Fetch all site expenses for a specific project (used on the Actuals
 * step page).
 */
export async function getProjectSiteExpenses(projectId: string): Promise<
  {
    id: string;
    amount: number;
    description: string | null;
    expense_category: string | null;
    expense_date: string | null;
    status: string | null;
    submitted_at: string | null;
    submitted_by_name: string | null;
    approved_by_name: string | null;
    rejected_reason: string | null;
    receipt_file_path: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_site_expenses')
    .select(
      'id, amount, description, expense_category, expense_date, status, submitted_at, rejected_reason, receipt_file_path, submitted_employee:employees!project_site_expenses_submitted_by_fkey(full_name), approved_employee:employees!project_site_expenses_approved_by_fkey(full_name)',
    )
    .eq('project_id', projectId)
    .order('expense_date', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[getProjectSiteExpenses] Failed:', error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount ?? 0),
    description: row.description,
    expense_category: row.expense_category,
    expense_date: row.expense_date,
    status: row.status,
    submitted_at: row.submitted_at,
    submitted_by_name: row.submitted_employee?.full_name ?? null,
    approved_by_name: row.approved_employee?.full_name ?? null,
    rejected_reason: row.rejected_reason,
    receipt_file_path: row.receipt_file_path,
  }));
}
