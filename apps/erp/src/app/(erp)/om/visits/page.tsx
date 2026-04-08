import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
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
import { Wrench, CalendarCheck } from 'lucide-react';

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

  let scheduled: Array<{
    id: string;
    visit_number: number;
    visit_type: string;
    scheduled_date: string;
    status: string;
    project_id: string;
    employees: { full_name: string } | null;
    projects: { project_number: string; customer_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const [visitResult, scheduleResult] = await Promise.all([
      supabase
        .from('om_visit_reports')
        .select('id, visit_date, submitted_by, system_condition, meter_reading_kwh, issues_found, issue_summary, om_contracts!om_visit_reports_contract_id_fkey(projects!om_contracts_project_id_fkey(project_number, customer_name))')
        .order('visit_date', { ascending: false })
        .limit(100),
      supabase
        .from('om_visit_schedules')
        .select('id, visit_number, visit_type, scheduled_date, status, project_id, employees!om_visit_schedules_assigned_to_fkey(full_name), projects!om_visit_schedules_project_id_fkey(project_number, customer_name)')
        .order('scheduled_date', { ascending: true })
        .limit(100),
    ]);

    if (visitResult.error) {
      console.error('[OmVisitsPage] Visit reports query failed:', { code: visitResult.error.code, message: visitResult.error.message });
    }
    visits = (visitResult.data ?? []) as typeof visits;

    if (scheduleResult.error) {
      console.error('[OmVisitsPage] Visit schedules query failed:', { code: scheduleResult.error.code, message: scheduleResult.error.message });
    }
    scheduled = (scheduleResult.data ?? []) as typeof scheduled;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">O&M Visits</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load visit data.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const upcomingVisits = scheduled.filter((s) => s.status === 'scheduled' || s.status === 'rescheduled');
  const overdueVisits = scheduled.filter((s) => {
    if (s.status === 'completed' || s.status === 'cancelled') return false;
    return s.scheduled_date && new Date(s.scheduled_date) < new Date();
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">O&M VISITS</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
            O&M Visits{' '}
            <span className="text-base font-normal text-[#7C818E]">
              ({scheduled.length} scheduled, {visits.length} reports)
            </span>
          </h1>
        </div>
      </div>

      {/* Summary cards */}
      {scheduled.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-n-500 mb-0.5">Total Scheduled</div>
            <div className="text-xl font-bold text-[#1A1D24]">{scheduled.length}</div>
          </div>
          <div className="px-4 py-3 bg-white border border-green-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-green-600 mb-0.5">Completed</div>
            <div className="text-xl font-bold text-green-700">{scheduled.filter((s) => s.status === 'completed').length}</div>
          </div>
          <div className="px-4 py-3 bg-white border border-blue-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-blue-600 mb-0.5">Upcoming</div>
            <div className="text-xl font-bold text-blue-700">{upcomingVisits.length}</div>
          </div>
          {overdueVisits.length > 0 && (
            <div className="px-4 py-3 bg-white border border-red-200 rounded-lg min-w-[100px]">
              <div className="text-xs text-red-600 mb-0.5">Overdue</div>
              <div className="text-xl font-bold text-red-700">{overdueVisits.length}</div>
            </div>
          )}
        </div>
      )}

      {/* Scheduled Visits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-n-500" />
            Visit Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {scheduled.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<CalendarCheck className="h-12 w-12" />}
                title="No scheduled visits"
                description="AMC visit schedules will appear here once they are created from the project commissioning step."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Visit #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled Date</TableHead>
                  <TableHead>Engineer</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduled.map((visit) => {
                  const isOverdue = visit.scheduled_date && !['completed', 'cancelled'].includes(visit.status) && new Date(visit.scheduled_date) < new Date();
                  const project = visit.projects;
                  const engineerName = visit.employees && 'full_name' in visit.employees
                    ? (visit.employees as { full_name: string }).full_name
                    : '\u2014';

                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">
                        {project ? (
                          <Link href={`/projects/${visit.project_id}?tab=amc`} className="text-p-600 hover:underline">
                            {project.project_number} — {project.customer_name}
                          </Link>
                        ) : '\u2014'}
                      </TableCell>
                      <TableCell className="font-mono">{visit.visit_number}</TableCell>
                      <TableCell className="capitalize text-sm">{visit.visit_type.replace(/_/g, ' ')}</TableCell>
                      <TableCell className={isOverdue ? 'text-red-600 font-medium' : ''}>
                        {formatDate(visit.scheduled_date)}
                      </TableCell>
                      <TableCell className="text-sm">{engineerName}</TableCell>
                      <TableCell>
                        <VisitStatusBadge status={visit.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Completed Visit Reports */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4 text-n-500" />
            Visit Reports
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visits.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Wrench className="h-12 w-12" />}
                title="No visit reports found"
                description="O&M visit reports will appear here once technicians complete site visits."
              />
            </div>
          ) : (
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
                {visits.map((visit) => {
                  const project = visit.om_contracts?.projects;
                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">
                        {project ? `${project.project_number} — ${project.customer_name}` : '\u2014'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(visit.visit_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={visit.system_condition === 'good' ? 'default' : visit.system_condition === 'needs_attention' ? 'outline' : 'destructive'}>
                          {visit.system_condition?.replace(/_/g, ' ') ?? '\u2014'}
                        </Badge>
                      </TableCell>
                      <TableCell>{visit.meter_reading_kwh ?? '\u2014'}</TableCell>
                      <TableCell>
                        <Badge variant={visit.issues_found ? 'destructive' : 'default'}>
                          {visit.issues_found ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {visit.issue_summary || '\u2014'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VisitStatusBadge({ status }: { status: string }) {
  const variant = status === 'completed' ? 'success'
    : status === 'scheduled' ? 'info'
    : status === 'overdue' ? 'error'
    : status === 'rescheduled' ? 'warning'
    : status === 'cancelled' ? 'neutral'
    : 'pending';

  return (
    <Badge variant={variant as any} className="capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
