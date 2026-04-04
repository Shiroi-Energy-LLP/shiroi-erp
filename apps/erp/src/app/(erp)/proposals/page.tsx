import Link from 'next/link';
import { getProposals } from '@/lib/proposals-queries';
import { getMyViews } from '@/lib/views-actions';
import { ProposalsTableWrapper } from '@/components/proposals/proposals-table-wrapper';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Input, Select } from '@repo/ui';

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

  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | null;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('proposals');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Proposals</h1>
        <Link href="/proposals/new">
          <Button>New Proposal</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-3">
          <form className="flex items-center gap-3 flex-wrap">
            <Select name="status" defaultValue={params.status ?? ''} className="w-36 h-9 text-sm">
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              <option value="revised">Revised</option>
            </Select>
            <Select name="systemType" defaultValue={params.systemType ?? ''} className="w-32 h-9 text-sm">
              <option value="">All Systems</option>
              <option value="on_grid">On-Grid</option>
              <option value="hybrid">Hybrid</option>
              <option value="off_grid">Off-Grid</option>
            </Select>
            <Select name="isBudgetary" defaultValue={params.isBudgetary ?? ''} className="w-32 h-9 text-sm">
              <option value="">All Types</option>
              <option value="true">Budgetary</option>
              <option value="false">Detailed</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search proposal #..."
              className="w-48 h-9 text-sm"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9">Filter</Button>
            {Object.keys(currentFilters).length > 0 && (
              <Link href="/proposals">
                <Button type="button" variant="ghost" size="sm" className="h-9">Clear</Button>
              </Link>
            )}
          </form>
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
        activeViewId={params.view ?? null}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
