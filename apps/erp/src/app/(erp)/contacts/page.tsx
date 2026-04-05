import Link from 'next/link';
import { getContacts } from '@/lib/contacts-queries';
import { getMyViews } from '@/lib/views-actions';
import { ContactsTableWrapper } from '@/components/contacts/contacts-table-wrapper';
import { CONTACT_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Input, Select, Eyebrow } from '@repo/ui';

const LIFECYCLE_OPTIONS = [
  { value: 'subscriber', label: 'Subscriber' },
  { value: 'lead', label: 'Lead' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'customer', label: 'Customer' },
  { value: 'evangelist', label: 'Evangelist' },
];

interface ContactsPageProps {
  searchParams: Promise<{
    search?: string;
    stage?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, views] = await Promise.all([
    getContacts({
      search: params.search || undefined,
      lifecycleStage: params.stage || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('contacts'),
  ]);

  // Flatten company relationship for DataTable
  const flatData = result.data.map((c: any) => {
    const activeCompany = c.contact_company_roles?.find(
      (r: any) => !r.ended_at && r.is_primary
    ) ?? c.contact_company_roles?.find((r: any) => !r.ended_at);
    return {
      ...c,
      company_name: activeCompany?.companies?.name ?? '',
    };
  });

  const currentFilters: Record<string, string> = {};
  if (params.search) currentFilters.search = params.search;
  if (params.stage) currentFilters.stage = params.stage;

  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('contacts');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">CONTACTS</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Contacts</h1>
        </div>
        <Link href="/contacts/new">
          <Button>New Contact</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-3">
          <form className="flex items-center gap-3 flex-wrap">
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, phone, or email..."
              className="w-72 h-9 text-sm"
            />
            <Select name="stage" defaultValue={params.stage ?? ''} className="w-40 h-9 text-sm">
              <option value="">All Stages</option>
              {LIFECYCLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Button type="submit" variant="outline" size="sm" className="h-9">Search</Button>
            {Object.keys(currentFilters).length > 0 && (
              <Link href="/contacts">
                <Button type="button" variant="ghost" size="sm" className="h-9">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <ContactsTableWrapper
        data={flatData}
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
