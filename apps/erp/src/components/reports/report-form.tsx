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
import { PhotoUpload } from './photo-upload';
import { submitReportAction } from './report-actions';

interface ReportFormProps {
  projectId: string;
  userId: string;
  defaultDate: string;
  defaultWorkersCount: number;
  defaultSupervisorsCount: number;
  previousCumulativePanels: number;
  /** If provided, we are editing an existing report */
  existingReport?: {
    id: string;
    report_date: string;
    panels_installed_today: number;
    workers_count: number;
    supervisors_count: number;
    weather: string;
    weather_delay: boolean;
    weather_delay_hours: number | null;
    work_description: string;
    structure_progress: string | null;
    electrical_progress: string | null;
    materials_received: boolean;
    materials_summary: string | null;
    issues_reported: boolean;
    issue_summary: string | null;
    pm_visited: boolean;
    other_visitors: string | null;
  };
}

const WEATHER_OPTIONS = [
  { value: 'clear', label: 'Clear' },
  { value: 'partly_cloudy', label: 'Partly Cloudy' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'light_rain', label: 'Light Rain' },
  { value: 'heavy_rain', label: 'Heavy Rain' },
  { value: 'storm', label: 'Storm' },
];

export function ReportForm({
  projectId,
  userId,
  defaultDate,
  defaultWorkersCount,
  defaultSupervisorsCount,
  previousCumulativePanels,
  existingReport,
}: ReportFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<
    Array<{ storagePath: string; fileName: string; caption: string; fileSizeBytes: number }>
  >([]);

  const isEditing = !!existingReport;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const reportDate = formData.get('report_date') as string;
    const panelsInstalledToday = parseInt(formData.get('panels_installed_today') as string, 10) || 0;
    const workersCount = parseInt(formData.get('workers_count') as string, 10) || 0;
    const supervisorsCount = parseInt(formData.get('supervisors_count') as string, 10) || 0;
    const weather = formData.get('weather') as string;
    const weatherDelay = formData.get('weather_delay') === 'on';
    const weatherDelayHours = weatherDelay
      ? parseFloat(formData.get('weather_delay_hours') as string) || 0
      : null;
    const workDescription = (formData.get('work_description') as string).trim();
    const structureProgress = (formData.get('structure_progress') as string).trim() || null;
    const electricalProgress = (formData.get('electrical_progress') as string).trim() || null;
    const materialsReceived = formData.get('materials_received') === 'on';
    const materialsSummary = materialsReceived
      ? (formData.get('materials_summary') as string).trim() || null
      : null;
    const issuesReported = formData.get('issues_reported') === 'on';
    const issueSummary = issuesReported
      ? (formData.get('issue_summary') as string).trim() || null
      : null;
    const pmVisited = formData.get('pm_visited') === 'on';
    const otherVisitors = (formData.get('other_visitors') as string).trim() || null;

    if (!reportDate) {
      setError('Report date is required.');
      return;
    }
    if (!workDescription) {
      setError('Work description is required.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await submitReportAction({
          reportId: existingReport?.id,
          projectId,
          userId,
          reportDate,
          panelsInstalledToday,
          panelsInstalledCumulative: previousCumulativePanels + panelsInstalledToday,
          workersCount,
          supervisorsCount,
          weather,
          weatherDelay,
          weatherDelayHours,
          workDescription,
          structureProgress,
          electricalProgress,
          materialsReceived,
          materialsSummary,
          issuesReported,
          issueSummary,
          pmVisited,
          otherVisitors,
          photos: uploadedPhotos,
        });

        if (result.error) {
          setError(result.error);
          return;
        }

        router.push(`/projects/${projectId}/reports`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-status-error-bg border border-status-error-text text-status-error-text px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="report_date">Report Date *</Label>
              <Input
                id="report_date"
                name="report_date"
                type="date"
                defaultValue={existingReport?.report_date ?? defaultDate}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weather">Weather *</Label>
              <select
                id="weather"
                name="weather"
                defaultValue={existingReport?.weather ?? 'clear'}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {WEATHER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="panels_installed_today">Panels Installed Today</Label>
              <Input
                id="panels_installed_today"
                name="panels_installed_today"
                type="number"
                min="0"
                defaultValue={existingReport?.panels_installed_today ?? 0}
              />
              <p className="text-xs text-muted-foreground">
                Previous cumulative: {previousCumulativePanels}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workers_count">Workers on Site</Label>
              <Input
                id="workers_count"
                name="workers_count"
                type="number"
                min="0"
                defaultValue={existingReport?.workers_count ?? defaultWorkersCount}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supervisors_count">Supervisors on Site</Label>
              <Input
                id="supervisors_count"
                name="supervisors_count"
                type="number"
                min="0"
                defaultValue={existingReport?.supervisors_count ?? defaultSupervisorsCount}
              />
            </div>
          </div>

          {/* Weather delay */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="weather_delay"
                name="weather_delay"
                defaultChecked={existingReport?.weather_delay ?? false}
                className="rounded border-input"
              />
              <Label htmlFor="weather_delay">Weather caused delay</Label>
            </div>
            <div className="ml-6">
              <Label htmlFor="weather_delay_hours" className="text-xs text-muted-foreground">
                Delay hours (if applicable)
              </Label>
              <Input
                id="weather_delay_hours"
                name="weather_delay_hours"
                type="number"
                min="0"
                step="0.5"
                defaultValue={existingReport?.weather_delay_hours ?? ''}
                className="w-32 mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Work description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work Description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="work_description">Description of work done today *</Label>
            <textarea
              id="work_description"
              name="work_description"
              rows={4}
              required
              defaultValue={existingReport?.work_description ?? ''}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Describe the work completed today..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="structure_progress">Structure Progress</Label>
              <textarea
                id="structure_progress"
                name="structure_progress"
                rows={2}
                defaultValue={existingReport?.structure_progress ?? ''}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Structure mounting, racking progress..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="electrical_progress">Electrical Progress</Label>
              <textarea
                id="electrical_progress"
                name="electrical_progress"
                rows={2}
                defaultValue={existingReport?.electrical_progress ?? ''}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Wiring, inverter, earthing progress..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Materials & Issues */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Materials & Issues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="materials_received"
                name="materials_received"
                defaultChecked={existingReport?.materials_received ?? false}
                className="rounded border-input"
              />
              <Label htmlFor="materials_received">Materials received today</Label>
            </div>
            <div className="ml-6">
              <textarea
                id="materials_summary"
                name="materials_summary"
                rows={2}
                defaultValue={existingReport?.materials_summary ?? ''}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="List materials received..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="issues_reported"
                name="issues_reported"
                defaultChecked={existingReport?.issues_reported ?? false}
                className="rounded border-input"
              />
              <Label htmlFor="issues_reported">Issues to report</Label>
            </div>
            <div className="ml-6">
              <textarea
                id="issue_summary"
                name="issue_summary"
                rows={2}
                defaultValue={existingReport?.issue_summary ?? ''}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Describe issues encountered..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visitors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site Visitors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pm_visited"
              name="pm_visited"
              defaultChecked={existingReport?.pm_visited ?? false}
              className="rounded border-input"
            />
            <Label htmlFor="pm_visited">Project Manager visited site today</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="other_visitors">Other Visitors</Label>
            <Input
              id="other_visitors"
              name="other_visitors"
              defaultValue={existingReport?.other_visitors ?? ''}
              placeholder="Names of other visitors (if any)"
            />
          </div>
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoUpload
            projectId={projectId}
            reportDate={existingReport?.report_date ?? defaultDate}
            onPhotosChange={setUploadedPhotos}
          />
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/projects/${projectId}/reports`)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : isEditing ? 'Update Report' : 'Submit Report'}
        </Button>
      </div>
    </form>
  );
}
