import Link from 'next/link';
import { getCompanies } from '@/lib/contacts-queries';
import {
  Card, CardContent, Button, Input, Select, Pagination, Badge, EmptyState,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import { Building2 } from 'lucide-react';

interface CompaniesPageProps {
  searchParams: Promise<{ search?: string; segment?: string; page?: string }>;
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getCompanies({
    search: params.search || undefined,
    segment: params.segment || undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.search) filterParams.search = params.search;
  if (params.segment) filterParams.segment = params.segment;
  const hasFilters = Object.keys(filterParams).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Companies</h1>
        <Link href="/companies/new">
          <Button>New Company</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-3">
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-40">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, city, or GSTIN..."
              className="w-72"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
            {hasFilters && (
              <Link href="/companies">
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
                <TableHead>Company Name</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>City</TableHead>
                <TableHead>GSTIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState
                      icon={<Building2 className="h-12 w-12" />}
                      title="No companies found"
                      description="Add a company to start tracking organizations."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((company: any) => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <Link href={`/companies/${company.id}`} className="text-[#00B050] hover:underline font-medium">
                        {company.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral" className="capitalize">
                        {company.segment ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{company.city ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{company.gstin ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalItems={result.total}
            pageSize={result.pageSize}
            basePath="/companies"
            filterParams={filterParams}
            entityName="companies"
          />
        </CardContent>
      </Card>
    </div>
  );
}
