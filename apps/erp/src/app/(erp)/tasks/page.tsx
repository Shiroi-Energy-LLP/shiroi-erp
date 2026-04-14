import * as React from 'react';
import { getAllTasks } from '@/lib/all-tasks-queries';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { getProjectsWithTasks } from '@/lib/tasks-queries';
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog';
import { TasksTable } from '@/components/tasks/tasks-table';
import { SearchableProjectFilter } from '@/components/tasks/searchable-project-filter';
import {
  Card,
  CardContent,
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

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    priority?: string;
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

  const [{ tasks, total }, employees, projects, filterProjects] = await Promise.all([
    getAllTasks({
      status: params.status || undefined,
      priority: params.priority || undefined,
      search: params.search || undefined,
      project_id: params.project || undefined,
      assigned_to: params.assigned_to || undefined,
      category: params.category || undefined,
      page: currentPage,
      per_page: perPage,
    }),
    getActiveEmployees(),
    getActiveProjects(),        // full list — for create/edit task dialogs
    getProjectsWithTasks(),     // filtered list — only projects with tasks, for the filter dropdown
  ]);

  const totalPages = Math.ceil(total / perPage);
  const hasFilters = params.status || params.priority || params.search || params.project || params.assigned_to || params.category;

  // Build pagination URL helper
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.status) p.set('status', params.status);
    if (params.priority) p.set('priority', params.priority);
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
          <FilterBar basePath="/tasks" filterParams={['search', 'status', 'priority', 'project', 'assigned_to', 'category']}>
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
            <FilterSelect paramName="assigned_to" className="w-40 text-xs h-8">
              <option value="">All Engineers</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </FilterSelect>
            <SearchableProjectFilter projects={filterProjects} />
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
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project Name</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Task Name</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned To</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Priority</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Notes</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Done By</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-10">Log</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-16">Actions</th>
                  </tr>
                </thead>
                <TasksTable tasks={tasks} employees={employees} projects={projects} />
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
