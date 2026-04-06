'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createServiceTicket } from '@/lib/service-ticket-actions';

const ISSUE_TYPES = [
  { value: 'no_generation', label: 'No Generation' },
  { value: 'low_generation', label: 'Low Generation' },
  { value: 'inverter_fault', label: 'Inverter Fault' },
  { value: 'panel_damage', label: 'Panel Damage' },
  { value: 'wiring_issue', label: 'Wiring Issue' },
  { value: 'earthing_issue', label: 'Earthing Issue' },
  { value: 'monitoring_offline', label: 'Monitoring Offline' },
  { value: 'physical_damage', label: 'Physical Damage' },
  { value: 'warranty_claim', label: 'Warranty Claim' },
  { value: 'billing_issue', label: 'Billing Issue' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical (4h SLA)' },
];

interface CreateTicketDialogProps {
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function CreateTicketDialog({ employees, projects }: CreateTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const projectId = form.get('projectId') as string;
    if (!projectId) {
      setError('Project is required');
      setSaving(false);
      return;
    }

    const result = await createServiceTicket({
      projectId,
      title: form.get('title') as string,
      description: form.get('description') as string,
      issueType: form.get('issueType') as string,
      severity: form.get('severity') as string,
      assignedTo: form.get('assignedTo') as string || undefined,
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
          <Plus className="h-4 w-4" /> New Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Service Ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="projectId">Project *</Label>
            <Select id="projectId" name="projectId" required defaultValue="">
              <option value="" disabled>Select a project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </Select>
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
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
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
