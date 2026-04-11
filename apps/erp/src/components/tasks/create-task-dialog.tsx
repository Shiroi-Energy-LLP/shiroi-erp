'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus, Search } from 'lucide-react';
import { createTask, getMilestonesForProject } from '@/lib/tasks-actions';
import { TASK_CATEGORIES } from '@/lib/task-constants';

interface CreateTaskDialogProps {
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string; customer_name: string }[];
}

// ── Searchable Project Dropdown ──

function SearchableProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: { id: string; project_number: string; customer_name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = search
    ? projects.filter(
        (p) =>
          p.project_number.toLowerCase().includes(search.toLowerCase()) ||
          p.customer_name.toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  const selectedProject = projects.find((p) => p.id === value);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        className="flex items-center gap-1 w-full rounded-md border border-n-200 px-2 h-8 text-xs cursor-pointer hover:border-n-300"
        onClick={() => setOpen(!open)}
      >
        <Search className="h-3 w-3 text-n-400 flex-shrink-0" />
        {open ? (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="flex-1 outline-none text-xs bg-transparent"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`flex-1 truncate ${selectedProject ? 'text-n-900' : 'text-n-400'}`}>
            {selectedProject
              ? `${selectedProject.project_number} — ${selectedProject.customer_name}`
              : '— Select Project —'}
          </span>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-n-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 text-xs text-n-400 hover:bg-n-50"
            onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
          >
            — None —
          </button>
          {filtered.slice(0, 50).map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full text-left px-2 py-1.5 text-xs hover:bg-n-50 ${p.id === value ? 'bg-p-50 text-p-700 font-medium' : 'text-n-700'}`}
              onClick={() => { onChange(p.id); setOpen(false); setSearch(''); }}
            >
              {p.project_number} — {p.customer_name}
            </button>
          ))}
          {filtered.length > 50 && (
            <div className="px-2 py-1 text-[10px] text-n-400">+{filtered.length - 50} more — refine your search</div>
          )}
          {filtered.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-n-400 text-center">No projects found</div>
          )}
        </div>
      )}
    </div>
  );
}

export function CreateTaskDialog({ employees, projects }: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [milestones, setMilestones] = React.useState<{ id: string; milestone_name: string }[]>([]);
  const [loadingMilestones, setLoadingMilestones] = React.useState(false);

  // Load milestones when project changes
  React.useEffect(() => {
    if (!selectedProject) {
      setMilestones([]);
      return;
    }
    setLoadingMilestones(true);
    getMilestonesForProject(selectedProject).then((ms) => {
      setMilestones(ms);
      setLoadingMilestones(false);
    });
  }, [selectedProject]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createTask({
      title: form.get('title') as string,
      description: form.get('description') as string || undefined,
      entityType: selectedProject ? 'project' : (form.get('entityType') as string),
      projectId: selectedProject || undefined,
      entityId: selectedProject || undefined,
      priority: form.get('priority') as string,
      dueDate: form.get('dueDate') as string || undefined,
      assignedTo: form.get('assignedTo') as string || undefined,
      category: form.get('category') as string || undefined,
      remarks: form.get('remarks') as string || undefined,
      milestoneId: form.get('milestoneId') as string || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      setSelectedProject('');
      setMilestones([]);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create task');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelectedProject(''); setMilestones([]); } }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="title" className="text-xs">Title *</Label>
            <Input id="title" name="title" required placeholder="What needs to be done?" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Project</Label>
            <SearchableProjectSelect
              projects={projects}
              value={selectedProject}
              onChange={setSelectedProject}
            />
          </div>
          {milestones.length > 0 && (
            <div>
              <Label htmlFor="milestoneId" className="text-xs">Milestone</Label>
              <Select id="milestoneId" name="milestoneId" defaultValue="" className="h-8 text-xs">
                <option value="">— None —</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.milestone_name.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </div>
          )}
          {loadingMilestones && <p className="text-[10px] text-n-400">Loading milestones...</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="category" className="text-xs">Category</Label>
              <Select id="category" name="category" defaultValue="general" className="h-8 text-xs">
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="priority" className="text-xs">Priority</Label>
              <Select id="priority" name="priority" defaultValue="medium" className="h-8 text-xs">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="assignedTo" className="text-xs">Assign To</Label>
              <Select id="assignedTo" name="assignedTo" defaultValue="" className="h-8 text-xs">
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dueDate" className="text-xs">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" className="h-8 text-xs" />
            </div>
          </div>
          {!selectedProject && (
            <div>
              <Label htmlFor="entityType" className="text-xs">Type</Label>
              <Select id="entityType" name="entityType" defaultValue="project" className="h-8 text-xs">
                <option value="project">Project</option>
                <option value="lead">Lead</option>
                <option value="om_ticket">O&M Ticket</option>
                <option value="procurement">Procurement</option>
                <option value="hr">HR</option>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="remarks" className="text-xs">Notes / Remarks</Label>
            <textarea
              id="remarks"
              name="remarks"
              rows={2}
              className="w-full rounded-md border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green"
              placeholder="Any remarks..."
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
