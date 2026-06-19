'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { isTaskOverdue } from '@/lib/tasks-helpers';
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
  projects: { id: string; project_number: string; customer_name: string; project_name?: string | null }[];
}

export function TasksTable({ tasks, employees, projects }: TasksTableProps) {
  return (
    <tbody>
      {tasks.map((task: any) => {
        const overdue = isTaskOverdue(task.due_date) && !task.is_completed;
        const projectInfo = task.project as { project_number: string; customer_name: string } | null;
        const completedByName = task.completed_by_employee && 'full_name' in task.completed_by_employee
          ? (task.completed_by_employee as { full_name: string }).full_name
          : null;

        return (
          <tr key={task.id} className="border-b border-n-100 hover:bg-n-50">
            {/* Client — project customer if project-linked, lead customer otherwise */}
            <td className="px-3 py-2 align-top">
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

            {/* Task Name — links to detail page */}
            <td className="px-3 py-2 align-top font-medium text-n-900">
              <Link href={`/tasks/${task.id}`} className="flex items-center gap-1.5 flex-wrap hover:text-p-600 hover:underline">
                {typeof task.title === 'string' && task.title.startsWith('[AI] ') && (
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 shrink-0">AI</Badge>
                )}
                <span title={task.title}>
                  {typeof task.title === 'string' && task.title.startsWith('[AI] ')
                    ? task.title.slice(5)
                    : task.title}
                </span>
              </Link>
            </td>

            {/* Assigned To */}
            <td className="px-3 py-2 align-top text-n-700">
              {task.assignee?.full_name ?? <span className="text-n-300">—</span>}
            </td>

            {/* Status — Open (red) / Closed (green) toggle */}
            <td className="px-3 py-2 align-top whitespace-nowrap">
              <TaskStatusToggle
                taskId={task.id}
                isCompleted={task.is_completed}
                isOverdue={overdue}
              />
            </td>

            {/* Priority */}
            <td className="px-3 py-2 align-top whitespace-nowrap">
              <Badge variant={getPriorityVariant(task.priority)} className="text-[10px] px-1.5 py-0">
                {task.priority?.charAt(0).toUpperCase() + task.priority?.slice(1)}
              </Badge>
            </td>

            {/* Due Date */}
            <td className="px-3 py-2 align-top whitespace-nowrap">
              {task.due_date ? (
                <span className={overdue ? 'text-red-600 font-medium' : 'text-n-600'}>
                  {formatDate(task.due_date)}
                </span>
              ) : (
                <span className="text-n-300">—</span>
              )}
            </td>

            {/* Notes */}
            <td className="px-3 py-2 align-top text-n-600 max-w-[260px]" title={task.remarks ?? ''}>
              {task.remarks ?? <span className="text-n-300">—</span>}
            </td>

            {/* Done By */}
            <td className="px-3 py-2 align-top text-n-600">
              {completedByName ?? <span className="text-n-300">—</span>}
            </td>

            {/* Actions (Edit / Delete) */}
            <td className="px-3 py-2 align-top whitespace-nowrap">
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
        );
      })}
    </tbody>
  );
}
