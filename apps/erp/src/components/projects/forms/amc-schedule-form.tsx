'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label,
} from '@repo/ui';
import { createAmcSchedule } from '@/lib/amc-actions';

interface AmcScheduleFormProps {
  projectId: string;
  commissionedDate: string | null;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const parts = d.toISOString().split('T');
  return parts[0] ?? dateStr;
}

export function AmcScheduleForm({ projectId, commissionedDate }: AmcScheduleFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const baseDate = commissionedDate ?? new Date().toISOString().split('T')[0]!;
  const [visit1, setVisit1] = React.useState(addMonths(baseDate, 4));
  const [visit2, setVisit2] = React.useState(addMonths(baseDate, 8));
  const [visit3, setVisit3] = React.useState(addMonths(baseDate, 12));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await createAmcSchedule({
      projectId,
      category: 'free_amc',
      commissioningDate: baseDate,
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create AMC schedule');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          + Schedule Free AMC Visits
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Schedule Free AMC Visits</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-n-500 mb-4">
          3 free maintenance visits at 4-month intervals from commissioning date ({baseDate}).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="visit1">Visit 1 (~4 months)</Label>
              <Input id="visit1" type="date" value={visit1} onChange={(e) => setVisit1(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="visit2">Visit 2 (~8 months)</Label>
              <Input id="visit2" type="date" value={visit2} onChange={(e) => setVisit2(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="visit3">Visit 3 (~12 months)</Label>
              <Input id="visit3" type="date" value={visit3} onChange={(e) => setVisit3(e.target.value)} required />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create AMC Schedule'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
