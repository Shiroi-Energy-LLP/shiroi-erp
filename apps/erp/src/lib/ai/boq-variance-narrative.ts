'use server';

/**
 * S5 — F7 BOQ Variance Narrative
 *
 * Reads variance rows from bom_actual_vs_budgetary for a project,
 * calls Claude Haiku to write a 2-paragraph post-mortem narrative,
 * then saves the result to projects.boq_variance_narrative.
 *
 * Called by:
 *  - boq-variance-actions.ts (manual trigger from UI)
 *  - /api/boq-variance/generate-recent (nightly cron endpoint)
 */

import { createAdminClient } from '@repo/supabase/admin';
import { generateText } from './anthropic-client';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

const HAIKU_MODEL = 'claude-haiku-4-5' as const;
const NARRATIVE_MAX_TOKENS = 512;

type BomRow = Database['public']['Tables']['bom_actual_vs_budgetary']['Row'];

export interface VarianceRow {
  category: string;
  budgeted_qty: number | null;
  actual_qty: number | null;
  variance_pct: number | null;
  budgeted_total: number | null;
  actual_total: number | null;
  variance_amount: number | null;
}

interface ProjectInfo {
  project_number: string;
  customer_name: string;
  system_size_kwp: number | null;
  system_type: Database['public']['Enums']['system_type'] | null;
}

/**
 * Compute variance percentage safely (returns null if either qty is null/zero).
 * Variance is expressed as (actual - budgeted) / budgeted * 100.
 * Positive = over-budget, Negative = under-budget.
 */
function computeVariancePct(budgeted: number | null, actual: number | null): number | null {
  if (budgeted == null || actual == null || budgeted === 0) return null;
  return ((actual - budgeted) / budgeted) * 100;
}

/**
 * Build a human-readable variance summary for the top over- and under-budget
 * categories. Variance is sorted by absolute variance_amount descending.
 */
function buildVarianceSummary(rows: VarianceRow[]): string {
  const withVariance = rows.filter(
    (r) => r.variance_amount != null && r.variance_pct != null,
  );

  const sorted = [...withVariance].sort(
    (a, b) => Math.abs(b.variance_amount ?? 0) - Math.abs(a.variance_amount ?? 0),
  );

  const over = sorted.filter((r) => (r.variance_pct ?? 0) > 0).slice(0, 3);
  const under = sorted.filter((r) => (r.variance_pct ?? 0) < 0).slice(0, 3);

  const lines: string[] = [];

  if (over.length > 0) {
    lines.push('Over-budget categories:');
    for (const r of over) {
      const pct = r.variance_pct?.toFixed(1) ?? 'N/A';
      const amt = r.variance_amount != null ? `₹${Math.abs(r.variance_amount).toLocaleString('en-IN')}` : 'N/A';
      lines.push(
        `  • ${r.category}: budgeted ${r.budgeted_qty ?? '?'} units (₹${r.budgeted_total?.toLocaleString('en-IN') ?? '?'}) → actual ${r.actual_qty ?? '?'} units (₹${r.actual_total?.toLocaleString('en-IN') ?? '?'}) | +${pct}% | +${amt} over`,
      );
    }
  }

  if (under.length > 0) {
    lines.push('Under-budget categories:');
    for (const r of under) {
      const pct = Math.abs(r.variance_pct ?? 0).toFixed(1);
      const amt = r.variance_amount != null ? `₹${Math.abs(r.variance_amount).toLocaleString('en-IN')}` : 'N/A';
      lines.push(
        `  • ${r.category}: budgeted ${r.budgeted_qty ?? '?'} units (₹${r.budgeted_total?.toLocaleString('en-IN') ?? '?'}) → actual ${r.actual_qty ?? '?'} units (₹${r.actual_total?.toLocaleString('en-IN') ?? '?'}) | -${pct}% | ${amt} saved`,
      );
    }
  }

  if (lines.length === 0) {
    return 'No significant variances detected across all BOQ categories.';
  }

  return lines.join('\n');
}

/**
 * generateBoqVarianceNarrative — main export.
 *
 * Fetches variance data from bom_actual_vs_budgetary, calls Claude Haiku,
 * saves the narrative back to projects.boq_variance_narrative.
 */
