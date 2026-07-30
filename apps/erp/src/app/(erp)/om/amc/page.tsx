import * as React from 'react';
import { getAllAmcData, getProjectsWithAmc } from '@/lib/amc-actions';
import { getActiveEmployees } from '@/lib/tasks-actions';
import { getUserProfile } from '@/lib/auth';
import { formatDate, formatDateFromTimestamp, formatINR } from '@repo/ui/formatters';
import { CreateAmcDialog } from '@/components/om/create-amc-dialog';
import { AmcStatusToggle } from '@/components/om/amc-status-toggle';
import { DeleteAmcButton } from '@/components/om/delete-amc-button';
import { AmcProjectFilter } from '@/components/om/amc-project-filter';
import { AMC_DELETE_ROLES, AMC_OPEN_STATUSES } from '@/lib/amc-constants';
import {
  Card,
  CardContent,
  Badge,
} from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import Link from 'next/link';

interface AmcPageProps {
  searchParams: Promise<{
    status?: string;
    category?: string;
    project?: string;
  }>;
}

export default async function AmcPage({ searchParams }: AmcPageProps) {
  const params = await searchParams;

  const [{ contracts, total }, employees, filterProjects, profile] = await Promise.all([
    getAllAmcData({
      status: params.status || undefined,
      category: params.category || undefined,
      project_id: params.project || undefined,
    }),
    getActiveEmployees(),
    getProjectsWithAmc(),
    getUserProfile(),
  ]);

  const canDeleteAmc = profile?.role
    ? (AMC_DELETE_ROLES as readonly string[]).includes(profile.role)
    : false;

  const hasFilters = params.status || params.category || params.project;
  const isOpenStatus = (s: string) => (AMC_OPEN_STATUSES as readonly string[]).includes(s);

  // Summary stats
  const openContracts = contracts.filter((c) => isOpenStatus(c.status)).length;
  const closedContracts = contracts.length - openContracts;
  const freeCount = contracts.filter((c) => c.amc_category === 'free_amc').length;
  const paidCount = contracts.filter((c) => c.amc_category === 'paid_amc').length;

  return (
    <ListPageShell
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FilterBar basePath="/om/amc" filterParams={['status', 'category', 'project']}>
              <FilterSelect paramName="status" className="w-28 text-xs h-8">
                <option value="">All Status</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </FilterSelect>
              <FilterSelect paramName="category" className="w-32 text-xs h-8">
                <option value="">All Categories</option>
                <option value="free_amc">Free AMC</option>
                <option value="paid_amc">Paid AMC</option>
              </FilterSelect>
              {/* Autosearch — the old plain <select> listed every project. */}
              <AmcProjectFilter projects={filterProjects} />
            </FilterBar>
          </div>
          <CreateAmcDialog employees={employees} />
        </div>
      }
    >
      <h1 className="text-lg font-heading font-bold text-n-900">
        AMC Schedule{' '}
        <span className="text-sm font-normal text-n-500">
          ({total} contracts)
        </span>
      </h1>

      {/* Summary Cards — scroll away */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-n-200 bg-white px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-n-500">Total AMC</div>
          <div className="mt-0.5 text-xl font-bold text-n-900">{contracts.length}</div>
          <div className="mt-0.5 text-[11px] text-n-400">
            {freeCount} free · {paidCount} paid
          </div>
        </div>
        <div className="rounded-lg border border-red-200 bg-white px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-red-600">Open</div>
          <div className="mt-0.5 text-xl font-bold text-red-700">{openContracts}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-white px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-green-600">Closed</div>
          <div className="mt-0.5 text-xl font-bold text-green-700">{closedContracts}</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-white px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-blue-600">Free vs Paid</div>
          <div className="mt-0.5 text-lg font-bold text-blue-700">{freeCount} / {paidCount}</div>
        </div>
      </div>

      {/* AMC Table */}
      <Card>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarCheck className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No AMC Records</h2>
              <p className="mt-1 max-w-[320px] text-xs text-n-500">
                {hasFilters
                  ? 'No AMC contracts match your current filters.'
                  : 'No AMC set up for this project. Create AMC to begin tracking visits.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm [&_td]:align-top">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Project Name</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Category</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Scheduled Visits</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Status</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Next AMC Date</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Completed Date</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Amount</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500">Notes</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-n-500 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract) => {
                    const projectInfo = contract.projects;
                    const isFree = contract.amc_category === 'free_amc';
                    const isOpen = isOpenStatus(contract.status);
                    const completedCount = contract.completed_visit_count;
                    const totalCount = contract.total_visit_count;

                    return (
                      <tr
                        key={contract.id}
                        className={`border-b border-n-100 align-top hover:bg-n-50 ${!isOpen ? 'opacity-60' : ''}`}
                      >
                        {/* Project Name — clickable link */}
                        <td className="px-3 py-2.5">
                          {projectInfo ? (
                            <Link href={`/projects/${contract.project_id}`} className="font-medium text-p-600 hover:underline">
                              {projectInfo.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-3 py-2.5">
                          <Badge
                            variant={isFree ? 'outline' : 'info'}
                            className="px-1.5 py-0 text-[11px]"
                          >
                            {isFree ? 'Free AMC' : 'Paid AMC'}
                          </Badge>
                        </td>

                        {/* Scheduled Visits — opens the contract detail page */}
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/om/amc/${contract.id}`}
                            className="inline-flex items-center gap-0.5 text-xs font-medium text-p-600 hover:text-p-700 hover:underline"
                            title="View all scheduled visits"
                          >
                            {completedCount} / {totalCount}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>

                        {/* Status — Open/Closed inline toggle */}
                        <td className="px-3 py-2.5">
                          <AmcStatusToggle
                            contractId={contract.id}
                            currentStatus={contract.status}
                          />
                        </td>

                        {/* Next AMC Date */}
                        <td className="whitespace-nowrap px-3 py-2.5 text-n-600">
                          {contract.next_visit_date ? (
                            <span className={
                              contract.next_visit_date < new Date().toISOString().split('T')[0]!
                                ? 'font-medium text-red-600'
                                : 'text-n-700'
                            }>
                              {formatDate(contract.next_visit_date)}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Completed Date — last completed visit.
                            completed_at is TIMESTAMPTZ; formatDate's date-only
                            suffix rendered this as "Invalid Date". */}
                        <td className="whitespace-nowrap px-3 py-2.5 text-n-600">
                          {contract.last_completed_date ? (
                            formatDateFromTimestamp(contract.last_completed_date)
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Amount — paid AMCs only */}
                        <td className="whitespace-nowrap px-3 py-2.5 text-n-700 tabular-nums">
                          {!isFree && (contract.annual_value ?? 0) > 0 ? (
                            formatINR(contract.annual_value)
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Notes */}
                        <td className="max-w-[240px] whitespace-normal break-words px-3 py-2.5 text-n-600">
                          {contract.notes ? (
                            <span title={contract.notes}>{contract.notes}</span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Actions — contract number + per-row delete */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-n-300">{contract.contract_number}</span>
                            {canDeleteAmc && (
                              <DeleteAmcButton
                                contractId={contract.id}
                                contractNumber={contract.contract_number}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </ListPageShell>
  );
}
