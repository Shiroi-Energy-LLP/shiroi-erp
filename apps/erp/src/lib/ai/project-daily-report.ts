'use server';

/**
 * E8 — AI Project Daily Report Narrative
 *
 * Generates a 3-paragraph narrative summary for a project's day.
 * The narrative is cached for 1 hour per project so repeat calls
 * from the UI don't burn API quota.
 *
 * Called from the project detail page "AI Summary" button.
 */

import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { generateText, MAX_TOKENS_GENERATION } from './anthropic-client';

const CACHE = new Map<string, { narrative: string; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCached(projectId: string): string | null {
  const entry = CACHE.get(projectId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    CACHE.delete(projectId);
    return null;
  }
  return entry.narrative;
}

function setCache(projectId: string, narrative: string): void {
  CACHE.set(projectId, { narrative, cachedAt: Date.now() });
}

export async function generateProjectDailyReport(
  projectId: string,
): Promise<ActionResult<{ narrative: string; cached: boolean }>> {
  const op = '[generateProjectDailyReport]';

  if (!projectId) return err('projectId is required');

  // Check cache first
  const cached = getCached(projectId);
  if (cached) {
    return ok({ narrative: cached, cached: true });
  }

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 1. Project context
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('project_number, customer_name, system_size_kwp, system_type, site_city, status')
    .eq('id', projectId)
    .maybeSingle();

  if (projErr || !project) {
    console.error(`${op} project fetch failed`, { projectId, error: projErr?.message, timestamp: new Date().toISOString() });
    return err(projErr?.message ?? 'Project not found');
  }

  // 2. Today's site reports
  const { data: siteReports } = await supabase
    .from('daily_site_reports')
    .select('report_date, work_completed, panels_installed, inverters_installed, wiring_completed, photos_uploaded, weather, manpower_count, notes')
    .eq('project_id', projectId)
    .eq('report_date', today)
    .limit(5);

  // 3. Today's tasks completed
  const { data: tasks } = await supabase
    .from('project_tasks')
    .select('title, status, completed_at')
    .eq('project_id', projectId)
    .eq('status', 'done')
    .gte('completed_at', today)
    .limit(10);

  // 4. Today's expenses
  const { data: expenses } = await supabase
    .from('expenses')
    .select('description, amount, category')
    .eq('project_id', projectId)
    .gte('created_at', today)
    .limit(10);

  // 5. Recent milestones hit
  const { data: milestones } = await supabase
    .from('project_milestones')
    .select('name, completed_at')
    .eq('project_id', projectId)
    .eq('status', 'completed')
    .gte('completed_at', today)
    .limit(5);

  // 6. Photos uploaded today
  const { data: photos } = await supabase
    .from('milestone_photos')
    .select('milestone, uploaded_at')
    .eq('project_id', projectId)
    .gte('uploaded_at', today)
    .limit(10);

  // Build context for the prompt
  const contextParts: string[] = [
    `Project: ${project.project_number} — ${project.customer_name}`,
    `System: ${project.system_size_kwp} kWp ${project.system_type ?? ''}`,
    `Location: ${project.site_city ?? 'Chennai'}`,
    `Status: ${project.status}`,
    `Date: ${today}`,
    '',
  ];

  if (siteReports && siteReports.length > 0) {
    contextParts.push('=== Site Report ===');
    for (const r of siteReports) {
      if (r.work_completed) contextParts.push(`Work completed: ${r.work_completed}`);
      if (r.panels_installed) contextParts.push(`Panels installed today: ${r.panels_installed}`);
      if (r.inverters_installed) contextParts.push(`Inverters installed today: ${r.inverters_installed}`);
      if (r.wiring_completed) contextParts.push(`Wiring: ${r.wiring_completed}`);
      if (r.manpower_count) contextParts.push(`Manpower: ${r.manpower_count} workers`);
      if (r.weather) contextParts.push(`Weather: ${r.weather}`);
      if (r.notes) contextParts.push(`Notes: ${r.notes}`);
    }
    contextParts.push('');
  }

  if (tasks && tasks.length > 0) {
    contextParts.push('=== Tasks Completed Today ===');
    for (const t of tasks) contextParts.push(`- ${t.title}`);
    contextParts.push('');
  }

  if (milestones && milestones.length > 0) {
    contextParts.push('=== Milestones Reached Today ===');
    for (const m of milestones) contextParts.push(`- ${m.name}`);
    contextParts.push('');
  }

  if (photos && photos.length > 0) {
    contextParts.push('=== Photos Uploaded Today ===');
    for (const p of photos) contextParts.push(`- ${p.milestone}`);
    contextParts.push('');
  }

  if (expenses && expenses.length > 0) {
    contextParts.push('=== Expenses Logged Today ===');
    for (const e of expenses) contextParts.push(`- ${e.category}: ${e.description} (₹${e.amount})`);
    contextParts.push('');
  }

  const context = contextParts.join('\n');

  const systemPrompt = `You are a project update writer for Shiroi Energy LLP, a solar EPC company in Chennai, India.
Write clear, professional daily progress narratives for solar installation projects.
Your audience is the founder Vivek and project managers.
Write in English. Be factual, concise, and positive.
If there's no data for a section, skip it gracefully.`;

  const userMessage = `Write a 3-paragraph daily progress narrative for this solar project.

Paragraph 1: Today's key accomplishments and work completed.
Paragraph 2: Any notable milestones, expenses, or photos. Highlight progress against the project timeline.
Paragraph 3: Brief outlook — what's likely next, any concerns to flag.

Project data:
${context}

If very little data is available, write a brief 2-3 sentence update acknowledging the limited data and suggesting the site supervisor file a complete report.`;

  const narrative = await generateText(systemPrompt, userMessage, MAX_TOKENS_GENERATION);

  if (!narrative) {
    return err('AI narrative generation failed. Check ANTHROPIC_API_KEY configuration.');
  }

  setCache(projectId, narrative);

  console.log(`${op} generated narrative for project ${projectId}`, { chars: narrative.length, timestamp: new Date().toISOString() });

  return ok({ narrative, cached: false });
}
