import { listDailySiteReports } from '@/lib/daily-reports-queries';
import { formatDate, toIST } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { ClipboardList } from 'lucide-react';

export default async function DailyReportsPage() {
  const rows = await listDailySiteReports();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Eyebrow className="mb-1">DAILY REPORTS</Eyebrow>
        <h1 className="text-2xl font-bold text-n-950">Daily Site Reports</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Weather</TableHead>
                <TableHead className="text-right">Workers</TableHead>
                <TableHead className="text-right">Panels Today</TableHead>
                <TableHead>Locked</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<ClipboardList className="h-12 w-12" />}
                      title="No daily reports found"
                      description="Daily site reports will appear here once supervisors submit them."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">
                      {formatDate(report.report_date)}
                    </TableCell>
                    <TableCell>
                      {report.projects
                        ? `${report.projects.project_number} — ${report.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {report.weather?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.workers_count ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.panels_installed_today ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={report.is_locked ? 'secondary' : 'outline'}>
                        {report.is_locked ? 'Locked' : 'Open'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {toIST(report.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
