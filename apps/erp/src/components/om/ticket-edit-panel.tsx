'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Select } from '@repo/ui';
import { updateServiceTicket, type TicketStatus } from '@/lib/service-ticket-actions';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import { ISSUE_TYPES, SEVERITY_OPTIONS, STATUS_OPTIONS } from '@/lib/ticket-constants';

interface TicketEditPanelProps {
  ticket: {
    id: string;
    title: string;
    description: string;
    issue_type: string;
    severity: string;
    status: string;
    assigned_to: string | null;
    resolved_by: string | null;
    service_amount: number;
    resolution_notes: string | null;
    project_id: string | null;
    project_name_custom: string | null;
  };
  employees: { id: string; full_name: string }[];
  projects: { id: string; project_number: string | null; customer_name: string; project_name?: string | null }[];
}

export function TicketEditPanel({ ticket, employees, projects }: TicketEditPanelProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [projectId, setProjectId] = React.useState(ticket.project_id ?? '');
  const [customProject, setCustomProject] = React.useState(ticket.project_name_custom ?? '');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    if (!projectId && !customProject.trim()) {
      setError('Pick a project or type a project name');
      setSaving(false);
      return;
    }

    const form = new FormData(e.currentTarget);
    const serviceAmountStr = form.get('serviceAmount') as string;

    const result = await updateServiceTicket({
      ticketId: ticket.id,
      projectId: projectId || undefined,
      projectNameCustom: projectId ? undefined : customProject.trim() || undefined,
      title: form.get('title') as string,
      description: form.get('description') as string,
      issueType: form.get('issueType') as string,
      severity: form.get('severity') as string,
      status: form.get('status') as TicketStatus,
      assignedTo: form.get('assignedTo') as string || undefined,
      doneBy: (form.get('doneBy') as string) || null,
      serviceAmount: serviceAmountStr ? parseFloat(serviceAmountStr) : 0,
      resolutionNotes: form.get('resolutionNotes') as string || undefined,
    });

    setSaving(false);
    if (result.success) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(result.error ?? 'Failed to update ticket');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label className="text-xs">Project *</Label>
        <ProjectCombobox
          projects={projects}
          value={projectId}
          onChange={setProjectId}
          allowCustom
          customValue={customProject}
          onCustomChange={setCustomProject}
          placeholder="Search project, or type a new name…"
        />
      </div>
      <div>
        <Label htmlFor="title" className="text-xs">Title *</Label>
        <Input id="title" name="title" required defaultValue={ticket.title} className="h-8 text-xs" />
      </div>
      <div>
        <Label htmlFor="description" className="text-xs">Work Description</Label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={ticket.description}
          className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
          placeholder="Detailed description of the issue and work to be done…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="issueType" className="text-xs">Issue Type *</Label>
          <Select id="issueType" name="issueType" required defaultValue={ticket.issue_type} className="h-8 text-xs">
            {ISSUE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="severity" className="text-xs">Severity *</Label>
          <Select id="severity" name="severity" required defaultValue={ticket.severity} className="h-8 text-xs">
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="status" className="text-xs">Status *</Label>
          <Select id="status" name="status" required defaultValue={ticket.status} className="h-8 text-xs">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="assignedTo" className="text-xs">Assigned To</Label>
          <Select id="assignedTo" name="assignedTo" defaultValue={ticket.assigned_to ?? ''} className="h-8 text-xs">
            <option value="">— Unassigned —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="doneBy" className="text-xs">Done By</Label>
          <Select id="doneBy" name="doneBy" defaultValue={ticket.resolved_by ?? ''} className="h-8 text-xs">
            <option value="">— Not set —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="serviceAmount" className="text-xs">Service Amount (₹)</Label>
          <Input
            id="serviceAmount"
            name="serviceAmount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={ticket.service_amount || ''}
            placeholder="0.00"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="resolutionNotes" className="text-xs">Resolution Notes</Label>
        <textarea
          id="resolutionNotes"
          name="resolutionNotes"
          rows={2}
          defaultValue={ticket.resolution_notes ?? ''}
          className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
          placeholder="Notes about resolution…"
        />
      </div>
      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
