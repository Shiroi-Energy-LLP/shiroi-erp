'use server';

import { createReport, updateReport, createSitePhoto } from '@/lib/site-report-queries';

interface SubmitReportInput {
  reportId?: string;
  projectId: string;
  userId: string;
  reportDate: string;
  panelsInstalledToday: number;
  panelsInstalledCumulative: number;
  workersCount: number;
  supervisorsCount: number;
  weather: string;
  weatherDelay: boolean;
  weatherDelayHours: number | null;
  workDescription: string;
  structureProgress: string | null;
  electricalProgress: string | null;
  materialsReceived: boolean;
  materialsSummary: string | null;
  issuesReported: boolean;
  issueSummary: string | null;
  pmVisited: boolean;
  otherVisitors: string | null;
  photos: Array<{
    storagePath: string;
    fileName: string;
    caption: string;
    fileSizeBytes: number;
  }>;
}

export async function submitReportAction(
  input: SubmitReportInput,
): Promise<{ error?: string; reportId?: string }> {
  const op = '[submitReportAction]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  try {
    if (!input.reportDate) {
      return { error: 'Report date is required.' };
    }
    if (!input.workDescription) {
      return { error: 'Work description is required.' };
    }

    let reportId: string;

    if (input.reportId) {
      // Update existing
      const result = await updateReport(input.reportId, {
        report_date: input.reportDate,
        panels_installed_today: input.panelsInstalledToday,
        panels_installed_cumulative: input.panelsInstalledCumulative,
        workers_count: input.workersCount,
        supervisors_count: input.supervisorsCount,
        weather: input.weather,
        weather_delay: input.weatherDelay,
        weather_delay_hours: input.weatherDelayHours,
        work_description: input.workDescription,
        structure_progress: input.structureProgress,
        electrical_progress: input.electricalProgress,
        materials_received: input.materialsReceived,
        materials_summary: input.materialsSummary,
        issues_reported: input.issuesReported,
        issue_summary: input.issueSummary,
        pm_visited: input.pmVisited,
        other_visitors: input.otherVisitors,
      });
      reportId = result.id;
    } else {
      // Create new
      const result = await createReport({
        id: crypto.randomUUID(),
        project_id: input.projectId,
        submitted_by: input.userId,
        report_date: input.reportDate,
        panels_installed_today: input.panelsInstalledToday,
        panels_installed_cumulative: input.panelsInstalledCumulative,
        workers_count: input.workersCount,
        supervisors_count: input.supervisorsCount,
        weather: input.weather,
        weather_delay: input.weatherDelay,
        weather_delay_hours: input.weatherDelayHours,
        work_description: input.workDescription,
        structure_progress: input.structureProgress,
        electrical_progress: input.electricalProgress,
        materials_received: input.materialsReceived,
        materials_summary: input.materialsSummary,
        issues_reported: input.issuesReported,
        issue_summary: input.issueSummary,
        pm_visited: input.pmVisited,
        other_visitors: input.otherVisitors,
        created_on_device_at: new Date().toISOString(),
        sync_status: 'synced',
      });
      reportId = result.id;
    }

    // Link uploaded photos to this report
    for (const photo of input.photos) {
      await createSitePhoto({
        id: crypto.randomUUID(),
        daily_report_id: reportId,
        project_id: input.projectId,
        uploaded_by: input.userId,
        file_name: photo.fileName,
        storage_path: photo.storagePath,
        file_size_bytes: photo.fileSizeBytes,
        caption: photo.caption || null,
        photo_type: 'site_progress',
        sync_status: 'synced',
      });
    }

    return { reportId };
  } catch (error) {
    console.error(`${op} Failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return { error: error instanceof Error ? error.message : 'Failed to submit report.' };
  }
}
