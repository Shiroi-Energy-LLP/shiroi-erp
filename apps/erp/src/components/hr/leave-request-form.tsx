'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Select,
  useToast,
} from '@repo/ui';
import type { Database } from '@repo/types/database';

type LeaveType = Database['public']['Enums']['leave_type'];

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'casual', label: 'Casual Leave' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'earned', label: 'Earned Leave' },
  { value: 'maternity', label: 'Maternity Leave' },
  { value: 'paternity', label: 'Paternity Leave' },
  { value: 'compensatory', label: 'Compensatory Off' },
  { value: 'loss_of_pay', label: 'Loss of Pay' },
  { value: 'other', label: 'Other' },
];

interface LeaveRequestFormProps {
  employeeId: string;
}

export function LeaveRequestForm({ employeeId }: LeaveRequestFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    leave_type: '' as LeaveType | '',
    from_date: '',
    to_date: '',
    reason: '',
    is_half_day: false,
    half_day_session: '' as 'first_half' | 'second_half' | '',
  });

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
    if (success) setSuccess(false);
  }

  function calculateDays(): number {
    if (!form.from_date || !form.to_date) return 0;
    if (form.is_half_day) return 0.5;
    const from = new Date(form.from_date);
    const to = new Date(form.to_date);
    const diffMs = to.getTime() - from.getTime();
    return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const op = '[LeaveRequestForm.handleSubmit]';

    if (!form.leave_type || !form.from_date || !form.to_date || !form.reason) {
      setError('Please fill all required fields.');
      return;
    }

    if (new Date(form.to_date) < new Date(form.from_date)) {
      setError('To date cannot be before From date.');
      return;
    }

    if (form.is_half_day && !form.half_day_session) {
      setError('Please select which half-day session.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const daysRequested = calculateDays();

      const { error: insertError } = await supabase.from('leave_requests').insert({
        id: crypto.randomUUID(),
        employee_id: employeeId,
        leave_type: form.leave_type as LeaveType,
        from_date: form.from_date,
        to_date: form.is_half_day ? form.from_date : form.to_date,
        days_requested: daysRequested,
        is_half_day: form.is_half_day,
        half_day_session: form.is_half_day ? form.half_day_session : null,
        reason: form.reason,
        status: 'pending',
      });

      if (insertError) {
        console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
        setError(`Failed to submit leave request: ${insertError.message}`);
        addToast({ variant: 'destructive', title: 'Failed to submit leave request', description: insertError.message });
        return;
      }

      setSuccess(true);
      addToast({ variant: 'success', title: 'Leave request submitted', description: 'Your leave request has been submitted for approval.' });
      setForm({
        leave_type: '',
        from_date: '',
        to_date: '',
        reason: '',
        is_half_day: false,
        half_day_session: '',
      });
      router.refresh();
    } catch (err) {
      console.error(`${op} Failed:`, {
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      setError('An unexpected error occurred.');
      addToast({ variant: 'destructive', title: 'Failed to submit leave request', description: err instanceof Error ? err.message : 'An unexpected error occurred.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Apply for Leave</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">
              Leave request submitted successfully.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="leave_type">Leave Type *</Label>
              <Select
                id="leave_type"
                value={form.leave_type}
                onChange={(e) => updateField('leave_type', e.target.value)}
                required
              >
                <option value="">Select type...</option>
                {LEAVE_TYPES.map((lt) => (
                  <option key={lt.value} value={lt.value}>
                    {lt.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_half_day"
                  checked={form.is_half_day}
                  onChange={(e) => updateField('is_half_day', e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="is_half_day">Half Day</Label>
              </div>
              {form.is_half_day && (
                <Select
                  value={form.half_day_session}
                  onChange={(e) => updateField('half_day_session', e.target.value)}
                >
                  <option value="">Session...</option>
                  <option value="first_half">First Half</option>
                  <option value="second_half">Second Half</option>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="from_date">From Date *</Label>
              <Input
                id="from_date"
                type="date"
                value={form.from_date}
                onChange={(e) => updateField('from_date', e.target.value)}
                required
              />
            </div>
            {!form.is_half_day && (
              <div className="space-y-1">
                <Label htmlFor="to_date">To Date *</Label>
                <Input
                  id="to_date"
                  type="date"
                  value={form.to_date}
                  onChange={(e) => updateField('to_date', e.target.value)}
                  required
                />
              </div>
            )}
          </div>

          {form.from_date && (form.to_date || form.is_half_day) && (
            <p className="text-sm text-gray-500">
              Days requested: <span className="font-medium">{calculateDays()}</span>
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="reason">Reason *</Label>
            <textarea
              id="reason"
              value={form.reason}
              onChange={(e) => updateField('reason', e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Reason for leave..."
              required
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit Leave Request'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
