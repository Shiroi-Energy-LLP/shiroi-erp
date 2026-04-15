import Link from 'next/link';
import { listPartners } from '@/lib/partners-queries';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Eyebrow,
} from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { Handshake } from 'lucide-react';

const PARTNER_TYPE_LABELS: Record<string, string> = {
  individual_broker: 'Individual Broker',
  aggregator: 'Aggregator',
  ngo: 'NGO',
  housing_society: 'Housing Society',
  corporate: 'Corporate',
  consultant: 'Consultant',
  referral: 'Referral',
  electrical_contractor: 'Electrical Contractor',
  architect: 'Architect',
  mep_firm: 'MEP Firm',
  other: 'Other',
};

const PARTNER_TYPE_OPTIONS = Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const COMMISSION_TYPE_LABELS: Record<string, string> = {
  per_kwp: 'Per kWp',
  percentage_of_revenue: '% of Revenue',
  fixed_per_deal: 'Fixed / Deal',
};

function formatCommissionRate(type: string, rate: number): string {
  if (type === 'per_kwp') return `\u20B9${rate}/kWp`;
  if (type === 'percentage_of_revenue') return `${rate}%`;
  if (type === 'fixed_per_deal') return `\u20B9${rate.toLocaleString('en-IN')}`;
  return String(rate);
}

function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface PartnersPageProps {
  searchParams: Promise<{
    type?: string;
    search?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function PartnersPage({ searchParams }: PartnersPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await listPartners({
    partnerType: params.type as any,
    search: params.search,
    isActive: params.status === 'inactive' ? false : params.status === 'active' ? true : undefined,
    page,
    pageSize: 50,
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">MARKETING</Eyebrow>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-n-900">Partners</h1>
            <Badge variant="neutral">{result.total}</Badge>
          </div>
          <p className="text-sm text-n-500 mt-1">
            Consultants, referrers, and other introducers who bring in leads.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/partners" filterParams={['search', 'type', 'status']}>
            <FilterSelect paramName="type" className="w-44 h-9 text-sm">
              <option value="">All Types</option>
              {PARTNER_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="status" className="w-32 h-9 text-sm">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </FilterSelect>
            <SearchInput
              placeholder="Search name, contact, phone..."
              className="w-64 h-9 text-sm"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {result.rows.length === 0 ? (
            <div className="p-12 text-center text-n-500">
              <Handshake className="w-8 h-8 mx-auto mb-2 text-n-400" />
              <p className="text-sm">No partners found</p>
              <p className="text-xs mt-1">
                Partners are channel partners, consultants, and referrers who bring in leads.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Commission YTD</TableHead>
                  <TableHead>TDS</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((p) => (
                  <TableRow key={p.id} className="hover:bg-n-50">
                    <TableCell className="font-medium">
                      <Link
                        href={`/partners/${p.id}`}
                        className="text-shiroi-green hover:underline"
                      >
                        {p.partner_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral" className="text-xs">
                        {PARTNER_TYPE_LABELS[p.partner_type] ?? p.partner_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{p.contact_person}</div>
                      <div className="text-xs text-n-500">{p.phone}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="text-xs text-n-500">
                        {COMMISSION_TYPE_LABELS[p.commission_type] ?? p.commission_type}
                      </div>
                      <div className="font-medium">
                        {formatCommissionRate(p.commission_type, Number(p.commission_rate))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.leads_referred_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.leads_converted_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatINR(Number(p.annual_commission_ytd ?? 0))}
                    </TableCell>
                    <TableCell>
                      {p.tds_applicable ? (
                        <Badge variant="warning" className="text-xs">
                          TDS 5%
                        </Badge>
                      ) : (
                        <span className="text-xs text-n-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? 'success' : 'neutral'} className="text-xs">
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
