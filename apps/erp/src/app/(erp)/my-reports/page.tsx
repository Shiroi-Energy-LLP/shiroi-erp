import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import { formatDate, toIST } from '@repo/ui/formatters';
import { redirect } from 'next/navigation';
import Link from 'next/link';
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
  Eyebrow,
} from '@repo/ui';
import { FileText } from 'lucide-react';

export default async function MyReportsPage() {
  const op = '[MyReportsPage]';
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const supabase = await createClient();

  const { data: reports, error } = await supabase
    .from('daily_site_reports')
    .select('*, projects!daily_site_reports_project_id_fkey(project_number, customer_name)')
    .eq('submitted_by', profile.id)
    .order('report_date', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
  }

  const rows = reports ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Eyebrow className="mb-1">MY REPORTS</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">My Reports</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Weather</TableHead>
                <TableHead className="text-right">Panels Today</TableHead>
                <TableHead>Locked</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="h-8 w-8 text-muted-foreground/50" />
                      No reports submitted by you yet.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">
                      {report.projects?.project_number ? (
                        <Link
                          href={`/projects/${report.project_id}/reports/${report.id}`}
                          className="text-[#00B050] hover:underline"
                        >
                          {formatDate(report.report_date)}
                        </Link>
                      ) : (
                        formatDate(report.report_date)
                      )}
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
