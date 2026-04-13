import * as React from 'react';
import { getAllAmcData, getCommissionedProjects, getAllProjectsForAmc } from '@/lib/amc-actions';
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
import { CalendarCheck, AlertTriangle } from 'lucide-react';
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

  const [{ contracts, total }, commissionedProjects, allProjects, employees] = await Promise.all([
    getAllAmcData({
      status: params.status || undefined,
      category: params.category || undefined,
      project_id: params.project || undefined,
    }),
    getCommissionedProjects(),
    getAllProjectsForAmc(),
    getActiveEmployees(),
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
            <FilterSelect paramName="project" className="w-44 text-xs h-8">
              <option value="">All Projects</option>
              {allProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.customer_name}</option>
              ))}
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* AMC Table — flat contract rows */}
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
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned To</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Start</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">End</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Notes</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract: any) => {
                    const projectInfo = contract.projects as { project_number: string; customer_name: string } | null;
                    const createdByName = contract.employees && 'full_name' in contract.employees
                      ? (contract.employees as { full_name: string }).full_name : null;
                    const isFree = contract.amc_category === 'free_amc';
                    const isOpen = contract.status === 'active' || contract.status === 'quoted';

                    return (
                      <tr
                        key={contract.id}
                        className={`border-b border-n-100 hover:bg-n-50 ${!isOpen ? 'opacity-50' : ''}`}
                      >
                        {/* Project Name — clickable link, no ID */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${contract.project_id}`} className="text-p-600 hover:underline font-medium">
                              {projectInfo.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={isFree ? 'outline' : 'info'}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {isFree ? 'Free AMC' : 'Paid AMC'}
                          </Badge>
                        </td>

                        {/* Scheduled Visits — expandable tracker */}
                        <td className="px-2 py-1.5">
                          <AmcVisitTracker
                            contractId={contract.id}
                            visitsIncluded={contract.visits_included}
                            employees={employees}
                          />
                        </td>

                        {/* Assigned To (created by as proxy) */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700">
                          {createdByName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Status — Open/Closed inline toggle */}
                        <td className="px-2 py-1.5">
                          <AmcStatusToggle
                            contractId={contract.id}
                            currentStatus={contract.status}
                          />
                        </td>

                        {/* Start Date */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(contract.start_date)}
                        </td>

                        {/* End Date */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(contract.end_date)}
                        </td>

                        {/* Notes */}
                        <td className="px-2 py-1.5 text-[10px] text-n-600">
                          {contract.notes ? (
                            <span title={contract.notes}>{contract.notes.substring(0, 40)}{contract.notes.length > 40 ? '...' : ''}</span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-1.5 text-[10px]">
                          <div className="flex items-center gap-1 text-n-400">
                            <span className="text-[9px] text-n-300">{contract.contract_number}</span>
                          </div>
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
