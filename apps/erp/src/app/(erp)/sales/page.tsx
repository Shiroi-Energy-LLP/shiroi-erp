import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import type { LeadFilters } from '@/lib/leads-queries';
import {
  getLeadStageCounts,
  getLeadsClosingBetween,
  getPipelineCloseWindow,
} from '@/lib/leads-pipeline-queries';
import { getInternalReferrers, getReferralPartners } from '@/lib/partners-queries';
import { getMyViews } from '@/lib/views-actions';
import { LeadsTableWrapper } from '@/components/leads/leads-table-wrapper';
import { LeadStageNav } from '@/components/leads/lead-stage-nav';
import { PipelineSummary } from '@/components/leads/pipeline-summary';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Eyebrow } from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { FilterRange } from '@/components/filter-range';
import { STAGE_LABELS } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

/**
 * Status options for the multi-select filter.
 * Excludes terminal/legacy stages: converted, proposal_sent, disqualified.
 */
const TERMINAL_FILTER_STAGES: LeadStatus[] = ['converted', 'proposal_sent', 'disqualified'];

const STATUS_FILTER_OPTIONS = (
  Object.entries(STAGE_LABELS) as [LeadStatus, string][]
)
  .filter(([s]) => !TERMINAL_FILTER_STAGES.includes(s))
  .map(([value, label]) => ({ value, label }));

/**
 * /sales page — consolidated replacement for /leads + /proposals.
 *
 * Phase C additions: multi-status filter, kWp range filter, closure-date
 * range filter, referrer filter (Vivek/Management/external), and clickable
 * "Closing This Week" + "Closing This Month" KPI cards with kWp + ₹ breakdown.
 */
