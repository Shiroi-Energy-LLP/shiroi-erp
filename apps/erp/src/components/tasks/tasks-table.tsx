'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@repo/ui';
import { MessageSquare, Plus } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import { isTaskOverdue } from '@/lib/tasks-helpers';
import { getWorkLogs, addWorkLog } from '@/lib/tasks-actions';
import { TaskStatusToggle } from '@/components/tasks/task-status-toggle';
import { EditTaskDialog } from '@/components/tasks/edit-task-dialog';
import { DeleteTaskButton } from '@/components/tasks/delete-task-button';

function getPriorityVariant(priority: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (priority) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'outline';
  }
}

interface TasksTableProps {
  tasks: any[];
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string; customer_name: string }[];
}

/**
 * Client component for the tasks table body.
 * Manages expandable activity log rows — one at a time.
 */
export function TasksTable({ tasks, employees, projects }: TasksTableProps) {
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = React.useState(false);

  async function handleToggleLog(taskId: string) {
    if (expandedLogId === taskId) {
      setExpandedLogId(null);
      return;
    }
    setExpandedLogId(taskId);
    setLoadingLogs(true);
    const result = await getWorkLogs(taskId);
    setLogs(result);
    setLoadingLogs(false);
  }

  async function handleAddLog(taskId: string, description: string) {
    await addWorkLog({ taskId, description, logDate: new Date().toISOString().split('T')[0] });
    const result = await getWorkLogs(taskId);
    setLogs(result);
  }

  return (
    <tbody>
      {tasks.map((task: any) => {
        const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
        const projectInfo = task.project as { project_number: string; customer_name: string } | null;
        const completedByName = task.completed_by_employee && 'full_name' in task.completed_by_employee
          ? (task.completed_by_employee as { full_name: string }).full_name
          : null;
        const isExpanded = expandedLogId === task.id;

        return (
          <React.Fragment key={task.id}>
            <tr className="border-b border-n-100 hover:bg-n-50">
              {/* Client — project customer if project-linked, lead customer otherwise */}
              <td className="px-2 py-1.5 text-[11px]">
                {projectInfo ? (
                  <Link href={`/projects/${task.project_id}`} className="text-p-600 hover:underline font-medium">
                    {projectInfo.customer_name}
                  </Link>
                ) : task.lead_customer_name && task.entity_type === 'lead' ? (
                  <Link href={`/sales/${task.entity_id}`} className="text-p-600 hover:underline font-medium">
                    {task.lead_customer_name}
                  </Link>
                ) : (
                  <span className="text-n-400">—</span>
                )}
              </td>

              {/* Task Name */}
              <td className="px-2 py-1.5 text-[11px] font-medium text-n-900">
                <span title={task.title}>{task.title}</span>
              </td>

              {/* Assigned To */}
              <td className="px-2 py-1.5 text-[11px] text-n-700">
                {task.assignee?.full_name ?? <span className="text-n-300">—</span>}
              </td>

              {/* Status — Open (red) / Closed (green) toggle */}
              <td className="px-2 py-1.5">
                <TaskStatusToggle
                  taskId={task.id}
                  isCompleted={task.is_completed}
                  isOverdue={overdue}
                />
              </td>

              {/* Priority */}
              <td className="px-2 py-1.5">
                <Badge variant={getPriorityVariant(task.priority)} className="text-[10px] px-1.5 py-0">
                  {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
                </Badge>
              </td>

              {/* Due Date */}
              <td className="px-2 py-1.5 text-[11px]">
                {task.due_date ? (
                  <span className={overdue ? 'text-red-600 font-medium' : 'text-n-600'}>
                    {formatDate(task.due_date)}
                  </span>
                ) : (
                  <span className="text-n-300">—</span>
                )}
              </td>

              {/* Notes */}
              <td className="px-2 py-1.5 text-[10px] text-n-600" title={task.remarks ?? ''}>
                {task.remarks ?? <span className="text-n-300">—</span>}
              </td>

              {/* Done By */}
              <td className="px-2 py-1.5 text-[11px] text-n-600">
                {completedByName ?? <span className="text-n-300">—</span>}
              </td>

              {/* Activity Log — icon only */}
              <td className="px-2 py-1.5">
                <button
                  onClick={() => handleToggleLog(task.id)}
                  className={`p-1 rounded hover:bg-n-100 transition-colors ${isExpanded ? 'text-p-600 bg-p-50' : 'text-n-400 hover:text-p-600'}`}
                  title="Activity Log"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              </td>

              {/* Actions (Edit / Delete) */}
              <td className="px-2 py-1.5">
                <div className="flex gap-0.5">
                  <EditTaskDialog
                    task={{
                      id: task.id,
                      title: task.title,
                      priority: task.priority,
                      due_date: task.due_date,
                      assigned_to: task.assigned_to,
                      remarks: task.remarks ?? null,
                      project_id: task.project_id,
                    }}
                    employees={employees}
                    projects={projects}
                  />
                  <DeleteTaskButton taskId={task.id} title={task.title} />
                </div>
              </td>
            </tr>

            {/* Expanded Activity Log — full-width row below */}
            {isExpanded && (
              <tr className="border-b border-n-200">
                <td colSpan={10} className="px-4 py-2.5 bg-n-50">
                  <ActivityLogPanel
                    taskId={task.id}
                    logs={logs}
                    loading={loadingLogs}
                    onAddLog={(desc) => handleAddLog(task.id, desc)}
                  />
                </td>
              </tr>
            )}
          </React.Fragment>
        );
      })}
    </tbody>
  );
}

// ── Activity Log Expanded Panel ──

function ActivityLogPanel({
  taskId,
  logs,
  loading,
  onAddLog,
}: {
  taskId: string;
  logs: any[];
  loading: boolean;
  onAddLog: (description: string) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const description = (fd.get('description') as string)?.trim();
    if (!description) return;
    setSaving(true);
    await onAddLog(description);
    setSaving(false);
    setShowAdd(false);
  }

  if (loading) {
    return <p className="text-[10px] text-n-400">Loading activity log...</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-n-500 uppercase tracking-wider">Activity Log</span>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-[10px] text-p-600 hover:text-p-700 flex items-center gap-0.5 font-medium"
          >
            <Plus className="h-2.5 w-2.5" /> Add Entry
          </button>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-white rounded border border-n-200 px-2 py-1.5">
          <input
            name="description"
            placeholder="What was done..."
            className="flex-1 text-[11px] outline-none bg-transparent"
            autoFocus
          />
          <button type="submit" disabled={saving} className="text-[10px] text-p-600 font-medium hover:text-p-700">
            {saving ? '...' : 'Save'}
          </button>
          <button type="button" onClick={() => setShowAdd(false)} className="text-[10px] text-n-400 hover:text-n-600">
            Cancel
          </button>
        </form>
      )}

      {logs.length === 0 ? (
        <p className="text-[10px] text-n-400">No activity logs yet.</p>
      ) : (
        <div className="space-y-1">
          {logs.map((log: any) => (
            <div key={log.id} className="flex items-start gap-2 text-[10px] border-l-2 border-p-200 pl-2 py-0.5">
              <span className="text-n-400 whitespace-nowrap">
                {log.log_date ? new Date(log.log_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
              </span>
              <span className="text-n-700 flex-1">{log.description}</span>
              <span className="text-n-400 whitespace-nowrap">{log.employees?.full_name || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
