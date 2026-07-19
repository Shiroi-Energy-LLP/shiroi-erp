import Link from 'next/link';
import { getLeads, getSalesEngineers, resolveReferrerFilter } from '@/lib/leads-queries';
import type { LeadFilters } from '@/lib/leads-queries';
import {
  getLeadStageCounts,
  getLeadsClosingBetween,
  getPipelineCloseWindow,
} from '@/lib/leads-pipeline-queries';
import { getInternalReferrers, getExternalPartnerIds } from '@/lib/partners-queries';
import { getMyViews } from '@/lib/views-actions';
import { LeadsTableWrapper } from '@/components/leads/leads-table-wrapper';
import { LeadStageNav } from '@/components/leads/lead-stage-nav';
import { PipelineSummary } from '@/components/leads/pipeline-summary';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Eyebrow } from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { FilterRange } from '@/components/filter-range';
import { DateRangeFilter } from '@/components/date-range-filter';
import { STAGE_LABELS } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

const TERMINAL_FILTER_STAGES: LeadStatus[] = ['converted', 'proposal_sent', 'disqualified'];

const STATUS_FILTER_OPTIONS = (
  Object.entries(STAGE_LABELS) as [LeadStatus, string][]
)
  .filter(([s]) => !TERMINAL_FILTER_STAGES.includes(s))
  .map(([value, label]) => ({ value, label }));

interface LeadsPageProps {
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

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const isArchived = params.archived === 'true';

  // Get the start/end of this week (Monday to Sunday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().split('T')[0]!;
  const weekEnd = sunday.toISOString().split('T')[0]!;

  // This month window (today — last day of current month)
  const monthStart = now.toISOString().split('T')[0]!;
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthEnd = lastDayOfMonth.toISOString().split('T')[0]!;

  // Parse multi-status filter
  const statusParam = params.status;
  const statusFilter: LeadStatus | LeadStatus[] | undefined = statusParam
    ? statusParam.includes(',')
      ? (statusParam.split(',').filter(Boolean) as LeadStatus[])
      : (statusParam as LeadStatus)
    : undefined;

  const kwpMin = params.kwpMin ? parseFloat(params.kwpMin) : undefined;
  const kwpMax = params.kwpMax ? parseFloat(params.kwpMax) : undefined;
  const referrerParam = params.referrer;

  // Only the 'mgmt' / 'customer' referrer modes need a channel_partners lookup
  // to resolve their id list; every other mode ('none', unset) does not. These
  // lookups feed resolveReferrerFilter only — they are not rendered — so resolve
  // them up front and ONLY when needed. This keeps the common load from firing
  // two extra queries and lets getLeads join the parallel batch below instead of
  // running as a serial second wave.
  let referrerIds: string[] | undefined;
  let noReferrer: boolean | undefined;
  if (referrerParam === 'mgmt') {
    const internalReferrers = await getInternalReferrers();
    ({ referrerIds, noReferrer } = resolveReferrerFilter(referrerParam, internalReferrers.map((r) => r.id), []));
  } else if (referrerParam === 'customer') {
    const externalPartnerIds = await getExternalPartnerIds();
    ({ referrerIds, noReferrer } = resolveReferrerFilter(referrerParam, [], externalPartnerIds));
  } else {
    ({ referrerIds, noReferrer } = resolveReferrerFilter(referrerParam, [], []));
  }

  const leadsFilters: LeadFilters = {
    status: statusFilter,
    source: params.source as LeadFilters['source'] | undefined,
    segment: params.segment || undefined,
    search: params.search || undefined,
    assignedTo: params.assignedTo || undefined,
    referrerIds,
    noReferrer,
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

  // Fetch the table data alongside the page chrome in one parallel batch.
  // getLeads is the heaviest query here, so overlapping it with the summary /
  // nav / filter lookups (rather than awaiting it afterwards) shortens the
  // critical path — important while the dev DB is CPU-constrained.
  const [
    result,
    views,
    stageCounts,
    closingThisWeek,
    employees,
    closingThisWeekWindow,
    closingThisMonthWindow,
  ] = await Promise.all([
    getLeads(leadsFilters),
    getMyViews('leads'),
    getLeadStageCounts(),
    getLeadsClosingBetween(weekStart, weekEnd),
    getSalesEngineers(),
    getPipelineCloseWindow(weekStart, weekEnd),
    getPipelineCloseWindow(monthStart, monthEnd),
  ]);

  // Build current filter params for view saving
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

  // Active view columns (from view or default view)
  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('leads');

  return (
    <ListPageShell
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FilterBar
              basePath="/leads"
              filterParams={['search', 'source', 'segment', 'assignedTo', 'status', 'referrer', 'kwpMin', 'kwpMax', 'closeFrom', 'closeTo']}
            >
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

              <FilterSelect paramName="referrer" className="w-44 h-9 text-sm">
                <option value="">All Referrers</option>
                <option value="none">No referrer</option>
                <option value="mgmt">MGMT</option>
                <option value="customer">Customer</option>
              </FilterSelect>

              <FilterRange
                label="kWp"
                minParam="kwpMin"
                maxParam="kwpMax"
                type="number"
                minPlaceholder="Min"
                maxPlaceholder="Max"
              />

              <DateRangeFilter label="Closing" fromParam="closeFrom" toParam="closeTo" />

              <SearchInput
                placeholder="Search name or phone..."
                className="w-56 h-9 text-sm"
              />
            </FilterBar>
          </div>
          <Link href="/leads/new">
            <Button>New Lead</Button>
          </Link>
        </div>
      }
    >
      {/* Title (scrolls away) */}
      <div>
        <Eyebrow className="mb-1">MARKETING PIPELINE</Eyebrow>
        <h1 className="text-2xl font-bold text-n-900">Leads</h1>
      </div>

      {/* Pipeline Summary Cards (scroll away) */}
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

      {/* Stage Navigation (scrolls away) */}
      <LeadStageNav
        stageCounts={stageCounts.map((sc) => ({ status: sc.status, count: sc.count }))}
      />

      {/* DataTable — column header freezes at the top of the scroll region */}
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
    </ListPageShell>
  );
}
