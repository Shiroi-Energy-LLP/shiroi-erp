import Link from 'next/link';
import { getPurchaseOrders, getVendorsList, getProjectsList } from '@/lib/procurement-queries';
import { CreatePODialog } from '@/components/procurement/create-po-dialog';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Eyebrow,
  EmptyState,
  Button,
} from '@repo/ui';
import { ShoppingCart } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_delivered', label: 'Partially Delivered' },
  { value: 'fully_delivered', label: 'Fully Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface ProcurementPageProps {
  searchParams: Promise<{
    status?: string;
    vendor?: string;
    project?: string;
    search?: string;
  }>;
}

export default async function ProcurementPage({ searchParams }: ProcurementPageProps) {
  const params = await searchParams;

  const [purchaseOrders, vendors, projects] = await Promise.all([
    getPurchaseOrders({
      status: params.status || undefined,
      vendorId: params.vendor || undefined,
      projectId: params.project || undefined,
      search: params.search || undefined,
    }),
    getVendorsList(),
    getProjectsList(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">PROCUREMENT</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Purchase Orders</h1>
        </div>
        <CreatePODialog projects={projects} vendors={vendors} />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <FilterBar basePath="/procurement" filterParams={['search', 'status', 'vendor', 'project']}>
            <FilterSelect paramName="status" className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="vendor" className="w-48">
              <option value="">All Vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.company_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="project" className="w-52">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.customer_name}
                </option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search PO number..."
              className="w-52 h-9 text-sm"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>PO Date</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<ShoppingCart className="h-12 w-12" />}
                      title="No purchase orders found"
                      description="Create a purchase order to start procuring materials for projects."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                purchaseOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell>
                      <Link
                        href={`/procurement/${po.id}`}
                        className="text-[#00B050] hover:underline font-medium"
                      >
                        {po.po_number}
                      </Link>
                    </TableCell>
                    <TableCell>{po.vendors?.company_name ?? '—'}</TableCell>
                    <TableCell>
                      {po.projects
                        ? `${po.projects.project_number} — ${po.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(po.po_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINR(po.total_amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINR(po.amount_outstanding)}
                    </TableCell>
                    <TableCell>
                      <POStatusBadge status={po.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
