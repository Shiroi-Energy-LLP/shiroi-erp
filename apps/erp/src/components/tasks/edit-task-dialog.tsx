'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updateTask } from '@/lib/tasks-actions';
import { TASK_CATEGORIES } from '@/lib/task-constants';

interface EditTaskDialogProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
    remarks: string | null;
    project_id: string | null;
    entity_type: string | null;
  };
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function EditTaskDialog({ task, employees, projects }: EditTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await updateTask({
      taskId: task.id,
      title: form.get('title') as string,
      description: form.get('description') as string || undefined,
      category: form.get('category') as string || undefined,
      priority: form.get('priority') as string,
      dueDate: form.get('dueDate') as string || undefined,
      assignedTo: form.get('assignedTo') as string || undefined,
      remarks: form.get('remarks') as string || undefined,
      projectId: form.get('projectId') as string || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update task');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400 hover:text-p-600">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-title">Title *</Label>
            <Input id="edit-title" name="title" required defaultValue={task.title} />
          </div>
          <div>
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
              defaultValue={task.description ?? ''}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-category">Category</Label>
              <Select id="edit-category" name="category" defaultValue={task.category ?? 'general'}>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-priority">Priority</Label>
              <Select id="edit-priority" name="priority" defaultValue={task.priority}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="edit-projectId">Project</Label>
            <Select id="edit-projectId" name="projectId" defaultValue={task.project_id ?? ''}>
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-assignedTo">Assign To</Label>
              <Select id="edit-assignedTo" name="assignedTo" defaultValue={task.assigned_to ?? ''}>
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-dueDate">Due Date</Label>
              <Input id="edit-dueDate" name="dueDate" type="date" defaultValue={task.due_date ?? ''} />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-remarks">Remarks</Label>
            <textarea
              id="edit-remarks"
              name="remarks"
              rows={2}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
              defaultValue={task.remarks ?? ''}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
