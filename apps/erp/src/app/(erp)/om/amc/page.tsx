import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate, formatINR } from '@repo/ui/formatters';
import { getCommissionedProjects } from '@/lib/amc-actions';
import { CreateAmcDialog } from '@/components/om/create-amc-dialog';
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
import { CalendarCheck, Clock } from 'lucide-react';

function contractStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'expired':
      return 'destructive';
    case 'draft':
      return 'outline';
    case 'cancelled':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function AmcPage() {
  const commissionedProjects = await getCommissionedProjects();

  let contracts: Array<{
    id: string;
    contract_number: string;
    contract_type: string;
    start_date: string;
    end_date: string;
    annual_value: number;
    status: string;
    visits_included: number;
    projects: { project_number: string; customer_name: string } | null;
  }> = [];

  let upcomingVisits: Array<{
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
    const [contractResult, visitsResult] = await Promise.all([
      supabase
        .from('om_contracts')
        .select('id, contract_number, contract_type, start_date, end_date, annual_value, status, visits_included, projects!om_contracts_project_id_fkey(project_number, customer_name)')
        .order('start_date', { ascending: false })
        .limit(100),
      supabase
        .from('om_visit_schedules')
        .select('id, visit_number, visit_type, scheduled_date, status, project_id, employees!om_visit_schedules_assigned_to_fkey(full_name), projects!om_visit_schedules_project_id_fkey(project_number, customer_name)')
        .not('status', 'in', '("completed","cancelled")')
        .order('scheduled_date', { ascending: true })
        .limit(100),
    ]);

    if (contractResult.error) {
      console.error('[AmcPage] Contracts query failed:', { code: contractResult.error.code, message: contractResult.error.message });
      throw contractResult.error;
    }
    contracts = (contractResult.data ?? []) as typeof contracts;

    if (visitsResult.error) {
      console.error('[AmcPage] Visits query failed:', { code: visitsResult.error.code, message: visitsResult.error.message });
    }
    upcomingVisits = (visitsResult.data ?? []) as typeof upcomingVisits;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">AMC Contracts</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load AMC contracts.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overdueCount = upcomingVisits.filter(
    (v) => v.scheduled_date && new Date(v.scheduled_date) < new Date()
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">AMC CONTRACTS</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">AMC Contracts</h1>
        </div>
        <CreateAmcDialog projects={commissionedProjects} />
      </div>

      {/* Summary cards */}
      <div className="flex gap-3 flex-wrap">
        <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[100px]">
          <div className="text-xs text-n-500 mb-0.5">Total Contracts</div>
          <div className="text-xl font-bold text-[#1A1D24]">{contracts.length}</div>
        </div>
        <div className="px-4 py-3 bg-white border border-green-200 rounded-lg min-w-[100px]">
          <div className="text-xs text-green-600 mb-0.5">Active</div>
          <div className="text-xl font-bold text-green-700">{contracts.filter((c) => c.status === 'active').length}</div>
        </div>
        <div className="px-4 py-3 bg-white border border-blue-200 rounded-lg min-w-[100px]">
          <div className="text-xs text-blue-600 mb-0.5">Upcoming Visits</div>
          <div className="text-xl font-bold text-blue-700">{upcomingVisits.length}</div>
        </div>
        {overdueCount > 0 && (
          <div className="px-4 py-3 bg-white border border-red-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-red-600 mb-0.5">Overdue</div>
            <div className="text-xl font-bold text-red-700">{overdueCount}</div>
          </div>
        )}
      </div>

      {/* Upcoming Visits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-n-500" />
            Upcoming AMC Visits
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcomingVisits.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<CalendarCheck className="h-12 w-12" />}
                title="No upcoming visits"
                description="All AMC visits are completed or no schedules exist yet."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Visit #</TableHead>
                  <TableHead>Scheduled Date</TableHead>
                  <TableHead>Engineer</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcomingVisits.map((visit) => {
                  const isOverdue = visit.scheduled_date && new Date(visit.scheduled_date) < new Date();
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
                      <TableCell className={isOverdue ? 'text-red-600 font-medium' : ''}>
                        {formatDate(visit.scheduled_date)}
                        {isOverdue && <span className="ml-1 text-xs">(overdue)</span>}
                      </TableCell>
                      <TableCell className="text-sm">{engineerName}</TableCell>
                      <TableCell>
                        <Badge variant={isOverdue ? 'destructive' : 'outline'} className="capitalize">
                          {isOverdue ? 'overdue' : visit.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Contracts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-n-500" />
            All Contracts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<CalendarCheck className="h-12 w-12" />}
                title="No AMC contracts found"
                description="AMC contracts will appear here once created for commissioned projects."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Contract Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Annual Value</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">
                      {contract.projects
                        ? `${contract.projects.project_number} — ${contract.projects.customer_name}`
                        : '\u2014'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {contract.contract_type?.replace(/_/g, ' ') ?? '\u2014'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(contract.start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(contract.end_date)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatINR(contract.annual_value)}
                    </TableCell>
                    <TableCell>{contract.visits_included}</TableCell>
                    <TableCell>
                      <Badge variant={contractStatusVariant(contract.status)}>
                        {contract.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
