'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

/**
 * Fields on the projects table that a PM/Founder/Finance/Marketing
 * user can edit inline from the detail page. Everything else is either
 * system-managed (status history, timestamps, FKs) or comes from the
 * BOM/BOQ workflow (cost fields).
 */
const EDITABLE_PROJECT_FIELDS = new Set<string>([
  // System configuration
  'system_size_kwp',
  'system_type',
  'structure_type',
  'panel_brand',
  'panel_model',
  'panel_count',
  'panel_wattage',
  'inverter_brand',
  'inverter_model',
  'inverter_capacity_kw',
  'battery_brand',
  'battery_model',
  'battery_capacity_kwh',
  'cable_brand',
  'cable_model',
  'scope_la',
  'scope_civil',
  'scope_meter',
  'notes',

  // Customer info
  'customer_name',
  'customer_email',
  'customer_phone',
  'primary_contact_id',
  'site_address_line1',
  'site_address_line2',
  'site_city',
  'site_state',
  'site_pincode',
  'billing_address',
  'location_map_link',

  // Timeline + Team
  'order_date',
  'planned_start_date',
  'planned_end_date',
  'actual_start_date',
  'actual_end_date',
  'commissioned_date',
  'project_manager_id',
  'site_supervisor_id',

  // Status (through setProjectStatus but allowed here for column pickers too)
  'status',

  // Financial (role-gated separately inside updateProjectFinancial)
  'contracted_value',
  'estimated_site_expenses_budget',
]);

/**
 * Fields that require elevated roles. Checked alongside the generic
 * updater below.
 */
const FINANCIAL_FIELDS = new Set<string>([
  'contracted_value',
]);

const ALLOWED_FINANCIAL_ROLES = new Set<string>([
  'founder',
  'project_manager',
  'finance',
  // "marketing_manager" is not a DB role yet — sales_engineer covers
  // the marketing team until that role is created.
  'sales_engineer',
]);

// ── Primitive: load the caller's role ──────────────────────────────
async function getCallerRole(): Promise<{
  userId: string;
  role: string | null;
  employeeId: string | null;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: '', role: null, employeeId: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    role: (profile?.role as string) ?? null,
    employeeId: employee?.id ?? null,
  };
}

/**
 * Update a single editable field on the projects table.
 * Honors the EDITABLE_PROJECT_FIELDS allow-list and role gates the
 * financial fields.
 */
