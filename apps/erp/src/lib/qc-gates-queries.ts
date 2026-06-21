import { createClient } from '@repo/supabase/server';

/**
 * QC gate inspections for the /qc-gates list. Lives in a query file (NEVER-DO
 * #15: no inline Supabase in a page) and selects only the displayed columns
 * (was SELECT *). The select must be a single string literal — Supabase infers
 * the embed types from it, so concatenation would degrade the type to `string`.
 */
export async function listQCGateInspections(limit = 100) {
  const op = '[listQCGateInspections]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('qc_gate_inspections')
    .select(
      'id, gate_number, inspection_date, overall_result, failure_notes, conditional_notes, projects!qc_gate_inspections_project_id_fkey(project_number, customer_name), inspector:employees!qc_gate_inspections_inspected_by_fkey(full_name)',
    )
    .order('inspection_date', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
