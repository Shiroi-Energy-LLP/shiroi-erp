'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Select, useToast } from '@repo/ui';
import { addLeadActivity, type AddLeadActivityInput } from '@/lib/leads-activity-actions';

const ACTIVITY_TYPES = [
  'call',
  'email',
  'site_visit',
  'whatsapp',
  'meeting',
  'follow_up',
  'note',
] as const;

const ACTIVITY_LABELS: Record<string, string> = {
  call: 'Phone Call',
  email: 'Email',
  site_visit: 'Site Visit',
  whatsapp: 'WhatsApp',
  meeting: 'Meeting',
  follow_up: 'Follow Up',
  note: 'Note',
};

interface AddActivityFormProps {
  leadId: string;
}

export function AddActivityForm({ leadId }: AddActivityFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    activity_type: '',
    summary: '',
    outcome: '',
    next_action: '',
    next_action_date: '',
    duration_minutes: '',
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.activity_type || !form.summary) {
      setError('Activity type and summary are required.');
      return;
    }

    if (!form.next_action_date) {
      setError('Next follow-up date is required. Set the date for the next action.');
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await addLeadActivity({
        leadId,
        activityType: form.activity_type as AddLeadActivityInput['activityType'],
        summary: form.summary,
        outcome: form.outcome.trim() || null,
        nextAction: form.next_action.trim() || null,
        nextActionDate: form.next_action_date || null,
        durationMinutes: form.duration_minutes ? parseInt(form.duration_minutes, 10) : null,
      });

      if (!result.success) {
        setError(`Failed to add activity: ${result.error}`);
        addToast({ variant: 'destructive', title: 'Failed to add activity', description: result.error });
        return;
      }

      addToast({
        variant: 'success',
        title: 'Activity added',
        description: `${ACTIVITY_LABELS[form.activity_type] ?? 'Activity'} logged successfully.`,
      });

      setForm({
        activity_type: '',
        summary: '',
        outcome: '',
        next_action: '',
        next_action_date: '',
        duration_minutes: '',
      });

      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-status-error-bg border border-[#DC2626] px-4 py-2 text-sm text-status-error-text">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="activity_type">Type *</Label>
          <Select
            id="activity_type"
            value={form.activity_type}
            onChange={(e) => updateField('activity_type', e.target.value)}
            required
          >
            <option value="">Select type</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration_minutes">Duration (minutes)</Label>
          <Input
            id="duration_minutes"
            type="number"
            min="1"
            value={form.duration_minutes}
            onChange={(e) => updateField('duration_minutes', e.target.value)}
            placeholder="e.g. 15"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="summary">Summary *</Label>
        <textarea
          id="summary"
          value={form.summary}
          onChange={(e) => updateField('summary', e.target.value)}
          placeholder="What happened?"
          rows={2}
          required
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="outcome">Outcome</Label>
        <Input
          id="outcome"
          value={form.outcome}
          onChange={(e) => updateField('outcome', e.target.value)}
          placeholder="Result of the activity"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="next_action">Next Action</Label>
          <Input
            id="next_action"
            value={form.next_action}
            onChange={(e) => updateField('next_action', e.target.value)}
            placeholder="e.g. Send proposal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="next_action_date">Next Follow-up Date *</Label>
          <Input
            id="next_action_date"
            type="date"
            value={form.next_action_date}
            onChange={(e) => updateField('next_action_date', e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            required
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Adding...' : 'Add Activity'}
        </Button>
      </div>
    </form>
  );
}
