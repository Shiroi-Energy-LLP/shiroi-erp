import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepExecutionData } from '@/lib/project-stepper-queries';
import { getActiveEmployeesForProject } from '@/lib/project-step-actions';
import { HardHat, Calendar, CheckCircle2, Clock, AlertTriangle, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { MilestoneSeedButton, MilestoneStatusControl, QuickTaskForm } from '@/components/projects/forms/milestone-form';
import { TaskCompletionToggle } from '@/components/projects/forms/task-completion-toggle';

interface StepExecutionProps {
  projectId: string;
}

const MILESTONE_LABELS: Record<string, string> = {
  advance_payment: 'Advance Payment',
  material_delivery: 'Material Delivery',
  structure_installation: 'Structure Installation',
  panel_installation: 'Panel Installation',
  electrical_work: 'Electrical Work',
  civil_work: 'Civil Work',
  testing_commissioning: 'Testing & Commissioning',
  net_metering: 'Net Metering',
  handover: 'Handover',
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
        <p className="text-[13px] text-[#7C818E]">Could not load execution data. Please refresh the page or try again later.</p>
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
            Click &quot;Seed Default Milestones&quot; above to create the standard 9 milestones for this project.
          </p>
        </div>
      </div>
    );
  }

  // Compute summary stats
  const completed = milestones.filter((m) => m.status === 'completed').length;
  const inProgress = milestones.filter((m) => m.status === 'in_progress').length;
  const blocked = milestones.filter((m) => m.status === 'blocked' || m.is_blocked).length;
  const overallPct = milestones.length > 0
    ? Math.round(milestones.reduce((sum, m) => sum + Number(m.completion_pct || 0), 0) / milestones.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex gap-3 flex-wrap">
        <SummaryCard label="Overall" value={`${overallPct}%`} color="#1A1D24" />
        <SummaryCard label="Completed" value={completed.toString()} color="#065F46" />
        <SummaryCard label="In Progress" value={inProgress.toString()} color="#1E40AF" />
        <SummaryCard label="Blocked" value={blocked.toString()} color={blocked > 0 ? '#991B1B' : '#7C818E'} />
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

      {/* Milestones timeline */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Execution Milestones</CardTitle>
          <div className="flex items-center gap-3">
            <Link href={`/projects/${projectId}/milestones`}>
              <Button size="sm" variant="ghost" className="text-xs">View Full Timeline</Button>
            </Link>
            <Link href={`/projects/${projectId}?tab=qc`}>
              <Button size="sm" variant="ghost" className="text-xs">
                Continue to QC →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500 w-8">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Milestone</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">%</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Planned</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Actual</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Info</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const label = MILESTONE_LABELS[m.milestone_name] ?? m.milestone_name.replace(/_/g, ' ');
                  return (
                    <tr key={m.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-3 py-2 font-mono text-n-400">{m.milestone_order}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-n-900">{label}</div>
                      </td>
                      <td className="px-3 py-2">
                        <MilestoneStatusControl
                          projectId={projectId}
                          milestoneId={m.id}
                          currentStatus={m.status}
                          isBlocked={m.is_blocked}
                          blockedReason={m.blocked_reason}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-mono text-xs ${
                          Number(m.completion_pct) === 100 ? 'text-green-600 font-bold' :
                          Number(m.completion_pct) > 0 ? 'text-blue-600' : 'text-n-400'
                        }`}>
                          {m.completion_pct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-n-500">
                        {m.planned_start_date || m.planned_end_date ? (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>
                              {m.planned_start_date ? formatDate(m.planned_start_date) : '—'}
                              {' → '}
                              {m.planned_end_date ? formatDate(m.planned_end_date) : '—'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-n-300">Not set</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-n-500">
                        {m.actual_start_date || m.actual_end_date ? (
                          <div className="flex items-center gap-1">
                            {m.actual_end_date ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            ) : (
                              <Clock className="h-3 w-3 text-blue-500" />
                            )}
                            <span>
                              {m.actual_start_date ? formatDate(m.actual_start_date) : '—'}
                              {' → '}
                              {m.actual_end_date ? formatDate(m.actual_end_date) : '—'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-n-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {m.is_blocked && (
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                            <span className="text-xs text-red-600 max-w-[120px] truncate" title={m.blocked_reason ?? undefined}>
                              {m.blocked_reason || 'Blocked'}
                            </span>
                          </div>
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

      {/* Tasks linked to milestones */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-n-500" />
            <CardTitle className="text-base">Execution Tasks</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-n-500">
              {tasks.filter((t: any) => t.is_completed).length}/{tasks.length} done
            </span>
            <QuickTaskForm projectId={projectId} milestones={milestones} employees={employees} />
          </div>
        </CardHeader>
        {tasks.length > 0 ? (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500 w-6"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Task</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Milestone</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Assigned</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Priority</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task: any) => {
                    const milestone = milestones.find((m) => m.id === task.milestone_id);
                    const milestoneLabel = milestone
                      ? MILESTONE_LABELS[milestone.milestone_name] ?? milestone.milestone_name
                      : '—';
                    const assigneeName = task.employees && 'full_name' in task.employees
                      ? (task.employees as { full_name: string }).full_name
                      : '—';
                    const isOverdue = task.due_date && !task.is_completed && new Date(task.due_date) < new Date();

                    return (
                      <tr key={task.id} className={`border-b border-n-100 ${task.is_completed ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2">
                          <TaskCompletionToggle
                            taskId={task.id}
                            isCompleted={task.is_completed}
                            projectId={projectId}
                          />
                        </td>
                        <td className={`px-3 py-2 ${task.is_completed ? 'line-through text-n-400' : 'text-n-900'}`}>
                          {task.title}
                        </td>
                        <td className="px-3 py-2 text-xs text-n-500">{milestoneLabel}</td>
                        <td className="px-3 py-2 text-xs text-n-500">{assigneeName}</td>
                        <td className="px-3 py-2">
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className={`px-3 py-2 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-n-500'}`}>
                          {task.due_date ? formatDate(task.due_date) : '—'}
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
            <p className="text-sm text-n-400 text-center py-4">No execution tasks yet. Use &quot;+ Task&quot; to create one.</p>
          </CardContent>
        )}
      </Card>

      {/* Quick links */}
      <div className="flex gap-3">
        <Link href={`/daily-reports?project=${projectId}`}>
          <Button size="sm" variant="outline" className="text-xs">
            📋 {reportCount} Daily Reports
          </Button>
        </Link>
        <Link href={`/projects/${projectId}/milestones`}>
          <Button size="sm" variant="outline" className="text-xs">
            📊 Detailed Milestones
          </Button>
        </Link>
        <Link href={`/tasks?project=${projectId}`}>
          <Button size="sm" variant="outline" className="text-xs">
            ✅ All Project Tasks
          </Button>
        </Link>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[100px]">
      <div className="text-xs text-n-500 mb-0.5">{label}</div>
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
