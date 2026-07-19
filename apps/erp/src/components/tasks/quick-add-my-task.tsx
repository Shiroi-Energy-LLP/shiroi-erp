'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Input, Select } from '@repo/ui';
import { createTask } from '@/lib/tasks-actions';
import { SearchableProjectSelect } from './searchable-project-select';

interface QuickAddMyTaskProps {
  employees: { id: string; full_name: string }[];
  currentUserId: string;
}

/**
 * Always-visible inline quick-add bar pinned in the My Tasks page header.
 *
 * Task name is the only required field. Project is optional — a project-less
 * task is stored as entity_type='project' with project_id=null, the same
 * convention the full create-task dialog already uses (the entity_type CHECK
 * has no 'general'). Assignee defaults to the current user but is reassignable,
 * so this doubles as a quick delegate. After a successful add we keep
 * project/due/priority/assignee so several tasks can be fired off in a row;
 * only the title clears.
 */
export function QuickAddMyTask({ employees, currentUserId }: QuickAddMyTaskProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [priority, setPriority] = React.useState('medium');
  const [assignedTo, setAssignedTo] = React.useState(currentUserId || '');
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const result = await createTask({
        title: trimmed,
        entityType: 'project',
        projectId: projectId || undefined,
        entityId: projectId || undefined,
        priority,
        dueDate: dueDate || undefined,
        assignedTo,
      });
      if (result.success) {
        setTitle('');
        setMessage({ type: 'success', text: 'Task added' });
        setTimeout(() => setMessage(null), 2000);
        router.refresh();
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed to add task' });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-n-500 shrink-0">
        <Plus className="h-4 w-4" />
        Quick add
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task name…"
        className="h-9 text-sm flex-1 min-w-[200px]"
        aria-label="Task name"
        required
      />
      <div className="w-48">
        <SearchableProjectSelect
          value={projectId}
          onChange={setProjectId}
          placeholder="Project (optional)"
        />
      </div>
      <Input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="h-9 text-xs w-36"
        aria-label="Due date"
        title="Due date (optional)"
      />
      <Select
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        className="h-9 text-xs w-28"
        aria-label="Priority"
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </Select>
      <Select
        value={assignedTo}
        onChange={(e) => setAssignedTo(e.target.value)}
        className="h-9 text-xs w-40"
        aria-label="Assign to"
      >
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.full_name}{emp.id === currentUserId ? ' (Me)' : ''}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" className="h-9" disabled={isPending}>
        {isPending ? 'Adding…' : 'Add'}
      </Button>
      {message && (
        <span className={`text-xs ${message.type === 'success' ? 'text-shiroi-green' : 'text-red-600'}`}>
          {message.text}
        </span>
      )}
    </form>
  );
}
