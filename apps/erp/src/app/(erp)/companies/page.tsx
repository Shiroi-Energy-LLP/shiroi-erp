import Link from 'next/link';
import { getCompanies } from '@/lib/contacts-queries';
import { getMyViews } from '@/lib/views-actions';
import { CompaniesTableWrapper } from '@/components/contacts/companies-table-wrapper';
import { COMPANY_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Input, Select, Eyebrow } from '@repo/ui';

interface CompaniesPageProps {
  searchParams: Promise<{
    search?: string;
    segment?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, views] = await Promise.all([
    getCompanies({
      search: params.search || undefined,
      segment: params.segment || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('companies'),
  ]);

  const currentFilters: Record<string, string> = {};
  if (params.search) currentFilters.search = params.search;
  if (params.segment) currentFilters.segment = params.segment;

  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('companies');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">COMPANIES</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Companies</h1>
        </div>
        <Link href="/companies/new">
          <Button>New Company</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-3">
          <form className="flex items-center gap-3 flex-wrap">
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-40 h-9 text-sm">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, city, or GSTIN..."
              className="w-64 h-9 text-sm"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9">Search</Button>
            {Object.keys(currentFilters).length > 0 && (
              <Link href="/companies">
                <Button type="button" variant="ghost" size="sm" className="h-9">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <CompaniesTableWrapper
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
