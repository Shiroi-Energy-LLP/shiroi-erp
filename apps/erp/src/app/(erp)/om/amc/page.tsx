import * as React from 'react';
import { getAllAmcData, getCommissionedProjects } from '@/lib/amc-actions';
import { getActiveEmployees } from '@/lib/tasks-actions';
import { formatDate, formatINR } from '@repo/ui/formatters';
import { CreateAmcDialog } from '@/components/om/create-amc-dialog';
import { VisitStatusToggle } from '@/components/om/visit-status-toggle';
import { RescheduleVisitDialog } from '@/components/om/reschedule-visit-dialog';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@repo/ui';
import { CalendarCheck, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import Link from 'next/link';

const CONTRACT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'renewal_pending', label: 'Renewal Pending' },
];

const VISIT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active (All Pending)' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'missed', label: 'Missed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function contractStatusVariant(status: string): 'success' | 'error' | 'warning' | 'info' | 'outline' {
  switch (status) {
    case 'active': return 'success';
    case 'expired': return 'error';
    case 'renewal_pending': return 'warning';
    case 'cancelled': return 'outline';
    default: return 'info';
  }
}

interface AmcPageProps {
  searchParams: Promise<{
    contract_status?: string;
    visit_status?: string;
    project?: string;
    search?: string;
  }>;
}

