import { notFound } from 'next/navigation';
import { getLead, getSalesEngineers } from '@/lib/leads-queries';
import { getLeadTasks } from '@/lib/leads-task-actions';
import { QuickAddTask } from '@/components/leads/quick-add-task';
import { CompleteTaskButton } from '@/components/leads/complete-task-button';
import { createClient } from '@repo/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface TasksTabProps {
  params: Promise<{ id: string }>;
}

export default async function TasksTab({ params }: TasksTabProps) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: currentEmployee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user!.id)
    .single();

  const [lead, tasks, employees] = await Promise.all([
    getLead(id),
    getLeadTasks(id),
    getSalesEngineers(),
  ]);

  if (!lead) {
    notFound();
  }

  const pendingTasks = tasks.filter((t: any) => !t.is_completed);
  const completedTasks = tasks.filter((t: any) => t.is_completed);

  return (
    <div className="space-y-6">
      {/* Quick add task */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Task</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickAddTask
            leadId={id}
            employees={employees}
            currentUserId={currentEmployee?.id ?? ''}
          />
        </CardContent>
      </Card>

      {/* Pending tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending Tasks ({pendingTasks.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingTasks.length === 0 ? (
            <p className="text-sm text-n-500">No pending tasks. Add one above.</p>
          ) : (
            <div className="divide-y divide-n-100">
              {pendingTasks.map((task: any) => (
                <TaskRow key={task.id} task={task} leadId={id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-n-500">
              Completed ({completedTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-n-100">
              {completedTasks.map((task: any) => (
                <TaskRow key={task.id} task={task} leadId={id} completed />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TaskRow({ task, leadId, completed }: { task: any; leadId: string; completed?: boolean }) {
  const isOverdue = !completed && task.due_date && new Date(task.due_date) < new Date();
  return (
    <div className={`py-3 flex items-center justify-between ${completed ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          completed ? 'bg-n-300' :
          task.priority === 'urgent' ? 'bg-red-500' :
          task.priority === 'high' ? 'bg-orange-500' :
          'bg-n-300'
        }`} />
        <div>
          <div className={`text-sm font-medium ${completed ? 'line-through text-n-500' : 'text-n-900'}`}>
            {task.title}
          </div>
          {task.description && (
            <div className="text-xs text-n-500 mt-0.5">{task.description}</div>
          )}
          <div className="text-xs text-n-500 mt-0.5">
            {task.assigned?.full_name ?? 'Unassigned'}
            {task.due_date && (
              <span className={isOverdue ? 'text-red-600 font-medium ml-2' : ' ml-2'}>
                Due: {new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                {isOverdue && ' (overdue)'}
              </span>
            )}
            {task.creator?.full_name && (
              <span className="ml-2">Created by {task.creator.full_name}</span>
            )}
          </div>
        </div>
      </div>
      {!completed && (
        <CompleteTaskButton taskId={task.id} leadId={leadId} />
      )}
    </div>
  );
}
