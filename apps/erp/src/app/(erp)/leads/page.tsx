import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import { getMyViews } from '@/lib/views-actions';
import { LeadsTableWrapper } from '@/components/leads/leads-table-wrapper';
import { LEAD_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Input, Select, Eyebrow } from '@repo/ui';

interface LeadsPageProps {
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
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, views] = await Promise.all([
    getLeads({
      status: params.status as any || undefined,
      source: params.source as any || undefined,
      segment: params.segment || undefined,
      search: params.search || undefined,
      assignedTo: params.assignedTo || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('leads'),
  ]);

  // Build current filter params for view saving
  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.source) currentFilters.source = params.source;
  if (params.segment) currentFilters.segment = params.segment;
  if (params.search) currentFilters.search = params.search;
  if (params.assignedTo) currentFilters.assignedTo = params.assignedTo;

  // Active view columns (from view or defaults)
  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | null;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('leads');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">LEADS PIPELINE</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Leads</h1>
        </div>
        <Link href="/leads/new">
          <Button>New Lead</Button>
        </Link>
      </div>

      {/* Quick Filters */}
      <Card>
        <CardContent className="py-3">
          <form className="flex items-center gap-3 flex-wrap">
            <Select name="status" defaultValue={params.status ?? ''} className="w-40 h-9 text-sm">
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="site_survey_scheduled">Survey Scheduled</option>
              <option value="site_survey_done">Survey Done</option>
              <option value="proposal_sent">Proposal Sent</option>
              <option value="design_confirmed">Design Confirmed</option>
              <option value="negotiation">Negotiation</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="on_hold">On Hold</option>
              <option value="disqualified">Disqualified</option>
              <option value="converted">Converted</option>
            </Select>
            <Select name="source" defaultValue={params.source ?? ''} className="w-36 h-9 text-sm">
              <option value="">All Sources</option>
              <option value="referral">Referral</option>
              <option value="website">Website</option>
              <option value="builder_tie_up">Builder Tie-up</option>
              <option value="channel_partner">Channel Partner</option>
              <option value="cold_call">Cold Call</option>
              <option value="exhibition">Exhibition</option>
              <option value="social_media">Social Media</option>
              <option value="walkin">Walk-in</option>
            </Select>
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-36 h-9 text-sm">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search name or phone..."
              className="w-56 h-9 text-sm"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9">Filter</Button>
            {Object.keys(currentFilters).length > 0 && (
              <Link href="/leads">
                <Button type="button" variant="ghost" size="sm" className="h-9">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* DataTable */}
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
        activeViewId={params.view ?? null}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
