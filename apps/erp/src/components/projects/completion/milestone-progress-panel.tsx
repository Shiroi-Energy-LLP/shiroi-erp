import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@repo/ui';
import { createClient } from '@repo/supabase/server';
import { getProjectCompletionPct } from '@/lib/project-completion-queries';
import { ListTodo } from 'lucide-react';

/** Milestone display labels — aligned with execution_milestones_master. */
const MILESTONE_LABELS: Record<string, string> = {
  material_delivery: 'Material Delivery',
  structure_installation: 'Structure Installation',
  panel_installation: 'Panel Installation',
  electrical_work: 'Electrical Work',
  earthing_work: 'Earthing Work',
  civil_work: 'Civil Work',
  testing_commissioning: 'Testing & Commissioning',
  net_metering: 'Net Metering',
  handover: 'Handover',
  follow_ups: 'Follow-ups',
};

/**
 * Read-only weighted-milestone completion breakdown. Single source of truth is
 * get_project_completion_pct (mig 173) — this panel mirrors its math row-by-row
 * (task ratio per milestone, stored pct fallback, weight from the master table).
 * Tasks are edited on the Execution tab; nothing is editable here.
 */
export async function MilestoneProgressPanel({ projectId }: { projectId: string }) {
  const op = '[MilestoneProgressPanel]';
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

  const rows = milestones.map((m) => {
    const agg = taskAgg[m.id];
    const pct = agg && agg.total > 0
      ? Math.round((agg.done / agg.total) * 100)
      : Math.round(Number(m.completion_pct ?? 0));
    return {
      id: m.id,
      label: MILESTONE_LABELS[m.milestone_name] ?? m.milestone_name.replace(/_/g, ' '),
      weight: weightByName[m.milestone_name] ?? 10,
      total: agg?.total ?? 0,
      done: agg?.done ?? 0,
      pct,
    };
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Project Progress</CardTitle>
            <p className="text-xs text-n-500 mt-0.5">
              Auto-calculated from milestone task completion × milestone weight. Edit tasks on the Execution tab.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-n-900">{overallPct}%</div>
            <div className="text-[10px] text-n-500">Overall completion</div>
          </div>
        </div>
        <div className="mt-2 h-2.5 w-full rounded-full bg-n-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-shiroi-green transition-all duration-500"
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-n-500 text-center py-6">
            No milestones yet — seed them on the{' '}
            <Link href={`/projects/${projectId}?tab=execution`} className="text-blue-600 hover:underline">
              Execution tab
            </Link>.
          </p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-n-200 bg-n-50">
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Milestone</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500 w-[70px]">Weight</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500 w-[90px]">Tasks</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500 w-[70px]">%</th>
                <th className="px-3 py-1.5 w-[200px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-n-100 hover:bg-n-50">
                  <td className="px-3 py-1.5 font-medium text-n-900">{r.label}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Badge variant="outline" className="text-[10px]">{r.weight}%</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-n-500">
                    {r.total > 0 ? `${r.done}/${r.total}` : '—'}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono ${
                    r.pct === 100 ? 'text-green-600 font-bold' : r.pct > 0 ? 'text-blue-600' : 'text-n-400'
                  }`}>
                    {r.pct}%
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 w-full rounded-full bg-n-150 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-shiroi-green"
                        style={{ width: `${Math.min(r.pct, 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-3 py-2 border-t border-n-100">
          <Link href={`/projects/${projectId}?tab=execution`}>
            <Button size="sm" variant="ghost" className="text-xs">
              <ListTodo className="h-3.5 w-3.5 mr-1.5" /> Manage tasks on Execution tab →
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
