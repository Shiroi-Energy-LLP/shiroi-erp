import Link from 'next/link';
import { getAllTasks } from '@/lib/all-tasks-queries';
import { isTaskOverdue, formatEntityType } from '@/lib/tasks-helpers';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { ClipboardList } from 'lucide-react';

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
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const tasks = await getAllTasks({
    status: params.status || undefined,
    priority: params.priority || undefined,
    entity_type: params.entity_type || undefined,
    search: params.search || undefined,
  });

  const hasFilters = params.status || params.priority || params.entity_type || params.search;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
          Tasks{' '}
          <span className="text-base font-normal text-[#7C818E]">({tasks.length})</span>
        </h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4 flex-wrap">
            <Select name="status" defaultValue={params.status ?? ''} className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="priority" defaultValue={params.priority ?? ''} className="w-40">
              <option value="">All Priorities</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
            <Select name="entity_type" defaultValue={params.entity_type ?? ''} className="w-44">
              <option value="">All Entity Types</option>
              {ENTITY_TYPE_OPTIONS.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search task title..."
              className="w-60"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/tasks">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
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
                  <TableHead>Title</TableHead>
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

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {task.title}
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
