'use client';

import { useState, useTransition } from 'react';
import { createLeadTask } from '@/lib/leads-task-actions';
import { Button, Input, Select } from '@repo/ui';

interface QuickAddTaskProps {
  leadId: string;
  employees: { id: string; full_name: string }[];
  currentUserId: string;
}

export function QuickAddTask({ leadId, employees, currentUserId }: QuickAddTaskProps) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState(currentUserId || '');
  const [dueDate, setDueDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0]!;
  });
  const [priority, setPriority] = useState('medium');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    startTransition(async () => {
      const result = await createLeadTask({
        leadId,
        title: title.trim(),
        assignedTo,
        dueDate,
        priority,
      });
      if (result.success) {
        setTitle('');
        setMessage({ type: 'success', text: 'Task created' });
        setTimeout(() => setMessage(null), 2000);
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed' });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <label className="text-xs font-medium text-n-500 mb-1 block">Task</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call back about site survey"
          className="h-9 text-sm"
          required
        />
      </div>
      <div className="w-44">
        <label className="text-xs font-medium text-n-500 mb-1 block">Assign To</label>
        <Select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="h-9 text-sm"
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name} {emp.id === currentUserId ? '(Me)' : ''}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <label className="text-xs font-medium text-n-500 mb-1 block">Due Date</label>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-9 text-sm"
          required
        />
      </div>
      <div className="w-28">
        <label className="text-xs font-medium text-n-500 mb-1 block">Priority</label>
        <Select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="h-9 text-sm"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
      </div>
      <Button type="submit" size="sm" className="h-9" disabled={isPending}>
        {isPending ? 'Adding...' : 'Add Task'}
      </Button>
      {message && (
        <span className={`text-xs ${message.type === 'success' ? 'text-shiroi-green' : 'text-red-600'}`}>
          {message.text}
        </span>
      )}
    </form>
  );
}
