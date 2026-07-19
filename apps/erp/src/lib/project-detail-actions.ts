'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { emitErpEvent } from './n8n/emit';
import { getSessionContext, getCurrentEmployeeId } from '@/lib/auth';
import { getActiveEmployeesForSelect } from './employees-queries';

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
  'ceig_scope',

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
 * Project Value (contracted_value) is PM-owned: only the project manager
 * may edit it, with founder as the standing override (2026-06-10 spec).
 */
const PROJECT_VALUE_FIELD = 'contracted_value';
const PROJECT_VALUE_EDIT_ROLES = new Set<string>(['project_manager', 'founder']);

// ── Primitive: load the caller's role ──────────────────────────────
// Role-only, sharing the request-scoped session resolution (NEVER-DO #22 /
// master-ref §4.17). The employees-id lookup that used to live here was unused
// by the role-gated callers; the one caller that needs it (deleteProject's
// deleted_by) resolves it via getCurrentEmployeeId() only after its role gate.
async function getCallerRole(): Promise<{ userId: string; role: string | null }> {
  const { userId, role } = await getSessionContext();
  return { userId: userId ?? '', role };
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

  if (field === PROJECT_VALUE_FIELD) {
    if (!role || !PROJECT_VALUE_EDIT_ROLES.has(role)) {
      console.warn(`${op} Role ${role} blocked from editing ${field}`);
      return {
        success: false,
        error: 'Only the Project Manager can edit the Project Value.',
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

  // Fire-and-forget event emits for n8n on installation scheduling /
  // completion. Both keyed off project-level dates commonly set from the
  // detail page Timeline section.
  if (field === 'planned_start_date' && value) {
    void emitInstallationScheduled(projectId, String(value));
  }
  if (field === 'actual_end_date' && value) {
    void emitInstallationComplete(projectId, String(value));
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { success: true };
}

async function emitInstallationScheduled(
  projectId: string,
  plannedStartDate: string,
): Promise<void> {
  const op = '[emitInstallationScheduled]';
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from('projects')
      .select(
        'id, project_number, customer_name, customer_phone, site_city, system_size_kwp, project_manager_id, site_supervisor_id',
      )
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return;

    let projectManagerName: string | null = null;
    let projectManagerWhatsapp: string | null = null;
    if (project.project_manager_id) {
      const { data: pm } = await supabase
        .from('employees')
        .select('full_name, whatsapp_number')
        .eq('id', project.project_manager_id)
        .maybeSingle();
      projectManagerName = pm?.full_name ?? null;
      projectManagerWhatsapp = pm?.whatsapp_number ?? null;
    }

    let siteSupervisorWhatsapp: string | null = null;
    if (project.site_supervisor_id) {
      const { data: ss } = await supabase
        .from('employees')
        .select('whatsapp_number')
        .eq('id', project.site_supervisor_id)
        .maybeSingle();
      siteSupervisorWhatsapp = ss?.whatsapp_number ?? null;
    }

    await emitErpEvent('project.installation_scheduled', {
      project_id: project.id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      site_city: project.site_city,
      system_size_kwp: project.system_size_kwp,
      planned_start_date: plannedStartDate,
      project_manager_name: projectManagerName,
      project_manager_whatsapp: projectManagerWhatsapp,
      site_supervisor_whatsapp: siteSupervisorWhatsapp,
      erp_url: `https://erp.shiroienergy.com/projects/${project.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      projectId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

async function emitInstallationComplete(
  projectId: string,
  actualEndDate: string,
): Promise<void> {
  const op = '[emitInstallationComplete]';
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from('projects')
      .select(
        'id, project_number, customer_name, customer_phone, system_size_kwp, project_manager_id',
      )
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return;

    let projectManagerName: string | null = null;
    if (project.project_manager_id) {
      const { data: pm } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', project.project_manager_id)
        .maybeSingle();
      projectManagerName = pm?.full_name ?? null;
    }

    let liaisonLeadWhatsapp: string | null = null;
    const { data: liaison } = await supabase
      .from('employees')
      .select('whatsapp_number, profiles!inner(role)')
      .eq('profiles.role', 'sales_engineer')
      .limit(1)
      .maybeSingle();
    liaisonLeadWhatsapp = (liaison as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? null;

    await emitErpEvent('project.installation_complete', {
      project_id: project.id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      system_size_kwp: project.system_size_kwp,
      actual_end_date: actualEndDate,
      project_manager_name: projectManagerName,
      liaison_lead_whatsapp: liaisonLeadWhatsapp,
      erp_url: `https://erp.shiroienergy.com/projects/${project.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      projectId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
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
// Active-employee dropdown — delegates to the shared helper (2026-06-19 sweep §3).
export async function getActiveEmployeesLite(): Promise<{ id: string; full_name: string }[]> {
  return getActiveEmployeesForSelect();
}

const PROJECT_DELETE_ROLES = new Set<string>(['founder', 'project_manager']);

/**
 * Soft delete (deleted_at + deleted_by). Hard delete is impossible anyway —
 * a dozen RESTRICT FKs (invoices, payments, POs…) reference projects.
 * Restore is DB-only by design (2026-06-11 spec).
 */
export async function deleteProject(input: {
  projectId: string;
  confirmNumber: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteProject]';
  const { role } = await getCallerRole();
  if (!role || !PROJECT_DELETE_ROLES.has(role)) {
    return { success: false, error: 'Only Project Managers and Founders can delete projects.' };
  }
  const employeeId = await getCurrentEmployeeId();
  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from('projects')
    .select('project_number, deleted_at')
    .eq('id', input.projectId)
    .maybeSingle();
  if (readErr || !project) return { success: false, error: readErr?.message ?? 'Project not found' };
  if (project.deleted_at) return { success: false, error: 'Project is already deleted.' };
  if ((project.project_number ?? '') !== input.confirmNumber.trim()) {
    return { success: false, error: 'Confirmation text does not match the project number.' };
  }
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString(), deleted_by: employeeId ?? null } as any)
    .eq('id', input.projectId);
  if (error) {
    console.error(`${op} Soft delete failed:`, { code: error.code, message: error.message, projectId: input.projectId });
    return { success: false, error: error.message };
  }
  revalidatePath('/projects');
  return { success: true };
}

/**
 * Search contacts by name/phone/email for the Customer Information
 * picker on the detail page.
 */
export async function searchContactsLite(
  query: string,
): Promise<{ id: string; name: string; phone: string | null; email: string | null }[]> {
  const supabase = await createClient();
  // Item 2b — typed RPC replaces the conditional .or() interpolation. Empty
  // query falls back to "list all up to limit" inside the RPC (the
  // `p_query IS NULL` branch). See
  // supabase/migrations/155_2026-05-31-search-rpcs-purchase.sql.
  // The `as any` cast is a temporary bridge — parent agent regenerates
  // packages/types/database.ts at the end of this batch, after which the
  // cast can be removed.
  const trimmed = query.trim();
  const { data, error } = await supabase.rpc('search_contacts_lite', {
    p_query: trimmed.length > 0 ? trimmed : undefined,
    p_limit: 20,
  });

  if (error) {
    console.error('[searchContactsLite] Failed:', error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string; phone: string | null; email: string | null }[];
}

export interface ProjectSearchHit {
  id: string;
  project_number: string | null;
  customer_name: string | null;
  project_name: string | null;
}

export async function searchProjectsLite(query: string): Promise<ProjectSearchHit[]> {
  const op = '[searchProjectsLite]';
  const supabase = await createClient();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await supabase.rpc('search_projects_lite', {
    p_query: trimmed,
    p_limit: 8,
  });
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((r: { id: string; project_number: string | null; customer_name: string | null; project_name: string | null }) => ({
    id: r.id, project_number: r.project_number, customer_name: r.customer_name, project_name: r.project_name,
  }));
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

  // mig 195: one SQL pass (contracted value + BOQ total + approved site-expense
  // total + margin) replaces 3 parallel reads + a JS .reduce over money rows
  // (NEVER-DO #12). Returns zeros for a missing / RLS-filtered project.
  const { data } = await supabase.rpc('get_project_financials', { p_project_id: projectId });
  const f = (data ?? {}) as unknown as {
    contracted_value: number;
    boq_total: number;
    site_expenses_total: number;
    actual_expenses: number;
    margin_amount: number;
    margin_pct: number;
  };

  return {
    contractedValue: Number(f.contracted_value ?? 0),
    actualExpenses: Number(f.actual_expenses ?? 0),
    boqTotal: Number(f.boq_total ?? 0),
    siteExpensesTotal: Number(f.site_expenses_total ?? 0),
    marginAmount: Number(f.margin_amount ?? 0),
    marginPct: Number(f.margin_pct ?? 0),
  };
}
