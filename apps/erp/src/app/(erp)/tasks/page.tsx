import * as React from 'react';
import { getAllTasks } from '@/lib/all-tasks-queries';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { TASK_CATEGORIES } from '@/lib/task-constants';
import { isTaskOverdue } from '@/lib/tasks-helpers';
import { formatDate } from '@repo/ui/formatters';
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog';
import { EditTaskDialog } from '@/components/tasks/edit-task-dialog';
import { DeleteTaskButton } from '@/components/tasks/delete-task-button';
import { TaskStatusToggle } from '@/components/tasks/task-status-toggle';
import { SearchableProjectFilter } from '@/components/tasks/searchable-project-filter';
import { ActivityLogCell } from '@/components/projects/forms/execution-task-row';
import {
  Card,
  CardContent,
  Badge,
  Button,
} from '@repo/ui';
import { ClipboardList } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import Link from 'next/link';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function getPriorityVariant(priority: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (priority) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'outline';
  }
}

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    entity_type?: string;
    search?: string;
    project?: string;
    assigned_to?: string;
    category?: string;
    page?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const [{ tasks, total }, employees, projects] = await Promise.all([
    getAllTasks({
      status: params.status || undefined,
      priority: params.priority || undefined,
      entity_type: params.entity_type || undefined,
      search: params.search || undefined,
      project_id: params.project || undefined,
      assigned_to: params.assigned_to || undefined,
      category: params.category || undefined,
      page: currentPage,
      per_page: perPage,
    }),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  const totalPages = Math.ceil(total / perPage);
  const hasFilters = params.status || params.priority || params.entity_type || params.search || params.project || params.assigned_to || params.category;

  // Build pagination URL helper
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.status) p.set('status', params.status);
    if (params.priority) p.set('priority', params.priority);
    if (params.entity_type) p.set('entity_type', params.entity_type);
    if (params.search) p.set('search', params.search);
    if (params.project) p.set('project', params.project);
    if (params.assigned_to) p.set('assigned_to', params.assigned_to);
    if (params.category) p.set('category', params.category);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/tasks${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Tasks{' '}
            <span className="text-sm font-normal text-n-500">
              ({total} total)
            </span>
          </h1>
        </div>
        <CreateTaskDialog employees={employees} projects={projects} />
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/tasks" filterParams={['search', 'status', 'priority', 'entity_type', 'project', 'assigned_to', 'category']}>
            <FilterSelect paramName="status" className="w-28 text-xs h-8">
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="priority" className="w-28 text-xs h-8">
              <option value="">All Priority</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="category" className="w-36 text-xs h-8">
              <option value="">All Categories</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="assigned_to" className="w-40 text-xs h-8">
              <option value="">All Engineers</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </FilterSelect>
            <SearchableProjectFilter projects={projects} />
            <SearchInput
              placeholder="Search task..."
              className="w-48 h-8 text-xs"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Tasks Found</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No tasks match your current filters.'
                  : 'No tasks have been created yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Task Name</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Milestone</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned To</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Priority</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Notes</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Done By</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Activity Log</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task: any) => {
                    const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
                    const projectInfo = task.project as { project_number: string; customer_name: string } | null;
                    const completedByName = task.completed_by_employee && 'full_name' in task.completed_by_employee
                      ? (task.completed_by_employee as { full_name: string }).full_name
                      : null;
                    const milestoneName = task.milestone && 'milestone_name' in task.milestone
                      ? (task.milestone as { milestone_name: string }).milestone_name
                      : null;

                    return (
                      <tr
                        key={task.id}
                        className={`border-b border-n-100 hover:bg-n-50 ${task.is_completed ? 'opacity-50' : ''}`}
                      >
                        {/* Project Name */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${task.project_id}?tab=execution`} className="text-p-600 hover:underline">
                              <div className="font-medium leading-tight">{projectInfo.project_number}</div>
                              <div className="text-n-500 text-[10px] leading-tight truncate max-w-[120px]">{projectInfo.customer_name}</div>
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Task Name */}
                        <td className={`px-2 py-1.5 text-[11px] font-medium ${task.is_completed ? 'line-through text-n-400' : 'text-n-900'}`}>
                          <span title={task.title}>{task.title}</span>
                        </td>

                        {/* Milestone */}
                        <td className="px-2 py-1.5 text-[10px] text-n-600" title={milestoneName ?? ''}>
                          {milestoneName
                            ? milestoneName.replace(/_/g, ' ')
                            : <span className="text-n-300">—</span>}
                        </td>

                        {/* Assigned To */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700">
                          {task.assignee?.full_name ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Assigned Date */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {task.assigned_date ? formatDate(task.assigned_date) : <span className="text-n-300">—</span>}
                        </td>

                        {/* Status (Open/Closed) — clickable toggle */}
                        <td className="px-2 py-1.5">
                          <TaskStatusToggle
                            taskId={task.id}
                            isCompleted={task.is_completed}
                            isOverdue={overdue}
                          />
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
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Notes/Remarks */}
                        <td className="px-2 py-1.5 text-[10px] text-n-600" title={task.remarks ?? ''}>
                          {task.remarks ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Done By */}
                        <td className="px-2 py-1.5 text-[11px] text-n-600">
                          {completedByName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Activity Log */}
                        <td className="px-2 py-1.5">
                          <ActivityLogCell taskId={task.id} />
                        </td>

                        {/* Actions (Edit/Delete) */}
                        <td className="px-2 py-1.5">
                          <div className="flex gap-0.5">
                            <EditTaskDialog
                              task={{
                                id: task.id,
                                title: task.title,
                                description: task.description,
                                category: task.category ?? null,
                                priority: task.priority,
                                due_date: task.due_date,
                                assigned_to: task.assigned_to,
                                remarks: task.remarks ?? null,
                                project_id: task.project_id,
                                entity_type: task.entity_type,
                                is_completed: task.is_completed,
                                completed_by: (task as any).completed_by ?? null,
                              }}
                              employees={employees}
                              projects={projects}
                            />
                            <DeleteTaskButton taskId={task.id} title={task.title} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-n-200 bg-n-50">
              <span className="text-[11px] text-n-500">
                Page {currentPage} of {totalPages} &middot; {total} tasks
              </span>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Link href={pageUrl(currentPage - 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      ← Previous
                    </Button>
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link href={pageUrl(currentPage + 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      Next →
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
