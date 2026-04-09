import Link from 'next/link';
import { getProposals } from '@/lib/proposals-queries';
import { getMyViews } from '@/lib/views-actions';
import { ProposalsTableWrapper } from '@/components/proposals/proposals-table-wrapper';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Eyebrow } from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

interface ProposalsPageProps {
  searchParams: Promise<{
    status?: string;
    systemType?: string;
    isBudgetary?: string;
    search?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}

export default async function ProposalsPage({ searchParams }: ProposalsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, views] = await Promise.all([
    getProposals({
      status: params.status as any || undefined,
      systemType: params.systemType || undefined,
      isBudgetary: params.isBudgetary || undefined,
      search: params.search || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('proposals'),
  ]);

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.systemType) currentFilters.systemType = params.systemType;
  if (params.isBudgetary) currentFilters.isBudgetary = params.isBudgetary;
  if (params.search) currentFilters.search = params.search;

  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('proposals');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">PROPOSALS</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Proposals</h1>
        </div>
        <Link href="/proposals/new">
          <Button>New Proposal</Button>
        </Link>
      </div>

      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/proposals" filterParams={['search', 'status', 'systemType', 'isBudgetary']}>
            <FilterSelect paramName="status" className="w-36 h-9 text-sm">
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              <option value="revised">Revised</option>
            </FilterSelect>
            <FilterSelect paramName="systemType" className="w-32 h-9 text-sm">
              <option value="">All Systems</option>
              <option value="on_grid">On-Grid</option>
              <option value="hybrid">Hybrid</option>
              <option value="off_grid">Off-Grid</option>
            </FilterSelect>
            <FilterSelect paramName="isBudgetary" className="w-32 h-9 text-sm">
              <option value="">All Types</option>
              <option value="true">Budgetary</option>
              <option value="false">Detailed</option>
            </FilterSelect>
            <SearchInput
              placeholder="Search proposal #..."
              className="w-48 h-9 text-sm"
            />
          </FilterBar>
        </CardContent>
      </Card>

      <ProposalsTableWrapper
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
