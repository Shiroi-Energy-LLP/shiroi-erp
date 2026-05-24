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
    .select('report_date, work_description, panels_installed_today, structure_progress, electrical_progress, weather, workers_count, supervisors_count, issue_summary')
    .eq('project_id', projectId)
    .eq('report_date', today)
    .limit(5);

  // 3. Today's tasks completed (project-scoped tasks only)
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, completed_at')
    .eq('project_id', projectId)
    .eq('entity_type', 'project')
    .eq('is_completed', true)
    .gte('completed_at', today)
    .limit(10);

  // 4. Today's expenses (join category for label)
  const { data: expenses } = await supabase
    .from('expenses')
    .select('description, amount, expense_categories(label)')
    .eq('project_id', projectId)
    .gte('created_at', today)
    .limit(10);

  // 5. Recent milestones hit
  const { data: milestones } = await supabase
    .from('project_milestones')
    .select('milestone_name, actual_end_date')
    .eq('project_id', projectId)
    .eq('status', 'completed')
    .gte('actual_end_date', today)
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
      if (r.work_description) contextParts.push(`Work: ${r.work_description}`);
      if (r.panels_installed_today) contextParts.push(`Panels installed today: ${r.panels_installed_today}`);
      if (r.structure_progress) contextParts.push(`Structure: ${r.structure_progress}`);
      if (r.electrical_progress) contextParts.push(`Electrical: ${r.electrical_progress}`);
      const manpower = (r.workers_count ?? 0) + (r.supervisors_count ?? 0);
      if (manpower > 0) contextParts.push(`Manpower: ${manpower} on site`);
      if (r.weather) contextParts.push(`Weather: ${r.weather}`);
      if (r.issue_summary) contextParts.push(`Issues: ${r.issue_summary}`);
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
    for (const m of milestones) contextParts.push(`- ${m.milestone_name}`);
    contextParts.push('');
  }

  if (photos && photos.length > 0) {
    contextParts.push('=== Photos Uploaded Today ===');
    for (const p of photos) contextParts.push(`- ${p.milestone}`);
    contextParts.push('');
  }

  if (expenses && expenses.length > 0) {
    contextParts.push('=== Expenses Logged Today ===');
    for (const e of expenses) {
      const cat = Array.isArray(e.expense_categories)
        ? e.expense_categories[0]?.label
        : (e.expense_categories as { label: string } | null)?.label;
      contextParts.push(`- ${cat ?? 'Misc'}: ${e.description ?? ''} (₹${e.amount})`);
    }
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
