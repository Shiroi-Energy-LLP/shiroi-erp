'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createAmcSchedule } from '@/lib/amc-actions';

interface CreateAmcDialogProps {
  projects: { id: string; project_number: string; customer_name: string; commissioned_date: string | null }[];
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const parts = d.toISOString().split('T');
  return parts[0] ?? dateStr;
}

export function CreateAmcDialog({ projects }: CreateAmcDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [commDate, setCommDate] = React.useState('');
  const [visit1, setVisit1] = React.useState('');
  const [visit2, setVisit2] = React.useState('');
  const [visit3, setVisit3] = React.useState('');

  function handleProjectChange(projectId: string) {
    setSelectedProject(projectId);
    const project = projects.find((p) => p.id === projectId);
    if (project?.commissioned_date) {
      const cd = project.commissioned_date;
      setCommDate(cd);
      setVisit1(addMonths(cd, 4));
      setVisit2(addMonths(cd, 8));
      setVisit3(addMonths(cd, 12));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedProject || !commDate) {
      setError('Please select a commissioned project');
      return;
    }
    if (!visit1 || !visit2 || !visit3) {
      setError('All 3 visit dates are required');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await createAmcSchedule({
      projectId: selectedProject,
      commissioningDate: commDate,
      visitDates: [visit1, visit2, visit3],
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      setSelectedProject('');
      setCommDate('');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create AMC schedule');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Create AMC
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Free AMC Schedule</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-n-500 -mt-2">
          Select a commissioned project to schedule 3 free maintenance visits at 4-month intervals.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="amc-project">Project *</Label>
            <Select
              id="amc-project"
              value={selectedProject}
              onChange={(e) => handleProjectChange(e.target.value)}
              required
            >
              <option value="" disabled>Select a commissioned project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.customer_name}
                </option>
              ))}
            </Select>
          </div>
          {commDate && (
            <>
              <div>
                <Label>Commissioning Date</Label>
                <Input value={commDate} disabled className="bg-n-100" />
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="visit1">Visit 1 (4 months)</Label>
                  <Input
                    id="visit1"
                    type="date"
                    value={visit1}
                    onChange={(e) => setVisit1(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="visit2">Visit 2 (8 months)</Label>
                  <Input
                    id="visit2"
                    type="date"
                    value={visit2}
                    onChange={(e) => setVisit2(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="visit3">Visit 3 (12 months)</Label>
                  <Input
                    id="visit3"
                    type="date"
                    value={visit3}
                    onChange={(e) => setVisit3(e.target.value)}
                    required
                  />
                </div>
              </div>
            </>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !commDate}>
              {saving ? 'Creating...' : 'Create AMC Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
