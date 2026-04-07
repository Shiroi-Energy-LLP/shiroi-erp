import { getAllTasks } from '@/lib/all-tasks-queries';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { isTaskOverdue, formatEntityType } from '@/lib/tasks-helpers';
import { formatDate } from '@repo/ui/formatters';
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog';
import { TaskCompletionToggle } from '@/components/projects/forms/task-completion-toggle';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
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

const ENTITY_TYPE_OPTIONS = [
  { value: 'project', label: 'Project' },
  { value: 'lead', label: 'Lead' },
  { value: 'om_ticket', label: 'Service Ticket' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'hr', label: 'HR' },
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
    }),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  const hasFilters = params.status || params.priority || params.entity_type || params.search || params.project || params.assigned_to;
  const pendingCount = tasks.filter((t) => !t.is_completed).length;
  const completedCount = tasks.filter((t) => t.is_completed).length;

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
          <FilterBar basePath="/tasks" filterParams={['search', 'status', 'priority', 'entity_type', 'project', 'assigned_to']}>
            <FilterSelect paramName="status" className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="priority" className="w-40">
              <option value="">All Priorities</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="entity_type" className="w-44">
              <option value="">All Entity Types</option>
              {ENTITY_TYPE_OPTIONS.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
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
                  : 'No tasks have been created yet. Tasks will appear here once they are assigned across projects, leads, and other entities.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
                  const projectInfo = task.project as { project_number: string; customer_name: string } | null;

                  return (
                    <TableRow key={task.id} className={task.is_completed ? 'opacity-60' : ''}>
                      <TableCell>
                        <TaskCompletionToggle
                          taskId={task.id}
                          isCompleted={task.is_completed}
                          projectId={task.project_id ?? undefined}
                        />
                      </TableCell>
                      <TableCell className={`font-medium max-w-[250px] truncate ${task.is_completed ? 'line-through text-n-400' : ''}`}>
                        {task.title}
                      </TableCell>
                      <TableCell>
                        {projectInfo ? (
                          <Link href={`/projects/${task.project_id}`} className="text-p-600 hover:underline text-xs">
                            <div className="font-medium">{projectInfo.project_number}</div>
                            <div className="text-n-500 text-[11px]">{projectInfo.customer_name}</div>
                          </Link>
                        ) : (
                          <span className="text-[#9CA0AB]">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.assignee?.full_name ?? <span className="text-[#9CA0AB]">Unassigned</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{formatEntityType(task.entity_type)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getPriorityVariant(task.priority)}>
                          {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {task.due_date ? (
                          <span className={overdue ? 'text-[#991B1B] font-medium' : ''}>
                            {formatDate(task.due_date)}
                          </span>
                        ) : (
                          <span className="text-[#9CA0AB]">No date</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.is_completed ? 'success' : overdue ? 'error' : 'outline'}>
                          {task.is_completed ? 'Completed' : overdue ? 'Overdue' : 'Pending'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
