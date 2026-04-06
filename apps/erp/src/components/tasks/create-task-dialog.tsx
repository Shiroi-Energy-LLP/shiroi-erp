'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createTask } from '@/lib/tasks-actions';

interface CreateTaskDialogProps {
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function CreateTaskDialog({ employees, projects }: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createTask({
      title: form.get('title') as string,
      description: form.get('description') as string || undefined,
      entityType: form.get('entityType') as string,
      projectId: form.get('projectId') as string || undefined,
      entityId: form.get('projectId') as string || undefined,
      priority: form.get('priority') as string,
      dueDate: form.get('dueDate') as string || undefined,
      assignedTo: form.get('assignedTo') as string || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create task');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required placeholder="What needs to be done?" />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
              placeholder="Additional details..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="entityType">Type</Label>
              <Select id="entityType" name="entityType" defaultValue="project">
                <option value="project">Project</option>
                <option value="lead">Lead</option>
                <option value="om_ticket">O&M Ticket</option>
                <option value="procurement">Procurement</option>
                <option value="hr">HR</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select id="priority" name="priority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="projectId">Project</Label>
            <Select id="projectId" name="projectId" defaultValue="">
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="assignedTo">Assign To</Label>
              <Select id="assignedTo" name="assignedTo" defaultValue="">
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dueDate">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