interface SalesPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    segment?: string;
    search?: string;
    assignedTo?: string;
    referrer?: string;
    kwpMin?: string;
    kwpMax?: string;
    closeFrom?: string;
    closeTo?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
    archived?: string;
  }>;
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const isArchived = params.archived === 'true';

  // This week window (Monday - Sunday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().split('T')[0]!;
  const weekEnd = sunday.toISOString().split('T')[0]!;

  // This month window (today — last day of current month, Asia/Kolkata approximated via UTC)
  const monthStart = now.toISOString().split('T')[0]!;
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthEnd = lastDayOfMonth.toISOString().split('T')[0]!;

  // Parse multi-status filter (comma-separated URL param)
  const statusParam = params.status;
  const statusFilter: LeadStatus | LeadStatus[] | undefined = statusParam
    ? statusParam.includes(',')
      ? (statusParam.split(',').filter(Boolean) as LeadStatus[])
      : (statusParam as LeadStatus)
    : undefined;

  // Parse kWp range
  const kwpMin = params.kwpMin ? parseFloat(params.kwpMin) : undefined;
  const kwpMax = params.kwpMax ? parseFloat(params.kwpMax) : undefined;

  const referrerParam = params.referrer;

  // Stage 1 — parallel fetches that don't depend on each other
  const [
    views,
    stageCounts,
    closingThisWeek,
    employees,
    internalReferrers,
    externalReferrers,
    closingThisWeekWindow,
    closingThisMonthWindow,
  ] = await Promise.all([
    getMyViews('leads'),
    getLeadStageCounts(),
    getLeadsClosingBetween(weekStart, weekEnd),
    getSalesEngineers(),
    getInternalReferrers(),
    getReferralPartners(),
    getPipelineCloseWindow(weekStart, weekEnd),
    getPipelineCloseWindow(monthStart, monthEnd),
  ]);

  // Resolve internal_all sentinel → IDs
  const referrerIds: string[] | undefined =
    referrerParam === 'internal_all' ? internalReferrers.map((r) => r.id) : undefined;

  const leadsFilters: LeadFilters = {
    status: statusFilter,
    source: params.source as LeadFilters['source'] | undefined,
    segment: params.segment || undefined,
    search: params.search || undefined,
    assignedTo: params.assignedTo || undefined,
    referrer: referrerParam && referrerParam !== 'internal_all' ? referrerParam : undefined,
    referrerIds,
    kwpMin,
    kwpMax,
    closeFrom: params.closeFrom || undefined,
    closeTo: params.closeTo || undefined,
    archivedOnly: isArchived,
    page,
    pageSize: 50,
    sort: params.sort || undefined,
    dir: (params.dir as 'asc' | 'desc') || undefined,
  };

  // Stage 2 — getLeads (may depend on internalReferrers for referrerIds)
  const result = await getLeads(leadsFilters);

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.source) currentFilters.source = params.source;
  if (params.segment) currentFilters.segment = params.segment;
  if (params.search) currentFilters.search = params.search;
  if (params.assignedTo) currentFilters.assignedTo = params.assignedTo;
  if (params.referrer) currentFilters.referrer = params.referrer;
  if (params.kwpMin) currentFilters.kwpMin = params.kwpMin;
  if (params.kwpMax) currentFilters.kwpMax = params.kwpMax;
  if (params.closeFrom) currentFilters.closeFrom = params.closeFrom;
  if (params.closeTo) currentFilters.closeTo = params.closeTo;

  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('leads');

  // Build referrer dropdown options
  const referrerOptions: { value: string; label: string; disabled?: boolean }[] = [
    { value: '', label: 'All Sources' },
    { value: 'internal_all', label: 'All Internal (Vivek / Mgmt)' },
    ...internalReferrers.map((r) => ({ value: r.id, label: `  ${r.partner_name}` })),
    ...(externalReferrers.length > 0
      ? [{ value: '__divider__', label: '── External Partners ──', disabled: true }]
      : []),
    ...externalReferrers.map((r) => ({ value: r.id, label: r.partner_name })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">SALES PIPELINE</Eyebrow>
          <h1 className="text-2xl font-bold text-n-900">Sales</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales/new">
            <Button>New Lead</Button>
          </Link>
        </div>
      </div>

      <PipelineSummary
        stageCounts={stageCounts}
        closingThisWeekCount={closingThisWeek.length}
        weekStart={weekStart}
        weekEnd={weekEnd}
        monthStart={monthStart}
        monthEnd={monthEnd}
        closingThisWeek={closingThisWeekWindow}
        closingThisMonth={closingThisMonthWindow}
      />

      <LeadStageNav
        stageCounts={stageCounts.map((sc) => ({ status: sc.status, count: sc.count }))}
        basePath="/sales"
      />

      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar
            basePath="/sales"
            filterParams={['search', 'source', 'segment', 'assignedTo', 'status', 'referrer', 'kwpMin', 'kwpMax', 'closeFrom', 'closeTo']}
          >
            {/* C1: Multi-status filter */}
            <FilterMultiSelect
              paramName="status"
              label="Status"
              options={STATUS_FILTER_OPTIONS}
            />

            <FilterSelect paramName="source" className="w-36 h-9 text-sm">
              <option value="">All Sources</option>
              <option value="referral">Referral</option>
              <option value="website">Website</option>
              <option value="builder_tie_up">Builder Tie-up</option>
              <option value="channel_partner">Channel Partner</option>
              <option value="cold_call">Cold Call</option>
              <option value="exhibition">Exhibition</option>
              <option value="social_media">Social Media</option>
              <option value="walkin">Walk-in</option>
            </FilterSelect>

            <FilterSelect paramName="segment" className="w-36 h-9 text-sm">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </FilterSelect>

            {/* C4: Referrer filter */}
            <FilterSelect paramName="referrer" className="w-48 h-9 text-sm">
              {referrerOptions.map((opt) => (
                <option
                  key={opt.value || 'all'}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  {opt.label}
                </option>
              ))}
            </FilterSelect>

            {/* C2: kWp range filter */}
            <FilterRange
              label="kWp"
              minParam="kwpMin"
              maxParam="kwpMax"
              type="number"
              minPlaceholder="Min"
              maxPlaceholder="Max"
            />

            {/* C3: Closing date range filter */}
            <FilterRange
              label="Closing"
              minParam="closeFrom"
              maxParam="closeTo"
              type="date"
            />

            <SearchInput
              placeholder="Search name or phone..."
              className="w-56 h-9 text-sm"
            />
          </FilterBar>
        </CardContent>
      </Card>

      <LeadsTableWrapper
        data={result.data}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        sortColumn={params.sort}
        sortDirection={params.dir}
        currentFilters={currentFilters}
        views={views}
        activeViewId={params.view ?? activeView?.id ?? null}
        visibleColumns={visibleColumns}
        employees={employees}
      />
    </div>
  );
}
