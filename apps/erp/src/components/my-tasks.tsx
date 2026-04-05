import { getMyTasks } from '@/lib/tasks-queries';
import { isTaskOverdue, formatEntityType, priorityVariant } from '@/lib/tasks-helpers';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { ClipboardList } from 'lucide-react';

export async function MyTasks({ employeeId }: { employeeId: string }) {
  const tasks = await getMyTasks(employeeId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">My Tasks</CardTitle>
        <Badge variant="neutral">{tasks.length}</Badge>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-n-400">
            <ClipboardList className="h-8 w-8" />
            <p className="text-sm">No open tasks assigned to you.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const overdue = isTaskOverdue(task.due_date);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium text-n-900 max-w-[240px] truncate">
                      {task.title}
                    </TableCell>
                    <TableCell>{formatEntityType(task.entity_type)}</TableCell>
                    <TableCell>
                      {task.due_date ? (
                        <span className={overdue ? 'text-status-error-text font-semibold' : ''}>
                          {formatDate(task.due_date)}
                        </span>
                      ) : (
                        <span className="text-n-400">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(task.priority)}>
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={overdue ? 'error' : 'pending'}>
                        {overdue ? 'Overdue' : 'Open'}
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
  );
}