export default async function AmcPage({ searchParams }: AmcPageProps) {
  const params = await searchParams;

  const [{ contracts, visits, totalContracts, totalVisits }, commissionedProjects, employees] = await Promise.all([
    getAllAmcData({
      contract_status: params.contract_status || undefined,
      visit_status: params.visit_status || undefined,
      project_id: params.project || undefined,
      search: params.search || undefined,
    }),
    getCommissionedProjects(),
    getActiveEmployees(),
  ]);

  const hasFilters = params.contract_status || params.visit_status || params.project;

  // Compute summary stats
  const activeContracts = contracts.filter((c: any) => c.status === 'active').length;
  const freeContracts = contracts.filter((c: any) => c.contract_type === 'warranty_period').length;
  const paidContracts = contracts.filter((c: any) => c.contract_type !== 'warranty_period').length;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const upcomingVisits = visits.filter((v: any) =>
    v.status !== 'completed' && v.status !== 'cancelled',
  );
  const overdueVisits = upcomingVisits.filter((v: any) =>
    v.scheduled_date && v.scheduled_date < todayStr!,
  );
  const completedVisits = visits.filter((v: any) => v.status === 'completed');

  // This week visits
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  const thisWeekVisits = upcomingVisits.filter((v: any) =>
    v.scheduled_date >= todayStr! && v.scheduled_date <= weekEndStr!,
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            AMC Schedule{' '}
            <span className="text-sm font-normal text-n-500">
              ({totalContracts} contracts, {totalVisits} visits)
            </span>
          </h1>
        </div>
        <CreateAmcDialog projects={commissionedProjects} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="px-3 py-2.5 bg-white border border-n-200 rounded-lg">
          <div className="text-[10px] text-n-500 uppercase tracking-wider">Total Contracts</div>
          <div className="text-xl font-bold text-n-900 mt-0.5">{contracts.length}</div>
          <div className="text-[10px] text-n-400 mt-0.5">
            {freeContracts} free · {paidContracts} paid
          </div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-green-200 rounded-lg">
          <div className="text-[10px] text-green-600 uppercase tracking-wider">Active</div>
          <div className="text-xl font-bold text-green-700 mt-0.5">{activeContracts}</div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-blue-200 rounded-lg">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">This Week</div>
          <div className="text-xl font-bold text-blue-700 mt-0.5">{thisWeekVisits.length}</div>
          <div className="text-[10px] text-blue-400 mt-0.5">visits due</div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-n-200 rounded-lg">
          <div className="text-[10px] text-n-500 uppercase tracking-wider">Upcoming</div>
          <div className="text-xl font-bold text-n-900 mt-0.5">{upcomingVisits.length}</div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-green-200 rounded-lg">
          <div className="text-[10px] text-green-600 uppercase tracking-wider">Completed</div>
          <div className="text-xl font-bold text-green-700 mt-0.5">{completedVisits.length}</div>
        </div>
        {overdueVisits.length > 0 && (
          <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-[10px] text-red-600 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Overdue
            </div>
            <div className="text-xl font-bold text-red-700 mt-0.5">{overdueVisits.length}</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/om/amc" filterParams={['contract_status', 'visit_status', 'project']}>
            <FilterSelect paramName="contract_status" className="w-36 text-xs h-8">
              <option value="">All Contracts</option>
              {CONTRACT_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="visit_status" className="w-40 text-xs h-8">
              <option value="">All Visit Status</option>
              {VISIT_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="project" className="w-44 text-xs h-8">
              <option value="">All Projects</option>
              {commissionedProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* Upcoming Visits Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-n-500" />
            AMC Visits
            <span className="text-xs font-normal text-n-500">({visits.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarCheck className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Visits Found</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No visits match your current filters.'
                  : 'Create an AMC schedule to see visits here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Visit #</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Type</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Scheduled Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Engineer</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Completed</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Rescheduled</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-12">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((visit: any) => {
                    const projectInfo = visit.projects as { project_number: string; customer_name: string } | null;
                    const engineerName = visit.employees && 'full_name' in visit.employees
                      ? (visit.employees as { full_name: string }).full_name
                      : null;
                    const isOverdue = visit.scheduled_date < todayStr! &&
                      visit.status !== 'completed' && visit.status !== 'cancelled';
                    const isCompleted = visit.status === 'completed';

                    return (
                      <tr
                        key={visit.id}
                        className={`border-b border-n-100 hover:bg-n-50 ${isCompleted ? 'opacity-50' : ''}`}
                      >
                        {/* Project */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${visit.project_id}?tab=amc`} className="text-p-600 hover:underline">
                              <div className="font-medium leading-tight">{projectInfo.project_number}</div>
                              <div className="text-n-500 text-[10px] leading-tight">{projectInfo.customer_name}</div>
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Visit # */}
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {visit.visit_number}
                        </td>

                        {/* Type */}
                        <td className="px-2 py-1.5 text-[10px] text-n-600 capitalize">
                          {visit.visit_type?.replace(/_/g, ' ') ?? '—'}
                        </td>

                        {/* Scheduled Date */}
                        <td className="px-2 py-1.5 text-[11px]">
                          <span className={isOverdue ? 'text-red-600 font-medium' : 'text-n-600'}>
                            {formatDate(visit.scheduled_date)}
                          </span>
                          {isOverdue && (
                            <span className="text-[9px] text-red-500 ml-1">(overdue)</span>
                          )}
                        </td>

                        {/* Engineer */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700">
                          {engineerName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Status — inline toggle */}
                        <td className="px-2 py-1.5">
                          <VisitStatusToggle
                            visitId={visit.id}
                            currentStatus={visit.status}
                            isOverdue={isOverdue}
                          />
                        </td>

                        {/* Completed At */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {visit.completed_at
                            ? formatDate(visit.completed_at.split('T')[0] ?? visit.completed_at)
                            : <span className="text-n-300">—</span>}
                        </td>

                        {/* Reschedule count */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {visit.reschedule_count > 0 ? (
                            <span className="text-amber-600">{visit.reschedule_count}x</span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Edit */}
                        <td className="px-2 py-1.5">
                          <RescheduleVisitDialog
                            visit={{
                              id: visit.id,
                              visit_number: visit.visit_number,
                              scheduled_date: visit.scheduled_date,
                              assigned_to: visit.assigned_to,
                            }}
                            employees={employees}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contracts Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarCheck className="h-3.5 w-3.5 text-n-500" />
            Contracts
            <span className="text-xs font-normal text-n-500">({contracts.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarCheck className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Contracts</h2>
              <p className="text-xs text-n-500 mt-1">Create an AMC schedule to create a contract.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Contract #</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Type</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Start</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">End</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Annual Value</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Visits</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract: any) => {
                    const projectInfo = contract.projects as { project_number: string; customer_name: string } | null;
                    const isFree = contract.contract_type === 'warranty_period';

                    return (
                      <tr
                        key={contract.id}
                        className={`border-b border-n-100 hover:bg-n-50 ${contract.status === 'expired' || contract.status === 'cancelled' ? 'opacity-50' : ''}`}
                      >
                        {/* Contract # */}
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {contract.contract_number}
                        </td>

                        {/* Project */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${contract.project_id}`} className="text-p-600 hover:underline">
                              <div className="font-medium leading-tight">{projectInfo.project_number}</div>
                              <div className="text-n-500 text-[10px] leading-tight">{projectInfo.customer_name}</div>
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Type */}
                        <td className="px-2 py-1.5">
                          <Badge variant={isFree ? 'outline' : 'info'} className="text-[10px] px-1.5 py-0 capitalize">
                            {isFree ? 'Free (Warranty)' : contract.contract_type?.replace(/_/g, ' ')}
                          </Badge>
                        </td>

                        {/* Start */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(contract.start_date)}
                        </td>

                        {/* End */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(contract.end_date)}
                        </td>

                        {/* Annual Value */}
                        <td className="px-2 py-1.5 text-[11px] font-medium text-n-700">
                          {contract.annual_value > 0 ? formatINR(contract.annual_value) : <span className="text-n-300">Free</span>}
                        </td>

                        {/* Visits */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700 text-center">
                          {contract.visits_included}
                        </td>

                        {/* Status */}
                        <td className="px-2 py-1.5">
                          <Badge variant={contractStatusVariant(contract.status)} className="text-[10px] px-1.5 py-0 capitalize">
                            {contract.status?.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
