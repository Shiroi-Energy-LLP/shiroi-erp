'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updateTask } from '@/lib/tasks-actions';
import { SearchableProjectSelect } from './searchable-project-select';

interface EditTaskDialogProps {
  task: {
    id: string;
    title: string;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
    remarks: string | null;
    project_id: string | null;
  };
  employees: { id: string; full_name: string }[];
  /** Display name for the task's current project (shown before the lazy picker loads). */
  projectLabel?: string | null;
}

export function EditTaskDialog({ task, employees, projectLabel }: EditTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState(task.project_id ?? '');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await updateTask({
      taskId: task.id,
      title: form.get('title') as string,
      priority: form.get('priority') as string,
      dueDate: form.get('dueDate') as string || undefined,
      assignedTo: form.get('assignedTo') as string || undefined,
      remarks: form.get('remarks') as string || undefined,
      projectId: selectedProject || undefined,
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
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs">Project Name</Label>
            <SearchableProjectSelect
              value={selectedProject}
              onChange={setSelectedProject}
              placeholder="— None —"
              selectedLabel={projectLabel}
            />
          </div>
          <div>
            <Label htmlFor="edit-title" className="text-xs">Task Name *</Label>
            <Input id="edit-title" name="title" required defaultValue={task.title} className="h-9 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-assignedTo" className="text-xs">Assigned To</Label>
              <Select id="edit-assignedTo" name="assignedTo" defaultValue={task.assigned_to ?? ''} className="h-9 text-xs">
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-dueDate" className="text-xs">Due Date</Label>
              <Input id="edit-dueDate" name="dueDate" type="date" defaultValue={task.due_date ?? ''} className="h-9 text-xs" />
            </div>
          </div>
          <div className="w-1/2 pr-1.5">
            <Label htmlFor="edit-priority" className="text-xs">Priority</Label>
            <Select id="edit-priority" name="priority" defaultValue={task.priority} className="h-9 text-xs">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-remarks" className="text-xs">Notes</Label>
            <textarea
              id="edit-remarks"
              name="remarks"
              rows={2}
              className="w-full rounded-md border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
              defaultValue={task.remarks ?? ''}
              placeholder="Any notes..."
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
