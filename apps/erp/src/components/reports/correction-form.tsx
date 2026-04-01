'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
} from '@repo/ui';
import { submitCorrectionAction } from './correction-actions';

/** Fields that can be corrected on a daily site report. */
const CORRECTABLE_FIELDS = [
  { value: 'panels_installed_today', label: 'Panels Installed Today' },
  { value: 'panels_installed_cumulative', label: 'Panels Installed Cumulative' },
  { value: 'workers_count', label: 'Workers Count' },
  { value: 'supervisors_count', label: 'Supervisors Count' },
  { value: 'weather', label: 'Weather' },
  { value: 'work_description', label: 'Work Description' },
  { value: 'structure_progress', label: 'Structure Progress' },
  { value: 'electrical_progress', label: 'Electrical Progress' },
  { value: 'materials_received', label: 'Materials Received' },
  { value: 'materials_summary', label: 'Materials Summary' },
  { value: 'issues_reported', label: 'Issues Reported' },
  { value: 'issue_summary', label: 'Issue Summary' },
] as const;

interface CorrectionFormProps {
  reportId: string;
  projectId: string;
  userId: string;
  report: Record<string, unknown>;
}

export function CorrectionForm({ reportId, projectId, userId, report }: CorrectionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedField, setSelectedField] = useState('');

  const originalValue = selectedField && report[selectedField] != null
    ? String(report[selectedField])
    : '';

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const fieldCorrected = formData.get('field_corrected') as string;
    const correctedValue = (formData.get('corrected_value') as string).trim();
    const correctionReason = (formData.get('correction_reason') as string).trim();

    if (!fieldCorrected) {
      setError('Please select a field to correct.');
      return;
    }
    if (!correctedValue) {
      setError('Please provide the corrected value.');
      return;
    }
    if (!correctionReason) {
      setError('Correction reason is mandatory.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await submitCorrectionAction({
          originalReportId: reportId,
          projectId,
          requestedBy: userId,
          fieldCorrected,
          originalValue,
          correctedValue,
          correctionReason,
        });

        if (result.error) {
          setError(result.error);
          return;
        }

        setSuccess(true);
        // Refresh the page to show the new correction in the list
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Correction Request</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-[#FEF2F2] border border-[#991B1B] text-[#991B1B] px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-[#E8F5E9] border border-[#065F46] text-[#065F46] px-4 py-3 rounded-md text-sm mb-4">
            Correction request submitted. A project manager will review and approve or reject it.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="field_corrected">Field to Correct *</Label>
            <select
              id="field_corrected"
              name="field_corrected"
              value={selectedField}
              onChange={(e) => setSelectedField(e.target.value)}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select a field...</option>
              {CORRECTABLE_FIELDS.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>

          {selectedField && (
            <div className="space-y-2">
              <Label>Original Value</Label>
              <div className="px-3 py-2 bg-[#F5F5F5] rounded-md text-sm font-mono">
                {originalValue || '(empty)'}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="corrected_value">Corrected Value *</Label>
            <Input
              id="corrected_value"
              name="corrected_value"
              required
              placeholder="Enter the correct value"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="correction_reason">Reason for Correction *</Label>
            <textarea
              id="correction_reason"
              name="correction_reason"
              rows={3}
              required
              placeholder="Explain why this correction is needed (mandatory)"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              This correction must be approved by a project manager. Supervisors cannot approve their own corrections.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/projects/${projectId}/reports`)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Submitting...' : 'Submit Correction Request'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
