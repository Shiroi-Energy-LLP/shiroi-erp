import { getUserProfile } from '@/lib/auth';
import { getMyTasks } from '@/lib/tasks-queries';
import { formatDate } from '@repo/ui/formatters';
import { redirect } from 'next/navigation';
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
import { CheckSquare } from 'lucide-react';
import Link from 'next/link';

export default async function MyTasksPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const tasks = await getMyTasks(profile.id);
  const pendingCount = tasks.filter((t) => !t.is_completed).length;
  const completedCount = tasks.filter((t) => t.is_completed).length;

  function priorityVariant(priority: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (priority) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">MY TASKS</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">
            My Tasks{' '}
            <span className="text-base font-normal text-[#7C818E]">
              ({pendingCount} pending, {completedCount} done)
            </span>
          </h1>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <CheckSquare className="h-8 w-8 text-muted-foreground/50" />
                      No open tasks assigned to you.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => {
                  const isOverdue = task.due_date && !task.is_completed && new Date(task.due_date) < new Date();
                  return (
                    <TableRow key={task.id} className={task.is_completed ? 'opacity-60' : ''}>
                      <TableCell>
                        <TaskCompletionToggle
                          taskId={task.id}
                          isCompleted={task.is_completed}
                          projectId={task.project_id ?? undefined}
                        />
                      </TableCell>
                      <TableCell className={`font-medium ${task.is_completed ? 'line-through text-n-400' : ''}`}>
                        {task.title}
                      </TableCell>
                      <TableCell>
                        {task.project_id ? (
                          <Link href={`/projects/${task.project_id}`} className="text-p-600 hover:underline text-xs">
                            View Project
                          </Link>
                        ) : (
                          <span className="text-[#9CA0AB]">{'\u2014'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {task.entity_type?.replace(/_/g, ' ') ?? '\u2014'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={priorityVariant(task.priority)}>
                          {task.priority.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {task.due_date ? (
                          <span className={isOverdue ? 'text-[#991B1B] font-medium' : ''}>
                            {formatDate(task.due_date)}
                          </span>
                        ) : '\u2014'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.is_completed ? 'default' : isOverdue ? 'destructive' : 'secondary'}>
                          {task.is_completed ? 'Done' : isOverdue ? 'Overdue' : 'Open'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
