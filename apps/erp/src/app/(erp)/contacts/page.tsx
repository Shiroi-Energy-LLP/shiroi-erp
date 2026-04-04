import Link from 'next/link';
import { getContacts } from '@/lib/contacts-queries';
import {
  Card, CardContent, Button, Input, Pagination,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

interface ContactsPageProps {
  searchParams: Promise<{ search?: string; page?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getContacts({
    search: params.search || undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.search) filterParams.search = params.search;

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
            <Button type="submit" variant="outline" size="sm">Search</Button>
            {params.search && (
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
                <TableHead>Designation</TableHead>
                <TableHead>Company</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-[#9CA0AB] py-8">
                    No contacts found.
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((contact: any) => {
                  const activeRole = contact.contact_company_roles?.find(
                    (r: any) => !r.ended_at
                  );
                  return (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Link href={`/contacts/${contact.id}`} className="text-[#00B050] hover:underline font-medium">
                          {contact.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{contact.phone ?? '—'}</TableCell>
                      <TableCell className="text-sm">{contact.email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{contact.designation ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {activeRole?.companies?.name ?? '—'}
                        {activeRole?.role_title && (
                          <span className="text-[#9CA0AB] ml-1">({activeRole.role_title})</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/contacts"
            searchParams={filterParams}
            entityName="contacts"
          />
        </CardContent>
      </Card>
    </div>
  );
}
