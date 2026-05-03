import * as React from 'react';
import Link from 'next/link';
import { getSalesTeamTasks, type SalesTeamTasksSort } from '@/lib/sales-team-tasks-queries';
import { Badge } from '@repo/ui';
import { Card, CardContent } from '@repo/ui';
import { ClipboardList, ArrowUpDown } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import { isTaskOverdue } from '@/lib/tasks-helpers';

interface SalesTasksPageProps {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    show?: string;
  }>;
}

function getPriorityVariant(priority: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (priority) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'outline';
  }
}

function getCategoryLabel(category: string | null): string {
  switch (category) {
    case 'lead_followup': return 'Follow-up';
    case 'payment_followup': return 'Payment';
    case 'payment_escalation': return 'Escalation';
    case 'advance_payment': return 'Advance';
    case 'general': return 'General';
    default: return category ?? '—';
  }
}

function SortLink({
  col,
  label,
  currentSort,
  currentDir,
}: {
  col: SalesTeamTasksSort;
  label: string;
  currentSort: string;
  currentDir: string;
}) {
  const isActive = currentSort === col;
  const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc';
  const href = `/sales/tasks?sort=${col}&dir=${nextDir}`;
  return (
    <Link
      href={href}
      className={`flex items-center gap-0.5 uppercase tracking-wider text-[10px] font-semibold ${
        isActive ? 'text-p-700' : 'text-n-500 hover:text-n-700'
      }`}
    >
      {label}
      <ArrowUpDown className="h-2.5 w-2.5" />
    </Link>
  );
}

export default async function SalesTeamTasksPage({ searchParams }: SalesTasksPageProps) {
  const params = await searchParams;

  const validSorts: SalesTeamTasksSort[] = ['assignee_name', 'due_date', 'created_at'];
  const sortBy: SalesTeamTasksSort = validSorts.includes(params.sort as SalesTeamTasksSort)
    ? (params.sort as SalesTeamTasksSort)
    : 'due_date';
  const sortDir = params.dir === 'desc' ? 'desc' : 'asc';
  const includeCompleted = params.show === 'all';

  const result = await getSalesTeamTasks({ sortBy, sortDir, includeCompleted });

  const tasks = result.success ? result.data : [];
  const errorMsg = !result.success ? result.error : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Sales Team Tasks{' '}
            <span className="text-sm font-normal text-n-500">
              ({tasks.length} {includeCompleted ? 'total' : 'open'})
            </span>
          </h1>
          <p className="text-xs text-n-500 mt-0.5">All open follow-up and payment tasks across the sales team</p>
        </div>
        <div className="flex items-center gap-2">
          {includeCompleted ? (
            <Link
              href="/sales/tasks"
              className="text-xs text-p-600 hover:underline"
            >
              Show open only
            </Link>
          ) : (
            <Link
              href="/sales/tasks?show=all"
              className="text-xs text-n-500 hover:text-n-700"
            >
              Show all (incl. completed)
            </Link>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          Failed to load tasks: {errorMsg}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Tasks Found</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                No {includeCompleted ? '' : 'open '}sales tasks exist yet.
                Tasks are created automatically when a lead&apos;s follow-up date is set.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Client</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Task</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Type</th>
                    <th className="px-2 py-2">
                      <SortLink col="assignee_name" label="Assignee" currentSort={sortBy} currentDir={sortDir} />
                    </th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Priority</th>
                    <th className="px-2 py-2">
                      <SortLink col="due_date" label="Due Date" currentSort={sortBy} currentDir={sortDir} />
                    </th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
                    return (
                      <tr key={task.id} className="border-b border-n-100 hover:bg-n-50">
                        {/* Client */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {task.customer_name && task.entity_id ? (
                            <Link
                              href={task.entity_type === 'lead' ? `/sales/${task.entity_id}` : `/projects/${task.entity_id}`}
                              className="text-p-600 hover:underline font-medium"
                            >
                              {task.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Task title */}
                        <td className="px-2 py-1.5 text-[11px] font-medium text-n-900 max-w-[240px]">
                          <span title={task.title} className="line-clamp-1">{task.title}</span>
                        </td>

                        {/* Category */}
                        <td className="px-2 py-1.5 text-[11px] text-n-600">
                          {getCategoryLabel(task.category)}
                        </td>

                        {/* Assignee */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700 font-medium">
                          {task.assignee_name}
                        </td>

                        {/* Priority */}
                        <td className="px-2 py-1.5">
                          <Badge variant={getPriorityVariant(task.priority)} className="text-[10px] px-1.5 py-0">
                            {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
                          </Badge>
                        </td>

                        {/* Due Date */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {task.due_date ? (
                            <span className={overdue ? 'text-red-600 font-medium' : 'text-n-600'}>
                              {formatDate(task.due_date)}
                              {overdue && <span className="ml-1 text-[10px]">(overdue)</span>}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-2 py-1.5">
                          {task.is_completed ? (
                            <Badge variant="success" className="text-[10px] px-1.5 py-0">Done</Badge>
                          ) : overdue ? (
                            <Badge variant="error" className="text-[10px] px-1.5 py-0">Overdue</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Open</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
