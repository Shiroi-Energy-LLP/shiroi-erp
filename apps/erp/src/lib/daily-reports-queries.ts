import { createClient } from '@repo/supabase/server';

/**
 * Daily site reports for the /daily-reports list. Lives in a query file
 * (NEVER-DO #15: no inline Supabase in a page) and selects only the displayed
 * columns (was SELECT *). Single string-literal select — Supabase infers the
 * embed types from it.
 */
export async function listDailySiteReports(limit = 100) {
  const op = '[listDailySiteReports]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .select(
      'id, report_date, weather, workers_count, panels_installed_today, is_locked, created_at, projects!daily_site_reports_project_id_fkey(project_number, customer_name)',
    )
    .order('report_date', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
