import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
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
} from '@repo/ui';

export default async function OmVisitsPage() {
  let visits: Array<{
    id: string;
    visit_date: string;
    submitted_by: string;
    system_condition: string;
    meter_reading_kwh: number | null;
    issues_found: boolean;
    issue_summary: string | null;
    om_contracts: {
      projects: { project_number: string; customer_name: string } | null;
    } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('om_visit_reports')
      .select('id, visit_date, submitted_by, system_condition, meter_reading_kwh, issues_found, issue_summary, om_contracts!om_visit_reports_contract_id_fkey(projects!om_contracts_project_id_fkey(project_number, customer_name))')
      .order('visit_date', { ascending: false });

    if (error) {
      console.error('[OmVisitsPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    visits = (data ?? []) as typeof visits;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">O&M Visits</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load visit reports.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">O&M Visits</h1>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Visit Date</TableHead>
                <TableHead>System Condition</TableHead>
                <TableHead>Generation (kWh)</TableHead>
                <TableHead>Issues Found</TableHead>
                <TableHead>Issue Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No visit reports found.
                  </TableCell>
                </TableRow>
              ) : (
                visits.map((visit) => {
                  const project = visit.om_contracts?.projects;
                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">
                        {project ? `${project.project_number} — ${project.customer_name}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(visit.visit_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={visit.system_condition === 'good' ? 'default' : visit.system_condition === 'needs_attention' ? 'outline' : 'destructive'}>
                          {visit.system_condition?.replace(/_/g, ' ') ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>{visit.meter_reading_kwh ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={visit.issues_found ? 'destructive' : 'default'}>
                          {visit.issues_found ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {visit.issue_summary || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
