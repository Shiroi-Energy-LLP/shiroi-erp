'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createTask, getProjectMilestonesLite } from '@/lib/tasks-actions';
import { SearchableProjectSelect } from './searchable-project-select';

interface CreateTaskDialogProps {
  employees: { id: string; full_name: string }[];
}

export function CreateTaskDialog({ employees }: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [milestoneId, setMilestoneId] = React.useState('');
  const [milestones, setMilestones] = React.useState<{ id: string; milestone_name: string }[]>([]);

  async function handleProjectChange(id: string) {
    setSelectedProject(id);
    setMilestoneId('');
    if (id) {
      getProjectMilestonesLite(id).then(setMilestones);
    } else {
      setMilestones([]);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createTask({
      title: form.get('title') as string,
      entityType: 'project',
      projectId: selectedProject || undefined,
      entityId: selectedProject || undefined,
      priority: form.get('priority') as string,
      dueDate: form.get('dueDate') as string || undefined,
      assignedTo: form.get('assignedTo') as string || undefined,
      remarks: form.get('remarks') as string || undefined,
      milestoneId: milestoneId || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      setSelectedProject('');
      setMilestoneId('');
      setMilestones([]);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create task');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelectedProject(''); setMilestoneId(''); setMilestones([]); } }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm">New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs">Project Name</Label>
            <SearchableProjectSelect
              value={selectedProject}
              onChange={handleProjectChange}
            />
          </div>
          {milestones.length > 0 && (
            <div>
              <Label className="text-xs">Milestone (optional)</Label>
              <select
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
                className="w-full rounded-md border border-n-200 px-2 h-9 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
              >
                <option value="">— No milestone —</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.milestone_name.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="title" className="text-xs">Task Name *</Label>
            <Input id="title" name="title" required placeholder="What needs to be done?" className="h-9 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="assignedTo" className="text-xs">Assigned To</Label>
              <Select id="assignedTo" name="assignedTo" defaultValue="" className="h-9 text-xs">
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dueDate" className="text-xs">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" className="h-9 text-xs" />
            </div>
          </div>
          <div className="w-1/2 pr-1.5">
            <Label htmlFor="priority" className="text-xs">Priority</Label>
            <Select id="priority" name="priority" defaultValue="medium" className="h-9 text-xs">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="remarks" className="text-xs">Notes</Label>
            <textarea
              id="remarks"
              name="remarks"
              rows={2}
              className="w-full rounded-md border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
              placeholder="Any notes..."
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
