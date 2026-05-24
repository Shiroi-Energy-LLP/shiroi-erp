'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { callAi } from '@/lib/ai/ai-caller';

/**
 * Generate an AI narrative summary for a daily site report using Claude API.
 * The narrative transforms raw field data into a readable paragraph for PMs.
 */
export async function generateAINarrative(
  reportId: string,
  projectId: string
): Promise<{ success: boolean; narrative?: string; error?: string }> {
  const op = '[generateAINarrative]';
  console.log(`${op} Starting for report: ${reportId}`);

  if (!reportId) return { success: false, error: 'Missing report ID' };

  const supabase = await createClient();

  // Fetch the report with project context
  const { data: report, error: reportErr } = await supabase
    .from('daily_site_reports')
    .select('*, projects(project_number, customer_name, system_size_kwp, system_type, site_city)')
    .eq('id', reportId)
    .single();

  if (reportErr || !report) {
    console.error(`${op} Report fetch failed:`, reportErr?.message);
    return { success: false, error: 'Report not found' };
  }

  // Build the prompt
  const project = (report as Record<string, unknown>).projects;
  const prompt = buildNarrativePrompt(report, project);

  try {
    // Call AI via provider-agnostic helper (anthropic by default; switch to openrouter via AI_PROVIDER env)
    const narrative = await callAi(prompt, { maxTokens: 500 });

    if (!narrative) {
      return { success: false, error: 'AI returned empty response' };
    }

    // Save narrative to the report. Cast required because database.ts types may not yet include
    // ai_narrative columns if typegen was run before this migration was applied.
    const updatePayload = {
      ai_narrative: narrative,
      ai_narrative_generated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    const { error: updateErr } = await supabase
      .from('daily_site_reports')
      .update(updatePayload)
      .eq('id', reportId);

    if (updateErr) {
      console.error(`${op} Update failed:`, updateErr.message);
      // Still return the narrative even if save failed
      return { success: true, narrative };
    }

    revalidatePath(`/projects/${projectId}/reports`);
    revalidatePath('/daily-reports');

    console.log(`${op} Narrative generated successfully (${narrative.length} chars)`);
    return { success: true, narrative };
  } catch (error) {
    console.error(`${op} Failed:`, error instanceof Error ? error.message : String(error));
    return { success: false, error: 'Failed to generate narrative' };
  }
}

function buildNarrativePrompt(
  report: Record<string, unknown>,
  project: Record<string, unknown> | null | undefined,
): string {
  const projectInfo = project
    ? `Project: ${String(project.project_number ?? '')} — ${String(project.customer_name ?? '')}, ${String(project.site_city ?? 'unknown location')}, ${String(project.system_size_kwp ?? '?')} kWp ${String(project.system_type ?? '').replace(/_/g, ' ')} system.`
    : 'Project details unavailable.';

  const weatherMap: Record<string, string> = {
    sunny: 'sunny',
    partly_cloudy: 'partly cloudy',
    cloudy: 'cloudy/overcast',
    rainy: 'rainy',
    stormy: 'stormy',
  };

  const structureMap: Record<string, string> = {
    not_started: 'not started',
    columns_done: 'columns complete',
    rails_done: 'rails installed',
    bracing_done: 'bracing done',
    complete: 'fully complete',
  };

  const electricalMap: Record<string, string> = {
    not_started: 'not started',
    inverter_mounted: 'inverter mounted',
    acdb_done: 'ACDB wired',
    strings_done: 'string wiring done',
    ac_cable_done: 'AC cabling done',
    complete: 'fully complete',
  };

  const parts: string[] = [
    `You are writing a brief daily site report summary for a solar EPC project manager in India.`,
    `Write a concise 3-5 sentence narrative summarizing the day's work. Use professional but conversational tone. Mention key progress, any issues, and workforce details. Do NOT use bullet points or headers — write flowing prose. Use Indian English conventions.`,
    ``,
    projectInfo,
    `Date: ${report.report_date}`,
    `Weather: ${weatherMap[report.weather] ?? report.weather}${report.weather_delay ? ` (caused ${report.weather_delay_hours ?? '?'} hours delay)` : ''}`,
    `Workforce: ${report.workers_count ?? 0} workers, ${report.supervisors_count ?? 0} supervisors`,
    `Panels installed today: ${report.panels_installed_today ?? 0} (cumulative: ${report.panels_installed_cumulative ?? 0})`,
    `Structure progress: ${structureMap[report.structure_progress] ?? report.structure_progress ?? 'not reported'}`,
    `Electrical progress: ${electricalMap[report.electrical_progress] ?? report.electrical_progress ?? 'not reported'}`,
  ];

  if (report.work_description) {
    parts.push(`Supervisor's description: "${report.work_description}"`);
  }

  if (report.issues_reported && report.issue_summary) {
    parts.push(`Issues reported: ${report.issue_summary}`);
  }

  if (report.materials_received && report.materials_summary) {
    parts.push(`Materials received: ${report.materials_summary}`);
  }

  if (report.pm_visited) {
    parts.push('PM visited site today.');
  }

  if (report.other_visitors) {
    parts.push(`Other visitors: ${report.other_visitors}`);
  }

  return parts.join('\n');
}
