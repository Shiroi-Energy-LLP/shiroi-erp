import { notFound, redirect } from 'next/navigation';
import { getReport, getReportCorrections } from '@/lib/site-report-queries';
import { getUserProfile } from '@/lib/auth';
import { isReportLocked } from '@/lib/report-lock';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@repo/ui';
import { CorrectionForm } from '@/components/reports/correction-form';

interface CorrectionPageProps {
  params: Promise<{ id: string; reportId: string }>;
}

export default async function CorrectionPage({ params }: CorrectionPageProps) {
  const { id: projectId, reportId } = await params;

  const [report, corrections, profile] = await Promise.all([
    getReport(reportId),
    getReportCorrections(reportId),
    getUserProfile(),
  ]);

  if (!profile) {
    redirect('/login');
  }

  if (!report) {
    notFound();
  }

  // Only allow correction requests for locked reports
  const locked = isReportLocked(report.report_date, report.is_locked);
  if (!locked) {
    // If not locked, redirect to edit instead
    redirect(`/projects/${projectId}/reports/${reportId}/edit`);
  }

  const submitterName =
    report.employees && !Array.isArray(report.employees) && 'full_name' in report.employees
      ? report.employees.full_name
      : 'Unknown';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1A1D24]">Request Correction</h2>
        <p className="text-sm text-muted-foreground">
          This report is locked. Submit a correction request for manager approval.
        </p>
      </div>

      {/* Original report — read-only */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Original Report
            <Badge variant="secondary">Locked</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Date</span>
              <p className="font-mono">{formatDate(report.report_date)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Submitted By</span>
              <p>{submitterName}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Panels Today</span>
              <p className="font-mono">{report.panels_installed_today}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Cumulative</span>
              <p className="font-mono">{report.panels_installed_cumulative}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Workers</span>
              <p className="font-mono">{report.workers_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Supervisors</span>
              <p className="font-mono">{report.supervisors_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Weather</span>
              <p className="capitalize">{report.weather.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Issues</span>
              <p>{report.issues_reported ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {report.work_description && (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Work Description</span>
              <p className="text-sm mt-1">{report.work_description}</p>
            </div>
          )}

          {report.structure_progress && (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Structure Progress</span>
              <p className="text-sm mt-1">{report.structure_progress}</p>
            </div>
          )}

          {report.electrical_progress && (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Electrical Progress</span>
              <p className="text-sm mt-1">{report.electrical_progress}</p>
            </div>
          )}

          {report.issue_summary && (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Issue Summary</span>
              <p className="text-sm mt-1">{report.issue_summary}</p>
            </div>
          )}

          {report.materials_summary && (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Materials Summary</span>
              <p className="text-sm mt-1">{report.materials_summary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing corrections */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previous Corrections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {corrections.map((correction) => {
                const requesterName =
                  correction.requester &&
                  !Array.isArray(correction.requester) &&
                  'full_name' in correction.requester
                    ? correction.requester.full_name
                    : 'Unknown';
                const approverName =
                  correction.approver &&
                  !Array.isArray(correction.approver) &&
                  'full_name' in correction.approver
                    ? correction.approver.full_name
                    : null;

                return (
                  <div
                    key={correction.id}
                    className="border rounded-md p-3 text-sm space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {correction.field_corrected}
                      </span>
                      <CorrectionStatusBadge status={correction.status} />
                    </div>
                    <p className="text-muted-foreground">
                      <span className="line-through">{correction.original_value}</span>
                      {' -> '}
                      <span className="text-[#1A1D24]">{correction.corrected_value}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reason: {correction.correction_reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {requesterName} on {formatDate(correction.created_at)}
                      {approverName && ` | Reviewed by ${approverName}`}
                    </p>
                    {correction.rejected_reason && (
                      <p className="text-xs text-[#991B1B]">
                        Rejected: {correction.rejected_reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Correction request form */}
      <CorrectionForm
        reportId={reportId}
        projectId={projectId}
        userId={profile.id}
        report={report}
      />
    </div>
  );
}

function CorrectionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return <Badge variant="success">Approved</Badge>;
    case 'rejected':
      return <Badge variant="error">Rejected</Badge>;
    case 'pending':
    default:
      return <Badge variant="warning">Pending</Badge>;
  }
}
