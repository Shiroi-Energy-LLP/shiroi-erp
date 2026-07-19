import { createClient } from '@repo/supabase/server';

export type EmployeeSelectOption = { id: string; full_name: string };

/**
 * The active-employee list behind every "assign to" / "owner" / engineer
 * dropdown across the ERP. Five byte-identical copies — getActiveEmployees
 * (tasks-actions), getActiveEmployeesForProject (project-milestone-actions),
 * getActiveEmployeesLite (project-detail-actions), listEmployeesForSelect
 * (sales-territories-queries) and getSalesEngineers (leads-queries) — were
 * collapsed onto this one (2026-06-19 redundancy sweep §3). NONE of them
 * filtered by task / project / role despite their names; they all return every
 * active employee. Those five now delegate here. Returns [] on error so a
 * transient failure renders an empty dropdown rather than crashing the page.
 *
 * Reads employee_directory (mig 201), not employees: employees_read RLS limits
 * non-founder/HR roles to self + direct reports, which emptied the dropdown
 * for everyone else. The view exposes names only, bypassing that policy safely.
 */
export async function getActiveEmployeesForSelect(): Promise<EmployeeSelectOption[]> {
  const op = '[getActiveEmployeesForSelect]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_directory')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []) as EmployeeSelectOption[];
}
