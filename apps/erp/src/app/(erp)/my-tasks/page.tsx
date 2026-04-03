import { getUserProfile } from '@/lib/auth';
import { getMyTasks } from '@/lib/tasks-queries';
import { formatDate } from '@repo/ui/formatters';
import { redirect } from 'next/navigation';
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
} from '@repo/ui';
import { CheckSquare } from 'lucide-react';

export default async function MyTasksPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const tasks = await getMyTasks(profile.id);

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
        <h1 className="text-2xl font-bold text-[#1A1D24]">My Tasks</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <CheckSquare className="h-8 w-8 text-muted-foreground/50" />
                      No open tasks assigned to you.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {task.entity_type?.replace(/_/g, ' ') ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(task.priority)}>
                        {task.priority.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {task.due_date ? formatDate(task.due_date) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={task.is_completed ? 'default' : 'secondary'}>
                        {task.is_completed ? 'Done' : 'Open'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
