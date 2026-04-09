import * as React from 'react';
import { getAllTasks } from '@/lib/all-tasks-queries';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { TASK_CATEGORIES } from '@/lib/task-constants';
import { isTaskOverdue } from '@/lib/tasks-helpers';
import { formatDate } from '@repo/ui/formatters';
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog';
import { EditTaskDialog } from '@/components/tasks/edit-task-dialog';
import { DeleteTaskButton } from '@/components/tasks/delete-task-button';
import { TaskCompletionToggle } from '@/components/projects/forms/task-completion-toggle';
import { TaskWorkLog } from '@/components/tasks/task-work-log';
import {
  Card,
  CardContent,
  Badge,
  Eyebrow,
} from '@repo/ui';
import { ClipboardList } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import Link from 'next/link';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
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

function formatCategory(cat: string | null): string {
  if (!cat) return '—';
  const found = TASK_CATEGORIES.find((c) => c.value === cat);
  return found?.label ?? cat.replace(/_/g, ' ');
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
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const [tasks, employees, projects] = await Promise.all([
    getAllTasks({
      status: params.status || undefined,
      priority: params.priority || undefined,
      entity_type: params.entity_type || undefined,
      search: params.search || undefined,
      project_id: params.project || undefined,
      assigned_to: params.assigned_to || undefined,
      category: params.category || undefined,
    }),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  const hasFilters = params.status || params.priority || params.entity_type || params.search || params.project || params.assigned_to || params.category;
  const pendingCount = tasks.filter((t: any) => !t.is_completed).length;
  const completedCount = tasks.filter((t: any) => t.is_completed).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">TASKS</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
            Tasks{' '}
            <span className="text-base font-normal text-[#7C818E]">
              ({pendingCount} pending, {completedCount} done)
            </span>
          </h1>
        </div>
        <CreateTaskDialog employees={employees} projects={projects} />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <FilterBar basePath="/tasks" filterParams={['search', 'status', 'priority', 'entity_type', 'project', 'assigned_to', 'category']}>
            <FilterSelect paramName="status" className="w-36">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="priority" className="w-36">
              <option value="">All Priorities</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="category" className="w-44">
              <option value="">All Categories</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="assigned_to" className="w-44">
              <option value="">All Engineers</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="project" className="w-48">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search task title..."
              className="w-60 h-9 text-sm"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
              <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Tasks Found</h2>
              <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
                {hasFilters
                  ? 'No tasks match your current filters. Try adjusting or clearing the filters.'
                  : 'No tasks have been created yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="w-8 px-3 py-2.5"></th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Title</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Project</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Category</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Assigned To</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Due Date</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Priority</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Done By</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider">Remarks</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-n-600 uppercase tracking-wider w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task: any) => {
                    const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
                    const projectInfo = task.project as { project_number: string; customer_name: string } | null;
                    const completedByName = task.completed_by_employee && 'full_name' in task.completed_by_employee
                      ? (task.completed_by_employee as { full_name: string }).full_name
                      : null;

                    return (
                      <React.Fragment key={task.id}>
                        <tr className={`border-b border-n-100 group ${task.is_completed ? 'opacity-60' : ''}`}>
                          <td className="px-3 py-2">
                            <TaskCompletionToggle
                              taskId={task.id}
                              isCompleted={task.is_completed}
                              projectId={task.project_id ?? undefined}
                            />
                          </td>
                          <td className={`px-3 py-2 font-medium max-w-[200px] truncate ${task.is_completed ? 'line-through text-n-400' : ''}`}>
                            {task.title}
                          </td>
                          <td className="px-3 py-2">
                            {projectInfo ? (
                              <Link href={`/projects/${task.project_id}?tab=execution`} className="text-p-600 hover:underline text-xs">
                                <div className="font-medium">{projectInfo.project_number}</div>
                                <div className="text-n-500 text-[11px]">{projectInfo.customer_name}</div>
                              </Link>
                            ) : (
                              <span className="text-n-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {formatCategory(task.category)}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {task.assignee?.full_name ?? <span className="text-n-400">Unassigned</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {task.due_date ? (
                              <span className={overdue ? 'text-red-700 font-medium' : ''}>
                                {formatDate(task.due_date)}
                              </span>
                            ) : (
                              <span className="text-n-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={getPriorityVariant(task.priority)} className="text-[11px]">
                              {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={task.is_completed ? 'success' : overdue ? 'error' : 'outline'} className="text-[11px]">
                              {task.is_completed ? 'Completed' : overdue ? 'Overdue' : 'Pending'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-n-600">
                            {completedByName ?? <span className="text-n-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-n-600 max-w-[120px] truncate" title={task.remarks ?? ''}>
                            {task.remarks ?? <span className="text-n-400">—</span>}
                          </td>
                          <td className="px-3 py-2">
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
                        <tr className="border-b border-n-100">
                          <td colSpan={11} className="p-0">
                            <TaskWorkLog taskId={task.id} />
                          </td>
                        </tr>
                      </React.Fragment>
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