export async function generateBoqVarianceNarrative(
  projectId: string,
): Promise<ActionResult<{ narrative: string; tokens_used: number }>> {
  const op = '[generateBoqVarianceNarrative]';

  if (!projectId) {
    return err('projectId is required');
  }

  const admin = createAdminClient();

  // 1. Fetch project basic info
  const { data: project, error: projErr } = await admin
    .from('projects')
    .select('project_number, customer_name, system_size_kwp, system_type')
    .eq('id', projectId)
    .maybeSingle();

  if (projErr) {
    console.error(`${op} project fetch failed`, { projectId, error: projErr.message, timestamp: new Date().toISOString() });
    return err(projErr.message);
  }
  if (!project) {
    return err('Project not found');
  }

  // Cast via unknown to avoid Supabase SelectQueryError type bubbling up
  // when tsc can't resolve the select string against the schema at compile time.
  const projectData = project as unknown as {
    project_number: string;
    customer_name: string;
    system_size_kwp: number | null;
    system_type: string | null;
  };
  const info: ProjectInfo = {
    project_number: projectData.project_number,
    customer_name: projectData.customer_name,
    system_size_kwp: projectData.system_size_kwp,
    system_type: projectData.system_type as ProjectInfo['system_type'],
  };

  // 2. Fetch variance rows from bom_actual_vs_budgetary
  const { data: bomRows, error: bomErr } = await admin
    .from('bom_actual_vs_budgetary')
    .select('category, budgetary_qty, actual_qty, budgetary_total_cost, actual_total_cost')
    .eq('project_id', projectId)
    .order('category');

  if (bomErr) {
    console.error(`${op} bom fetch failed`, { projectId, error: bomErr.message, timestamp: new Date().toISOString() });
    return err(bomErr.message);
  }

  // 3. If 0 rows: bail with a descriptive error
  if (!bomRows || bomRows.length === 0) {
    return err('No variance data available for this project');
  }

  // 4. Compute variance for each row (in JS only for display — no money reduce)
  const varianceRows: VarianceRow[] = (bomRows as BomRow[]).map((r) => {
    const variance_pct = computeVariancePct(r.budgetary_total_cost, r.actual_total_cost);
    const variance_amount =
      r.actual_total_cost != null && r.budgetary_total_cost != null
        ? r.actual_total_cost - r.budgetary_total_cost
        : null;
    return {
      category: r.category,
      budgeted_qty: r.budgetary_qty,
      actual_qty: r.actual_qty,
      variance_pct,
      budgeted_total: r.budgetary_total_cost,
      actual_total: r.actual_total_cost,
      variance_amount,
    };
  });

  // 5. Build prompt
  const varianceSummary = buildVarianceSummary(varianceRows);

  const systemPrompt =
    'You write 2-paragraph BOQ variance narratives for solar project post-mortems at Shiroi Energy, a solar EPC company in Chennai, India. ' +
    'Tone: factual, actionable. Cite specific categories with % variance. ' +
    'End with a one-line takeaway for the next project. ' +
    'Do not use bullet points — write in flowing paragraphs. ' +
    'Keep the total response under 200 words.';

  const userMessage =
    `Project: ${info.project_number} (${info.customer_name}, ${info.system_size_kwp ?? '?'} kWp ${info.system_type ?? ''})\n\n` +
    `Variance summary:\n${varianceSummary}\n\n` +
    `Write a 2-paragraph BOQ variance narrative.`;

  // 6. Call Claude Haiku
  const narrative = await generateText(systemPrompt, userMessage, NARRATIVE_MAX_TOKENS);

  if (!narrative) {
    console.error(`${op} AI call returned null`, { projectId, timestamp: new Date().toISOString() });
    return err('AI narrative generation failed — check ANTHROPIC_API_KEY');
  }

  // 7. Persist narrative back to projects table
  const model = HAIKU_MODEL;
  const { error: updateErr } = await admin
    .from('projects')
    .update({
      boq_variance_narrative: narrative,
      boq_variance_narrative_at: new Date().toISOString(),
      boq_variance_narrative_model: model,
    })
    .eq('id', projectId);

  if (updateErr) {
    console.error(`${op} failed to save narrative`, { projectId, error: updateErr.message, timestamp: new Date().toISOString() });
    return err(updateErr.message);
  }

  console.log(`${op} narrative saved for project ${projectId}`, {
    chars: narrative.length,
    model,
    timestamp: new Date().toISOString(),
  });

  // tokens_used is not available through generateText; return 0 as sentinel
  return ok({ narrative, tokens_used: 0 });
}
