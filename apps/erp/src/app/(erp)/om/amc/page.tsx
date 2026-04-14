import * as React from 'react';
import { getAllAmcData, getCommissionedProjects, getAllProjectsForAmc, getProjectsWithAmc } from '@/lib/amc-actions';
import { getActiveEmployees } from '@/lib/tasks-actions';
import { formatDate } from '@repo/ui/formatters';
import { CreateAmcDialog } from '@/components/om/create-amc-dialog';
import { AmcStatusToggle } from '@/components/om/amc-status-toggle';
import { AmcVisitTracker } from '@/components/om/amc-visit-tracker';
import {
  Card,
  CardContent,
  Badge,
} from '@repo/ui';
import { CalendarCheck } from 'lucide-react';
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

  const [{ contracts, total }, commissionedProjects, allProjects, employees, filterProjects] = await Promise.all([
    getAllAmcData({
      status: params.status || undefined,
      category: params.category || undefined,
      project_id: params.project || undefined,
    }),
    getCommissionedProjects(),
    getAllProjectsForAmc(),
    getActiveEmployees(),
    getProjectsWithAmc(),
  ]);

  const hasFilters = params.status || params.category || params.project;

  // Summary stats
  const openContracts = contracts.filter((c: any) => c.status === 'active' || c.status === 'quoted').length;
  const closedContracts = contracts.filter((c: any) => c.status === 'expired' || c.status === 'cancelled').length;
  const freeCount = contracts.filter((c: any) => c.amc_category === 'free_amc').length;
  const paidCount = contracts.filter((c: any) => c.amc_category === 'paid_amc').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            AMC Schedule{' '}
            <span className="text-sm font-normal text-n-500">
              ({total} contracts)
            </span>
          </h1>
        </div>
        <CreateAmcDialog
          commissionedProjects={commissionedProjects}
          allProjects={allProjects}
          employees={employees}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="px-3 py-2.5 bg-white border border-n-200 rounded-lg">
          <div className="text-[10px] text-n-500 uppercase tracking-wider">Total AMC</div>
          <div className="text-xl font-bold text-n-900 mt-0.5">{contracts.length}</div>
          <div className="text-[10px] text-n-400 mt-0.5">
            {freeCount} free · {paidCount} paid
          </div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-red-200 rounded-lg">
          <div className="text-[10px] text-red-600 uppercase tracking-wider">Open</div>
          <div className="text-xl font-bold text-red-700 mt-0.5">{openContracts}</div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-green-200 rounded-lg">
          <div className="text-[10px] text-green-600 uppercase tracking-wider">Closed</div>
          <div className="text-xl font-bold text-green-700 mt-0.5">{closedContracts}</div>
        </div>
        <div className="px-3 py-2.5 bg-white border border-blue-200 rounded-lg">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">Free vs Paid</div>
          <div className="text-lg font-bold text-blue-700 mt-0.5">{freeCount} / {paidCount}</div>
        </div>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
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
            <FilterSelect paramName="project" className="w-52 text-xs h-8">
              <option value="">All Projects</option>
              {filterProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.customer_name}</option>
              ))}
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* AMC Table — 9 columns */}
      <Card>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarCheck className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No AMC Records</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No AMC contracts match your current filters.'
                  : 'No AMC set up for this project. Create AMC to begin tracking visits.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project Name</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Category</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Scheduled Visits</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Next AMC Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Completed Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Notes</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-20">Actions</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-20">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract: any) => {
                    const projectInfo = contract.projects as { project_number: string; customer_name: string } | null;
                    const isFree = contract.amc_category === 'free_amc';
                    const isOpen = contract.status === 'active' || contract.status === 'quoted';
                    const completedCount = contract.completed_visit_count as number;
                    const totalCount = contract.total_visit_count as number;
                    const reportCount = 0; // reports are per-visit inside AmcVisitTracker

                    return (
                      <tr
                        key={contract.id}
                        className={`border-b border-n-100 hover:bg-n-50 align-top ${!isOpen ? 'opacity-60' : ''}`}
                      >
                        {/* Project Name — clickable link */}
                        <td className="px-2 py-2 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${contract.project_id}`} className="text-p-600 hover:underline font-medium">
                              {projectInfo.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-2 py-2">
                          <Badge
                            variant={isFree ? 'outline' : 'info'}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {isFree ? 'Free AMC' : 'Paid AMC'}
                          </Badge>
                        </td>

                        {/* Scheduled Visits — "X / Y" with expandable tracker */}
                        <td className="px-2 py-2">
                          <AmcVisitTracker
                            contractId={contract.id}
                            visitsIncluded={contract.visits_included}
                            employees={employees}
                            completedCount={completedCount}
                            totalCount={totalCount}
                          />
                        </td>

                        {/* Status — Open/Closed inline toggle */}
                        <td className="px-2 py-2">
                          <AmcStatusToggle
                            contractId={contract.id}
                            currentStatus={contract.status}
                          />
                        </td>

                        {/* Next AMC Date */}
                        <td className="px-2 py-2 text-[10px] text-n-600">
                          {contract.next_visit_date ? (
                            <span className={
                              contract.next_visit_date < new Date().toISOString().split('T')[0]!
                                ? 'text-red-600 font-medium'
                                : 'text-n-700'
                            }>
                              {formatDate(contract.next_visit_date)}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Completed Date — last completed visit */}
                        <td className="px-2 py-2 text-[10px] text-n-500">
                          {contract.last_completed_date ? (
                            formatDate(contract.last_completed_date)
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Notes */}
                        <td className="px-2 py-2 text-[10px] text-n-600 max-w-[160px]">
                          {contract.notes ? (
                            <span title={contract.notes}>
                              {contract.notes.substring(0, 50)}{contract.notes.length > 50 ? '...' : ''}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Actions — contract number as identifier */}
                        <td className="px-2 py-2 text-[10px]">
                          <span className="text-[9px] text-n-300 font-mono">{contract.contract_number}</span>
                        </td>

                        {/* Report — per-visit reports are accessible via the visit tracker */}
                        <td className="px-2 py-2 text-[10px]">
                          {completedCount > 0 ? (
                            <span className="text-green-600 font-medium text-[10px]">
                              {completedCount} visit{completedCount !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
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
