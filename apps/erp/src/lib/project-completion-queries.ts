import { createClient } from '@repo/supabase/server';

/**
 * Weighted milestone completion % via the get_project_completion_pct RPC
 * (rewritten in mig 173: task-ratio per milestone × master-table weight).
 * The manual project_completion_items checklist is deprecated — table kept,
 * UI removed 2026-06-10.
 */
export async function getProjectCompletionPct(projectId: string): Promise<number> {
  const op = '[getProjectCompletionPct]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc('get_project_completion_pct', { p_project_id: projectId });

  if (error) {
    console.error(`${op} RPC failed`, { code: error.code, message: error.message, projectId });
    return 0;
  }

  return Number(data ?? 0);
}

export interface MilestoneProgressRow {
  id: string;
  milestoneName: string;
  weight: number;
  totalTasks: number;
  doneTasks: number;
  pct: number;
}

export interface MilestoneProgressData {
  overallPct: number;
  rows: MilestoneProgressRow[];
}

/**
 * Data for the Progress tab's weighted milestone breakdown. Mirrors the
 * get_project_completion_pct RPC math row-by-row: per-milestone % = task
 * ratio (stored project_milestones.completion_pct fallback when zero tasks),
 * weight from execution_milestones_master (default 10 for legacy names).
 */
export async function getMilestoneProgressData(
  projectId: string,
): Promise<MilestoneProgressData> {
  const op = '[getMilestoneProgressData]';
  const supabase = await createClient();

  const [milestonesRes, weightsRes, overallPct] = await Promise.all([
    supabase
      .from('project_milestones')
      .select('id, milestone_name, milestone_order, status, completion_pct')
      .eq('project_id', projectId)
      .order('milestone_order', { ascending: true }),
    supabase
      .from('execution_milestones_master')
      .select('milestone_name, weight'),
    getProjectCompletionPct(projectId),
  ]);

  if (milestonesRes.error) {
    console.error(`${op} milestones query failed:`, {
      code: milestonesRes.error.code, message: milestonesRes.error.message, projectId,
    });
  }
  const milestones = milestonesRes.data ?? [];
  const weightByName: Record<string, number> = {};
  for (const w of weightsRes.data ?? []) weightByName[w.milestone_name] = Number(w.weight);

  // Tasks fetched by milestone_id (this project's milestones only) — matches
  // the RPC's inclusion semantics, including universal-entity tasks.
  const milestoneIdList = milestones.map((m) => m.id);
  const taskAgg: Record<string, { total: number; done: number }> = {};
  if (milestoneIdList.length > 0) {
    const { data: taskRows, error: tasksErr } = await supabase
      .from('tasks')
      .select('milestone_id, is_completed')
      .in('milestone_id', milestoneIdList)
      .is('deleted_at', null);
    if (tasksErr) {
      console.error(`${op} tasks query failed:`, {
        code: tasksErr.code, message: tasksErr.message, projectId,
      });
    }
    for (const t of taskRows ?? []) {
      if (!t.milestone_id) continue;
      const agg = (taskAgg[t.milestone_id] ??= { total: 0, done: 0 });
      agg.total += 1;
      if (t.is_completed) agg.done += 1;
    }
  }

  const rows: MilestoneProgressRow[] = milestones.map((m) => {
    const agg = taskAgg[m.id];
    const pct = agg && agg.total > 0
      ? Math.round((agg.done / agg.total) * 100)
      : Math.round(Number(m.completion_pct ?? 0));
    return {
      id: m.id,
      milestoneName: m.milestone_name,
      weight: weightByName[m.milestone_name] ?? 10,
      totalTasks: agg?.total ?? 0,
      doneTasks: agg?.done ?? 0,
      pct,
    };
  });

  return { overallPct, rows };
}
