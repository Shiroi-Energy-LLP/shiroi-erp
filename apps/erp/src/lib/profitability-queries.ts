import { createClient } from '@repo/supabase/server';

export async function getProjectProfitability(filters: { status?: string } = {}) {
  const op = '[getProjectProfitability]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  // Get projects with their profitability data — filter in DB, not JS
  let query = supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, contracted_value, status, profitability:project_profitability(total_cost_actual, total_revenue, gross_margin_pct, gross_profit)')
    .is('deleted_at', null);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query.order('project_number', { ascending: false }).limit(200);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load profitability: ${error.message}`);
  }

  return (data ?? []).map(p => {
    // profitability is an array (one-to-many), take the latest entry
    const prof = Array.isArray(p.profitability) ? p.profitability[0] : null;
    return {
      id: p.id,
      project_number: p.project_number,
      customer_name: p.customer_name,
      system_size_kwp: p.system_size_kwp,
      contracted_value: p.contracted_value,
      status: p.status,
      actual_cost: prof?.total_cost_actual ?? null,
      margin: prof?.gross_margin_pct ?? null,
    };
  });
}