export async function updateProjectField(input: {
  projectId: string;
  field: string;
  value: string | number | boolean | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateProjectField]';
  const { projectId, field, value } = input;

  if (!EDITABLE_PROJECT_FIELDS.has(field)) {
    console.error(`${op} Field not editable: ${field}`);
    return { success: false, error: `Field "${field}" cannot be edited` };
  }

  const { userId, role } = await getCallerRole();
  if (!userId) return { success: false, error: 'Not authenticated' };

  if (FINANCIAL_FIELDS.has(field)) {
    if (!role || !ALLOWED_FINANCIAL_ROLES.has(role)) {
      console.warn(`${op} Role ${role} blocked from editing ${field}`);
      return {
        success: false,
        error: 'Only PMs, finance, and founders can edit financial fields',
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({ [field]: value } as any)
    .eq('id', projectId);

  if (error) {
    console.error(`${op} Update failed:`, {
      code: error.code,
      message: error.message,
      projectId,
      field,
    });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { success: true };
}

/**
 * Set project status to any valid value (not just "next step"). Logs
 * to project_status_history. Used by the header status dropdown.
 */
export async function setProjectStatus(input: {
  projectId: string;
  newStatus: ProjectStatus;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[setProjectStatus]';
  const { projectId, newStatus } = input;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  // Fetch current status first so we can record the from → to history
  const { data: project, error: readErr } = await supabase
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .maybeSingle();

  if (readErr || !project) {
    return { success: false, error: readErr?.message ?? 'Project not found' };
  }

  if (project.status === newStatus) {
    return { success: true };
  }

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'completed') {
    updateData.commissioned_date = new Date().toISOString().split('T')[0];
  }

  const { error: updateErr } = await supabase
    .from('projects')
    .update(updateData as any)
    .eq('id', projectId);

  if (updateErr) {
    console.error(`${op} Update failed:`, {
      code: updateErr.code,
      message: updateErr.message,
    });
    return { success: false, error: updateErr.message };
  }

  // Non-blocking history log (trigger also logs, but we record a
  // reason here)
  try {
    await supabase.from('project_status_history').insert({
      project_id: projectId,
      from_status: project.status,
      to_status: newStatus,
      changed_by: employee?.id ?? null,
      reason: `Status set to ${newStatus} from details header`,
    } as any);
  } catch (err) {
    console.error(`${op} History insert failed (non-blocking):`, err);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { success: true };
}

/**
 * Read-only accessor used by the details page to show the caller's
 * role so the UI can gate the Financial box.
 */
export async function getCurrentUserRoleForProject(): Promise<string | null> {
  const { role } = await getCallerRole();
  return role;
}

/**
 * Returns active employees for the project-manager / site-supervisor
 * pickers. Light shape so the dropdown stays fast.
 */
export async function getActiveEmployeesLite(): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) {
    console.error('[getActiveEmployeesLite] Failed:', error.message);
    return [];
  }
  return (data ?? []) as { id: string; full_name: string }[];
}

/**
 * Search contacts by name/phone/email for the Customer Information
 * picker on the detail page.
 */
export async function searchContactsLite(
  query: string,
): Promise<{ id: string; name: string; phone: string | null; email: string | null }[]> {
  const supabase = await createClient();
  const trimmed = query.trim();
  let q = supabase
    .from('contacts')
    .select('id, name, phone, email')
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(20);

  if (trimmed.length > 0) {
    q = q.or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[searchContactsLite] Failed:', error.message);
    return [];
  }
  return (data ?? []) as any;
}

/**
 * Totals for the Financial box:
 *   - contracted_value (from project)
 *   - actual_expenses (from BOQ + approved site vouchers)
 *   - margin % and margin amount
 */
export async function getProjectFinancials(projectId: string): Promise<{
  contractedValue: number;
  actualExpenses: number;
  boqTotal: number;
  siteExpensesTotal: number;
  marginAmount: number;
  marginPct: number;
}> {
  const supabase = await createClient();

  const [{ data: project }, { data: boqItems }, { data: siteExpenses }] = await Promise.all([
    supabase.from('projects').select('contracted_value').eq('id', projectId).maybeSingle(),
    supabase
      .from('project_boq_items')
      .select('total_price, quantity, unit_price')
      .eq('project_id', projectId),
    supabase
      .from('project_site_expenses')
      .select('amount, status')
      .eq('project_id', projectId)
      .in('status', ['approved', 'auto_approved']),
  ]);

  const contractedValue = Number(project?.contracted_value ?? 0);
  const boqTotal = (boqItems ?? []).reduce((sum, item: any) => {
    const itemTotal =
      typeof item.total_price === 'number'
        ? item.total_price
        : Number(item.quantity ?? 0) * Number(item.unit_price ?? 0);
    return sum + (Number.isFinite(itemTotal) ? itemTotal : 0);
  }, 0);
  const siteExpensesTotal = (siteExpenses ?? []).reduce(
    (sum, e: any) => sum + Number(e.amount ?? 0),
    0,
  );
  const actualExpenses = boqTotal + siteExpensesTotal;
  const marginAmount = contractedValue - actualExpenses;
  const marginPct = contractedValue > 0 ? (marginAmount / contractedValue) * 100 : 0;

  return {
    contractedValue,
    actualExpenses,
    boqTotal,
    siteExpensesTotal,
    marginAmount,
    marginPct,
  };
}
