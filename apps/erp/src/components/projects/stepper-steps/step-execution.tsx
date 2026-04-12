import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
} from '@repo/ui';
import { getStepExecutionData } from '@/lib/project-stepper-queries';
import { getActiveEmployeesForProject } from '@/lib/project-step-actions';
import { HardHat, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { MilestoneSeedButton, MilestoneStatusControl, QuickTaskForm } from '@/components/projects/forms/milestone-form';
import {
  TaskStatusDropdown,
  ActivityLogCell,
  EditTaskButton,
  DeleteTaskButton,
  MilestoneEditableField,
} from '@/components/projects/forms/execution-task-row';

interface StepExecutionProps {
  projectId: string;
}

/** Milestone display labels — aligned with execution_milestones_master table. */
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

export async function StepExecution({ projectId }: StepExecutionProps) {
  let milestones: Awaited<ReturnType<typeof getStepExecutionData>>['milestones'] = [];
  let reportCount = 0;
  let tasks: Awaited<ReturnType<typeof getStepExecutionData>>['tasks'] = [];
  let employees: { id: string; full_name: string }[] = [];

  try {
    const [data, empList] = await Promise.all([
      getStepExecutionData(projectId),
      getActiveEmployeesForProject(),
    ]);
    milestones = data.milestones;
    reportCount = data.reportCount;
    tasks = data.tasks;
    employees = empList;
  } catch (error) {
    console.error('[StepExecution] Failed to load execution data:', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <HardHat className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">Failed to Load</h3>
        <p className="text-[13px] text-[#7C818E]">Could not load execution data. Please refresh the page.</p>
      </div>
    );
  }

  const hasMilestones = milestones.length > 0;

  if (!hasMilestones) {
    return (
      <div>
        <MilestoneSeedButton projectId={projectId} />
        <div className="flex flex-col items-center justify-center py-16">
          <HardHat className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Milestones</h3>
          <p className="text-[13px] text-[#7C818E] max-w-md text-center">
            Click &quot;Seed Default Milestones&quot; above to create the default execution milestones.
          </p>
        </div>
      </div>
    );
  }

  // Task-based counts
  const tasksCompleted = tasks.filter((t: any) => t.is_completed).length;
  const tasksOpen = tasks.filter((t: any) => !t.is_completed).length;
  const milestoneBlocked = milestones.filter((m) => m.status === 'blocked' || m.is_blocked).length;

  // Auto-calculate milestone completion % from tasks
  const milestoneTaskCounts = milestones.map((m) => {
    const mTasks = tasks.filter((t: any) => t.milestone_id === m.id);
    const mDone = mTasks.filter((t: any) => t.is_completed).length;
    const pct = mTasks.length > 0 ? Math.round((mDone / mTasks.length) * 100) : Number(m.completion_pct || 0);
    return { milestoneId: m.id, total: mTasks.length, done: mDone, pct };
  });

  // Overall % from milestone averages (task-based where tasks exist, status-based otherwise)
  const overallPct = milestones.length > 0
    ? Math.round(milestoneTaskCounts.reduce((sum, mc) => sum + mc.pct, 0) / milestones.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* ── Overall Progress Dashboard ── */}
      <div className="flex gap-3 flex-wrap">
        <SummaryCard label="Overall" value={`${overallPct}%`} color="#1A1D24" />
        <SummaryCard label="Tasks Completed" value={tasksCompleted.toString()} color="#065F46" />
        <SummaryCard label="Tasks Open" value={tasksOpen.toString()} color="#1E40AF" />
        <SummaryCard label="Blocked" value={milestoneBlocked.toString()} color={milestoneBlocked > 0 ? '#991B1B' : '#7C818E'} />
        <SummaryCard label="Daily Reports" value={reportCount.toString()} color="#1A1D24" />
      </div>

      {/* Progress bar */}
      <div className="bg-n-100 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${overallPct}%`,
            backgroundColor: overallPct === 100 ? '#059669' : '#00B050',
          }}
        />
      </div>

      {/* ── Milestone Tracking Table ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Milestone Tracking</CardTitle>
          <div className="flex items-center gap-3">
            <Link href={`/projects/${projectId}?tab=qc`}>
              <Button size="sm" variant="ghost" className="text-xs">
                Continue to QC &rarr;
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-n-500">Milestone</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-n-500">Status</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-n-500 w-[50px]">%</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-n-500">Planned Date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-n-500">Actual Date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-n-500">Info</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const label = MILESTONE_LABELS[m.milestone_name] ?? m.milestone_name.replace(/_/g, ' ');
                  const mc = milestoneTaskCounts.find((tc) => tc.milestoneId === m.id);
                  const pct = mc?.pct ?? 0;

                  return (
                    <tr key={m.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-3 py-1.5">
                        <span className="font-medium text-n-900">{label}</span>
                        {mc && mc.total > 0 && (
                          <span className="text-[9px] text-n-400 ml-1.5">({mc.done}/{mc.total} tasks)</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <MilestoneStatusControl
                          projectId={projectId}
                          milestoneId={m.id}
                          currentStatus={m.status}
                          isBlocked={m.is_blocked}
                          blockedReason={m.blocked_reason}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={`font-mono text-[11px] ${
                          pct === 100 ? 'text-green-600 font-bold' :
                          pct > 0 ? 'text-blue-600' : 'text-n-400'
                        }`}>
                          {pct}%
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <MilestoneEditableField
                          projectId={projectId}
                          milestoneId={m.id}
                          field="planned_end_date"
                          value={m.planned_end_date}
                          type="date"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <MilestoneEditableField
                          projectId={projectId}
                          milestoneId={m.id}
                          field="actual_end_date"
                          value={m.actual_end_date}
                          type="date"
                        />
                      </td>
                      <td className="px-3 py-1.5 max-w-[150px]">
                        {m.is_blocked ? (
                          <span className="text-[10px] text-red-600 truncate" title={m.blocked_reason ?? undefined}>
                            {m.blocked_reason || 'Blocked'}
                          </span>
                        ) : (
                          <MilestoneEditableField
                            projectId={projectId}
                            milestoneId={m.id}
                            field="notes"
                            value={(m as any).notes ?? null}
                            type="text"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Execution Tasks Table ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-n-500" />
            <CardTitle className="text-base">Execution Tasks</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-n-500">
              {tasksCompleted}/{tasks.length} done
            </span>
            <QuickTaskForm projectId={projectId} milestones={milestones} employees={employees} />
          </div>
        </CardHeader>
        {tasks.length > 0 ? (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Task Name</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Milestone</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Assigned To</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Assigned Date</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Status</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Priority</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Due Date</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Notes</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Done By</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Activity Log</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[60px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task: any) => {
                    const milestone = milestones.find((m) => m.id === task.milestone_id);
                    const milestoneLabel = milestone
                      ? MILESTONE_LABELS[milestone.milestone_name] ?? milestone.milestone_name.replace(/_/g, ' ')
                      : '—';
                    const assigneeName = task.employees && 'full_name' in task.employees
                      ? (task.employees as { full_name: string }).full_name
                      : '—';
                    const doneByName = task.completedByEmployee && 'full_name' in task.completedByEmployee
                      ? (task.completedByEmployee as { full_name: string }).full_name
                      : null;
                    const isOverdue = task.due_date && !task.is_completed && new Date(task.due_date) < new Date();

                    return (
                      <tr key={task.id} className={`border-b border-n-100 ${task.is_completed ? 'opacity-60' : ''}`}>
                        <td className={`px-2 py-1.5 max-w-[160px] ${task.is_completed ? 'line-through text-n-400' : 'text-n-900 font-medium'}`}>
                          <span className="truncate block" title={task.title}>{task.title}</span>
                        </td>
                        <td className="px-2 py-1.5 text-n-500">{milestoneLabel}</td>
                        <td className="px-2 py-1.5 text-n-600">{assigneeName}</td>
                        <td className="px-2 py-1.5 text-n-500">
                          {task.assigned_date
                            ? new Date(task.assigned_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <TaskStatusDropdown
                            taskId={task.id}
                            isCompleted={task.is_completed}
                            projectId={projectId}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className={`px-2 py-1.5 ${isOverdue ? 'text-red-600 font-medium' : 'text-n-500'}`}>
                          {task.due_date
                            ? new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-n-500 max-w-[100px]">
                          <span className="truncate block" title={task.remarks ?? undefined}>
                            {task.remarks || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-n-600">
                          {doneByName || '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <ActivityLogCell taskId={task.id} />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <EditTaskButton
                              task={task}
                              milestones={milestones}
                              employees={employees}
                              projectId={projectId}
                            />
                            <DeleteTaskButton taskId={task.id} projectId={projectId} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-[11px] text-n-400 text-center py-4">No execution tasks yet. Use &quot;+ Task&quot; to create one.</p>
          </CardContent>
        )}
      </Card>

      {/* Quick links */}
      <div className="flex gap-3">
        <Link href={`/daily-reports?project=${projectId}`}>
          <Button size="sm" variant="outline" className="text-xs">
            {reportCount} Daily Reports
          </Button>
        </Link>
        <Link href={`/tasks?project=${projectId}`}>
          <Button size="sm" variant="outline" className="text-xs">
            All Project Tasks
          </Button>
        </Link>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[100px]">
      <div className="text-[10px] text-n-500 mb-0.5">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-500',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize ${colors[priority] ?? colors.medium}`}>
      {priority}
    </span>
  );
}
