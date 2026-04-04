import Link from 'next/link';
import { getContacts } from '@/lib/contacts-queries';
import {
  Card, CardContent, Button, Input, Select, Pagination,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge,
} from '@repo/ui';

const LIFECYCLE_OPTIONS = [
  { value: '', label: 'All Stages' },
  { value: 'subscriber', label: 'Subscriber' },
  { value: 'lead', label: 'Lead' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'customer', label: 'Customer' },
  { value: 'evangelist', label: 'Evangelist' },
];

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber: '#7C818E',
  lead: '#2563EB',
  opportunity: '#EA580C',
  customer: '#00B050',
  evangelist: '#9333EA',
};

interface ContactsPageProps {
  searchParams: Promise<{ search?: string; stage?: string; page?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getContacts({
    search: params.search || undefined,
    lifecycleStage: params.stage || undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.search) filterParams.search = params.search;
  if (params.stage) filterParams.stage = params.stage;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Contacts</h1>
        <Link href="/contacts/new">
          <Button>New Contact</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-3">
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, phone, or email..."
              className="w-80"
            />
            <Select name="stage" defaultValue={params.stage ?? ''} className="w-40">
              {LIFECYCLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Button type="submit" variant="outline" size="sm">Search</Button>
            {(params.search || params.stage) && (
              <Link href="/contacts">
                <Button type="button" variant="ghost" size="sm">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-[#9CA0AB]">
                    No contacts found.
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((c: any) => {
                  const activeCompany = c.contact_company_roles?.find(
                    (r: any) => !r.ended_at && r.is_primary
                  ) ?? c.contact_company_roles?.find((r: any) => !r.ended_at);
                  const stage = c.lifecycle_stage ?? 'lead';

                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/contacts/${c.id}`} className="font-medium text-[#00B050] hover:underline">
                          {c.name || '—'}
                        </Link>
                        {c.designation && (
                          <span className="block text-xs text-[#9CA0AB]">{c.designation}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{c.phone ?? '—'}</TableCell>
                      <TableCell className="text-sm">{c.email ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {activeCompany?.companies?.name ? (
                          <Link href={`/companies/${activeCompany.company_id}`} className="text-[#00B050] hover:underline">
                            {activeCompany.companies.name}
                          </Link>
                        ) : (
                          <span className="text-[#9CA0AB]">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="neutral"
                          className="text-[10px] capitalize"
                          style={{
                            color: LIFECYCLE_COLORS[stage] ?? '#7C818E',
                            borderColor: `${LIFECYCLE_COLORS[stage] ?? '#7C818E'}30`,
                            backgroundColor: `${LIFECYCLE_COLORS[stage] ?? '#7C818E'}10`,
                          }}
                        >
                          {stage}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {result.totalPages > 1 && (
        <Pagination
          currentPage={result.page}
          totalPages={result.totalPages}
          totalRecords={result.total}
          pageSize={result.pageSize}
          basePath="/contacts"
          searchParams={filterParams}
        />
      )}
    </div>
  );
}
