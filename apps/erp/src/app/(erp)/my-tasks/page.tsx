import { getCurrentEmployeeId } from '@/lib/auth';
import { getMyTasksDetailed } from '@/lib/all-tasks-queries';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { TasksTable } from '@/components/tasks/tasks-table';
import { QuickAddMyTask } from '@/components/tasks/quick-add-my-task';
import { KpiCard, Card, CardContent, Eyebrow } from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { ClipboardList } from 'lucide-react';

const TH = 'px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider';

export default async function MyTasksPage() {
  const employeeId = await getCurrentEmployeeId();

  if (!employeeId) {
    return (
      <ListPageShell>
        <div>
          <Eyebrow className="mb-1">MY TASKS</Eyebrow>
          <h1 className="text-2xl font-bold text-n-950">My Tasks</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-n-500">
            <ClipboardList className="h-10 w-10 text-n-300" />
            <p className="text-sm max-w-[360px]">
              Your login isn&rsquo;t linked to an employee record yet, so we can&rsquo;t load your
              tasks. Ask an admin to link your profile to an employee.
            </p>
          </CardContent>
        </Card>
      </ListPageShell>
    );
  }

  const [tasks, employees, projects] = await Promise.all([
    getMyTasksDetailed(employeeId),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  const total = tasks.length;
  const open = tasks.filter((t) => !t.is_completed).length;
  const closed = total - open;

  return (
    <ListPageShell
      header={
        <QuickAddMyTask
          employees={employees}
          projects={projects}
          currentUserId={employeeId}
        />
      }
    >
      <div>
        <Eyebrow className="mb-1">MY TASKS</Eyebrow>
        <h1 className="text-2xl font-bold text-n-950">My Tasks</h1>
      </div>

      {/* Header KPIs — scroll away */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Tasks" value={total} icon="ClipboardList" />
        <KpiCard label="Open Tasks" value={open} icon="Clock" />
        <KpiCard label="Closed Tasks" value={closed} icon="CheckCircle" />
      </div>

      {/* Task list — column header freezes at the top of the scroll region */}
      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Tasks Assigned</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                You have no tasks assigned to you right now.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
                <tr className="border-b border-n-200 bg-n-50 text-left">
                  <th className={TH}>Project</th>
                  <th className={TH}>Task Name</th>
                  <th className={TH}>Assigned To</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Priority</th>
                  <th className={TH}>Due Date</th>
                  <th className={TH}>Notes</th>
                  <th className={TH}>Done By</th>
                  <th className={`${TH} w-16`}>Actions</th>
                </tr>
              </thead>
              <TasksTable tasks={tasks} employees={employees} projects={projects} />
            </table>
          )}
        </CardContent>
      </Card>
    </ListPageShell>
  );
}
