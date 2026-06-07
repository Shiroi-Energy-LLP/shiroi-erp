import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { Badge, Breadcrumb, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { TaskWorkLog } from '@/components/tasks/task-work-log';
import { isTaskOverdue } from '@/lib/tasks-helpers';

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

function getPriorityVariant(priority: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (priority) {
    case 'critical':
      return 'error';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    default:
      return 'outline';
  }
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .select(
      'id, title, description, priority, due_date, is_completed, completed_at, remarks, category, entity_type, entity_id, project_id, assigned_to, assignee:employees!project_tasks_assigned_to_fkey(full_name), project:projects!project_tasks_project_id_fkey(project_number, customer_name), completed_by_employee:employees!project_tasks_completed_by_fkey(full_name)',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[TaskDetailPage] Failed to load task:', { code: error.code, message: error.message });
  }

  if (!task) {
    notFound();
  }

  const assigneeName = task.assignee && 'full_name' in task.assignee
    ? (task.assignee as { full_name: string }).full_name
    : null;
  const projectInfo = task.project as { project_number: string; customer_name: string } | null;
  const completedByName = task.completed_by_employee && 'full_name' in task.completed_by_employee
    ? (task.completed_by_employee as { full_name: string }).full_name
    : null;
  const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
  const displayTitle = typeof task.title === 'string' && task.title.startsWith('[AI] ')
    ? task.title.slice(5)
    : task.title;
  const isAiTask = typeof task.title === 'string' && task.title.startsWith('[AI] ');

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Tasks', href: '/tasks' },
          { label: displayTitle },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isAiTask && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                AI
              </Badge>
            )}
            <h1 className="text-lg font-heading font-bold text-n-900">{displayTitle}</h1>
            <Badge variant={task.is_completed ? 'success' : overdue ? 'error' : 'warning'} className="text-[10px]">
              {task.is_completed ? 'Closed' : overdue ? 'Overdue' : 'Open'}
            </Badge>
            <Badge variant={getPriorityVariant(task.priority)} className="text-[10px]">
              {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
            </Badge>
          </div>
          <Link
            href="/tasks"
            className="text-xs text-shiroi-green hover:underline"
          >
            ← Back to Tasks
          </Link>
        </div>
      </div>

      {/* Task details card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Task Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Assigned To" value={assigneeName} />
          <InfoRow label="Due Date" value={task.due_date ? formatDate(task.due_date) : null} highlight={overdue} />
          {projectInfo ? (
            <div className="flex items-center justify-between text-sm gap-3">
              <span className="text-n-500 shrink-0">Project</span>
              <Link
                href={`/projects/${task.project_id}`}
                className="text-shiroi-green hover:underline text-right"
              >
                {projectInfo.customer_name}
                {projectInfo.project_number ? ` (${projectInfo.project_number})` : ''}
              </Link>
            </div>
          ) : null}
          <InfoRow label="Category" value={task.category} capitalize />
          <InfoRow label="Status" value={task.is_completed ? 'Closed' : 'Open'} />
          {task.is_completed && (
            <>
              <InfoRow label="Completed By" value={completedByName} />
              <InfoRow label="Completed At" value={task.completed_at ? formatDate(task.completed_at) : null} />
            </>
          )}
          {task.description && (
            <div className="pt-2 border-t border-n-100">
              <span className="text-n-500 text-sm block mb-1">Description</span>
              <p className="text-sm text-n-700 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}
          {task.remarks && (
            <div className="pt-2 border-t border-n-100">
              <span className="text-n-500 text-sm block mb-1">Notes</span>
              <p className="text-sm text-n-700 whitespace-pre-wrap">{task.remarks}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Work Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TaskWorkLog taskId={task.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  label,
  value,
  capitalize = false,
  highlight = false,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm gap-3">
      <span className="text-n-500 shrink-0">{label}</span>
      <span
        className={[
          'text-right',
          highlight ? 'text-red-600 font-medium' : 'text-n-700',
          capitalize ? 'capitalize' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value || <span className="text-n-300">—</span>}
      </span>
    </div>
  );
}
