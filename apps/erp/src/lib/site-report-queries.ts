import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type DailyReportRow = Database['public']['Tables']['daily_site_reports']['Row'];
type DailyReportInsert = Database['public']['Tables']['daily_site_reports']['Insert'];
type SitePhotoInsert = Database['public']['Tables']['site_photos']['Insert'];
type CorrectionInsert = Database['public']['Tables']['site_report_corrections']['Insert'];

/** Minimal project info needed when creating a new daily report. */
export interface ProjectForReport {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  system_type: string;
  status: string;
}

/**
 * Fetches the list of daily site reports for a given project, ordered by date desc.
 * Includes submitter name for display.
 */
export async function getProjectReports(projectId: string) {
  const op = '[getProjectReports]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .select(
      'id, report_date, panels_installed_today, panels_installed_cumulative, workers_count, supervisors_count, issues_reported, issue_summary, is_locked, has_correction, weather, created_at, submitted_by, employees!daily_site_reports_submitted_by_fkey(full_name)',
    )
    .eq('project_id', projectId)
    .order('report_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load project reports: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Fetches a single report by ID, including photos and submitter info.
 */
export async function getReport(id: string) {
  const op = '[getReport]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .select(
      '*, employees!daily_site_reports_submitted_by_fkey(full_name), site_photos!site_photos_daily_report_id_fkey(*)',
    )
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load report: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { id });
    return null;
  }
  return data;
}

/**
 * Fetches the most recent report for a project, used to pre-populate defaults.
 */
export async function getLastReport(projectId: string) {
  const op = '[getLastReport]';
  console.log(`${op} Starting for: ${projectId}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .select('workers_count, supervisors_count, panels_installed_cumulative')
    .eq('project_id', projectId)
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    return null; // Non-critical — we just won't pre-populate
  }
  return data;
}

/**
 * Fetches minimal project info for pre-populating the new report form.
 */
export async function getProjectForReport(projectId: string): Promise<ProjectForReport | null> {
  const op = '[getProjectForReport]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, system_type, status')
    .eq('id', projectId)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load project: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { projectId });
    return null;
  }
  return data;
}

/**
 * Creates a new daily site report.
 */
export async function createReport(report: DailyReportInsert) {
  const op = '[createReport]';
  console.log(`${op} Starting for project: ${report.project_id}, date: ${report.report_date}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .insert(report)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, {
      code: error.code,
      message: error.message,
      projectId: report.project_id,
    });
    throw new Error(`Failed to create report: ${error.message}`);
  }
  return data;
}

/**
 * Updates an existing report (only if not locked).
 */
export async function updateReport(
  id: string,
  updates: Database['public']['Tables']['daily_site_reports']['Update'],
) {
  const op = '[updateReport]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_site_reports')
    .update(updates)
    .eq('id', id)
    .eq('is_locked', false)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to update report: ${error.message}`);
  }
  return data;
}

/**
 * Inserts a site photo record (file already uploaded to Supabase Storage).
 */
export async function createSitePhoto(photo: SitePhotoInsert) {
  const op = '[createSitePhoto]';
  console.log(`${op} Starting for report: ${photo.daily_report_id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_photos')
    .insert(photo)
    .select('id, storage_path')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to create photo record: ${error.message}`);
  }
  return data;
}

/**
 * Creates a correction request for a locked report (Tier 2).
 */
export async function createCorrectionRequest(correction: CorrectionInsert) {
  const op = '[createCorrectionRequest]';
  console.log(`${op} Starting for report: ${correction.original_report_id}`);

  const supabase = await createClient();

  // Insert correction and flag original report
  const { data, error } = await supabase
    .from('site_report_corrections')
    .insert(correction)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to create correction request: ${error.message}`);
  }

  // Flag original report
  const { error: flagError } = await supabase
    .from('daily_site_reports')
    .update({ has_correction: true })
    .eq('id', correction.original_report_id);

  if (flagError) {
    console.error(`${op} Failed to flag original report:`, {
      code: flagError.code,
      message: flagError.message,
    });
    // Non-fatal — correction was created, flag is secondary
  }

  return data;
}

/**
 * Fetches corrections for a specific report.
 */
export async function getReportCorrections(reportId: string) {
  const op = '[getReportCorrections]';
  console.log(`${op} Starting for: ${reportId}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_report_corrections')
    .select(
      '*, requester:employees!site_report_corrections_requested_by_fkey(full_name), approver:employees!site_report_corrections_approved_by_fkey(full_name)',
    )
    .eq('original_report_id', reportId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, reportId });
    throw new Error(`Failed to load corrections: ${error.message}`);
  }
  return data ?? [];
}
