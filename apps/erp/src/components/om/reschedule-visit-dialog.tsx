'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { CalendarDays } from 'lucide-react';
import { rescheduleVisit, assignVisitEngineer } from '@/lib/amc-actions';

interface RescheduleVisitDialogProps {
  visit: {
    id: string;
    visit_number: number;
    scheduled_date: string;
    assigned_to: string | null;
  };
  employees: { id: string; full_name: string }[];
}

export function RescheduleVisitDialog({ visit, employees }: RescheduleVisitDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const newDate = form.get('newDate') as string;
    const reason = form.get('reason') as string;
    const engineerId = form.get('engineer') as string;

    // Reschedule if date changed
    if (newDate && newDate !== visit.scheduled_date) {
      const result = await rescheduleVisit({
        visitId: visit.id,
        newDate,
        reason: reason || undefined,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to reschedule');
        setSaving(false);
        return;
      }
    }

    // Assign engineer if changed
    if (engineerId !== (visit.assigned_to ?? '')) {
      const result = await assignVisitEngineer(visit.id, engineerId);
      if (!result.success) {
        setError(result.error ?? 'Failed to assign engineer');
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Reschedule / Edit visit">
          <CalendarDays className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Visit #{visit.visit_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="newDate" className="text-xs">Scheduled Date</Label>
            <Input
              id="newDate"
              name="newDate"
              type="date"
              defaultValue={visit.scheduled_date}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label htmlFor="engineer" className="text-xs">Assigned Engineer</Label>
            <Select id="engineer" name="engineer" defaultValue={visit.assigned_to ?? ''} className="h-8 text-xs">
              <option value="">— Unassigned —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="reason" className="text-xs">Reschedule Reason</Label>
            <textarea
              id="reason"
              name="reason"
              rows={2}
              className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-p-400"
              placeholder="Optional reason for rescheduling..."
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
