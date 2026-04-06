import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectReports } from '@/lib/site-report-queries';
import { getProject } from '@/lib/projects-queries';
import { isReportLocked, hoursUntilLock } from '@/lib/report-lock';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui';

interface ReportsPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { id } = await params;
  const [project, reports] = await Promise.all([
    getProject(id),
    getProjectReports(id),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1A1D24]">Daily Site Reports</h2>
          <p className="text-sm text-muted-foreground">
            {reports.length} report{reports.length !== 1 ? 's' : ''} submitted
          </p>
        </div>
        <Link href={`/projects/${id}/reports/new`}>
          <Button>New Report</Button>
        </Link>
      </div>

      {/* Report table */}
      {reports.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead className="text-right">Panels Today</TableHead>
                  <TableHead className="text-right">Cumulative</TableHead>
                  <TableHead className="text-right">Workers</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => {
                  const locked = isReportLocked(report.report_date, report.is_locked);
                  const hoursLeft = hoursUntilLock(report.report_date, report.is_locked);
                  const submitterName =
                    report.employees &&
                    !Array.isArray(report.employees) &&
                    'full_name' in report.employees
                      ? report.employees.full_name
                      : 'Unknown';

                  return (
                    <TableRow key={report.id}>
                      <TableCell className="font-mono text-sm">
                        <Link
                          href={`/projects/${id}/reports/${report.id}`}
                          className="text-[#00B050] hover:underline"
                        >
                          {formatDate(report.report_date)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{submitterName}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {report.panels_installed_today}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {report.panels_installed_cumulative}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {report.workers_count}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {report.weather.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell>
                        {report.issues_reported ? (
                          <Badge variant="error">Issues</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ReportStatusIndicator
                          locked={locked}
                          hoursLeft={hoursLeft}
                          hasCorrection={report.has_correction}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/projects/${id}/reports/${report.id}`}
                            className="text-xs text-[#00B050] hover:underline"
                          >
                            View
                          </Link>
                          {locked ? (
                            <Link
                              href={`/projects/${id}/reports/${report.id}/correction`}
                              className="text-xs text-[#7C818E] hover:underline"
                            >
                              Request Correction
                            </Link>
                          ) : (
                            <Link
                              href={`/projects/${id}/reports/${report.id}/edit`}
                              className="text-xs text-[#7C818E] hover:underline"
                            >
                              Edit
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No daily reports submitted yet. Create the first report to start tracking site progress.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportStatusIndicator({
  locked,
  hoursLeft,
  hasCorrection,
}: {
  locked: boolean;
  hoursLeft: number;
  hasCorrection: boolean;
}) {
  if (hasCorrection) {
    return (
      <div className="flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-[#9A3412]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span className="text-xs text-[#9A3412]">Corrected</span>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="text-xs text-muted-foreground">Locked</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <svg className="w-3.5 h-3.5 text-[#00B050]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
      </svg>
      <span className="text-xs text-[#00B050]">{hoursLeft}h left</span>
    </div>
  );
}
