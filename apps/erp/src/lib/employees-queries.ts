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
 */
export async function getActiveEmployeesForSelect(): Promise<EmployeeSelectOption[]> {
  const op = '[getActiveEmployeesForSelect]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []) as EmployeeSelectOption[];
}
