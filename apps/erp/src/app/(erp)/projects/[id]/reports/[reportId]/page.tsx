import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getReport } from '@/lib/site-report-queries';
import { isReportLocked, hoursUntilLock } from '@/lib/report-lock';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
} from '@repo/ui';
import { AINarrative } from '@/components/reports/ai-narrative';
import { ReportPhotos } from '@/components/reports/report-photos';

interface Props {
  params: Promise<{ id: string; reportId: string }>;
}

export default async function ReportDetailPage({ params }: Props) {
  const { id: projectId, reportId } = await params;

  const report = await getReport(reportId);
  if (!report) {
    notFound();
  }

  const locked = isReportLocked(report.report_date, report.is_locked);
  const hoursLeft = hoursUntilLock(report.report_date, report.is_locked);
  const submitterName =
    report.employees && !Array.isArray(report.employees) && 'full_name' in report.employees
      ? report.employees.full_name
      : 'Unknown';

  const photos = report.site_photos && Array.isArray(report.site_photos)
    ? report.site_photos
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1A1D24]">Daily Site Report</h2>
          <p className="text-sm text-muted-foreground">
            {formatDate(report.report_date)} — submitted by {submitterName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <Link href={`/projects/${projectId}/reports/${reportId}/correction`}>
              <Button size="sm" variant="outline">Request Correction</Button>
            </Link>
          ) : (
            <Link href={`/projects/${projectId}/reports/${reportId}/edit`}>
              <Button size="sm" variant="outline">Edit Report</Button>
            </Link>
          )}
          <Link href={`/projects/${projectId}/reports`}>
            <Button size="sm" variant="ghost">← Back to Reports</Button>
          </Link>
        </div>
      </div>

      {/* Status banner */}
      <div className="flex items-center gap-3">
        {locked ? (
          <Badge variant="secondary">Locked</Badge>
        ) : (
          <Badge variant="success">{hoursLeft}h until lock</Badge>
        )}
        {report.has_correction && <Badge variant="warning">Has Correction</Badge>}
        {report.issues_reported && <Badge variant="error">Issues Reported</Badge>}
        {report.weather_delay && <Badge variant="info">Weather Delay</Badge>}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="Panels Today" value={report.panels_installed_today} />
        <MetricCard label="Cumulative" value={report.panels_installed_cumulative} />
        <MetricCard label="Workers" value={report.workers_count} />
        <MetricCard label="Supervisors" value={report.supervisors_count} />
        <MetricCard label="Weather" value={report.weather.replace(/_/g, ' ')} capitalize />
      </div>

      {/* Work description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work Description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{report.work_description}</p>

          {report.structure_progress && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase">Structure Progress</span>
              <p className="text-sm mt-1">{report.structure_progress}</p>
            </div>
          )}

          {report.electrical_progress && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase">Electrical Progress</span>
              <p className="text-sm mt-1">{report.electrical_progress}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Materials & Issues */}
      {(report.materials_received || report.issues_reported || report.weather_delay) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Materials & Issues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.materials_received && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="info">Materials Received</Badge>
                </div>
                {report.materials_summary && (
                  <p className="text-sm text-muted-foreground ml-1">{report.materials_summary}</p>
                )}
              </div>
            )}

            {report.issues_reported && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="error">Issues</Badge>
                </div>
                {report.issue_summary && (
                  <p className="text-sm text-muted-foreground ml-1">{report.issue_summary}</p>
                )}
              </div>
            )}

            {report.weather_delay && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="warning">Weather Delay</Badge>
                  {report.weather_delay_hours && (
                    <span className="text-sm font-mono text-muted-foreground">{report.weather_delay_hours}h</span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Site Visitors */}
      {(report.pm_visited || report.other_visitors) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site Visitors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.pm_visited && (
              <div className="flex items-center gap-2">
                <Badge variant="success">PM Visited</Badge>
              </div>
            )}
            {report.other_visitors && (
              <div>
                <span className="text-muted-foreground">Other visitors:</span>{' '}
                <span>{report.other_visitors}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Site Photos */}
      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site Photos ({photos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportPhotos photos={photos} />
          </CardContent>
        </Card>
      )}

      {/* AI Narrative */}
      <AINarrative
        reportId={reportId}
        projectId={projectId}
        existingNarrative={(report as any).ai_narrative}
        generatedAt={(report as any).ai_narrative_generated_at}
      />
    </div>
  );
}

function MetricCard({ label, value, capitalize: cap }: { label: string; value: string | number; capitalize?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className={`text-lg font-bold text-[#1A1D24] font-mono ${cap ? 'capitalize' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
