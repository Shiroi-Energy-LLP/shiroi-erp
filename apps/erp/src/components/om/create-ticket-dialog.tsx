'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createServiceTicket, type TicketStatus } from '@/lib/service-ticket-actions';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import { ISSUE_TYPES, SEVERITY_OPTIONS, STATUS_OPTIONS } from '@/lib/ticket-constants';

interface CreateTicketDialogProps {
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string | null; customer_name: string; project_name?: string | null }[];
}

export function CreateTicketDialog({ employees, projects }: CreateTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState('');
  const [customProject, setCustomProject] = React.useState('');
  // Lazy initialiser keeps today's date off the server render (hydration mismatch).
  // Shifted to IST before slicing — plain toISOString() would default to
  // yesterday for anyone opening this between midnight and 05:30 IST.
  const [today] = React.useState(() =>
    new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );

  React.useEffect(() => {
    if (!open) {
      setProjectId('');
      setCustomProject('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!projectId && !customProject.trim()) {
      setError('Pick a project or type a project name');
      setSaving(false);
      return;
    }

    const form = new FormData(e.currentTarget);
    const serviceAmountStr = form.get('serviceAmount') as string;
    const result = await createServiceTicket({
      projectId: projectId || undefined,
      projectNameCustom: projectId ? undefined : customProject.trim() || undefined,
      title: form.get('title') as string,
      description: form.get('description') as string,
      issueType: form.get('issueType') as string,
      severity: form.get('severity') as string,
      assignedTo: form.get('assignedTo') as string || undefined,
      status: (form.get('status') as TicketStatus) || undefined,
      doneBy: (form.get('doneBy') as string) || null,
      serviceAmount: serviceAmountStr ? parseFloat(serviceAmountStr) : 0,
      createdAt: (form.get('createdAt') as string) || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create ticket');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Create New Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Service Ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Project *</Label>
            <ProjectCombobox
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              allowCustom
              customValue={customProject}
              onCustomChange={setCustomProject}
              placeholder="Search project, or type a new name (Service/AMC/misc)…"
            />
          </div>
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required placeholder="Brief description of the issue" />
          </div>
          <div>
            <Label htmlFor="description">Description *</Label>
            <textarea
              id="description"
              name="description"
              required
              rows={3}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
              placeholder="Detailed description of the issue..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="issueType">Issue Type *</Label>
              <Select id="issueType" name="issueType" required defaultValue="other">
                {ISSUE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="severity">Severity *</Label>
              <Select id="severity" name="severity" required defaultValue="medium">
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="assignedTo">Assign To</Label>
            <Select id="assignedTo" name="assignedTo" defaultValue="">
              <option value="">— Unassigned —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue="open">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="doneBy">Done By</Label>
              <Select id="doneBy" name="doneBy" defaultValue="">
                <option value="">— Not set —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="serviceAmount">Service Amount (₹)</Label>
              <Input id="serviceAmount" name="serviceAmount" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="createdAt">Created Date</Label>
              <Input id="createdAt" name="createdAt" type="date" defaultValue={today} />
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Ticket'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
