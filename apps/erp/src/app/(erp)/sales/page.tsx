import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import { getLeadStageCounts, getLeadsClosingBetween } from '@/lib/leads-pipeline-queries';
import { getMyViews } from '@/lib/views-actions';
import { LeadsTableWrapper } from '@/components/leads/leads-table-wrapper';
import { LeadStageNav } from '@/components/leads/lead-stage-nav';
import { PipelineSummary } from '@/components/leads/pipeline-summary';
import { LEAD_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Eyebrow } from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

/**
 * /sales page - the consolidated replacement for /leads + /proposals.
 *
 * Renders the same data as the historical /leads page but under the new
 * "Sales" branding, with basePath `/sales` so LeadStageNav and filters use
 * the new URL. /leads continues to work (via middleware 307 redirects that
 * will be added next), so existing bookmarks are safe.
 */
interface SalesPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    segment?: string;
    search?: string;
    assignedTo?: string;
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

  // This week window (Monday - Sunday) for the Closing This Week metric
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().split('T')[0]!;
  const weekEnd = sunday.toISOString().split('T')[0]!;

  const [result, views, stageCounts, closingThisWeek] = await Promise.all([
    getLeads({
      status: params.status as any || undefined,
      source: params.source as any || undefined,
      segment: params.segment || undefined,
      search: params.search || undefined,
      assignedTo: params.assignedTo || undefined,
      archivedOnly: isArchived,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('leads'),
    getLeadStageCounts(),
    getLeadsClosingBetween(weekStart, weekEnd),
  ]);

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.source) currentFilters.source = params.source;
  if (params.segment) currentFilters.segment = params.segment;
  if (params.search) currentFilters.search = params.search;
  if (params.assignedTo) currentFilters.assignedTo = params.assignedTo;

  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('leads');

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
      />

      {/* Stage bar now includes Path A + Path B + closure_soon */}
      <LeadStageNav
        stageCounts={stageCounts.map((sc) => ({ status: sc.status, count: sc.count }))}
        basePath="/sales"
      />

      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/sales" filterParams={['search', 'source', 'segment', 'assignedTo']}>
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
      />
    </div>
  );
}
