'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updateServiceTicket } from '@/lib/service-ticket-actions';

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

interface EditTicketDialogProps {
  ticket: {
    id: string;
    title: string;
    description: string;
    issue_type: string;
    severity: string;
    assigned_to: string | null;
    service_amount: number;
    resolution_notes: string | null;
  };
  employees: { id: string; full_name: string }[];
}

export function EditTicketDialog({ ticket, employees }: EditTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const serviceAmountStr = form.get('serviceAmount') as string;

    const result = await updateServiceTicket({
      ticketId: ticket.id,
      title: form.get('title') as string,
      description: form.get('description') as string,
      issueType: form.get('issueType') as string,
      severity: form.get('severity') as string,
      assignedTo: form.get('assignedTo') as string || undefined,
      serviceAmount: serviceAmountStr ? parseFloat(serviceAmountStr) : 0,
      resolutionNotes: form.get('resolutionNotes') as string || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update ticket');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Edit ticket">
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Service Ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="title" className="text-xs">Title *</Label>
            <Input id="title" name="title" required defaultValue={ticket.title} className="h-8 text-xs" />
          </div>
          <div>
            <Label htmlFor="description" className="text-xs">Description</Label>
            <textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={ticket.description}
              className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
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
              <Label htmlFor="assignedTo" className="text-xs">Assign To</Label>
              <Select id="assignedTo" name="assignedTo" defaultValue={ticket.assigned_to ?? ''} className="h-8 text-xs">
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
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
              className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
              placeholder="Notes about resolution..."
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
