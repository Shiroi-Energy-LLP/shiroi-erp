import Link from 'next/link';
import { getPurchaseOrders, getVendorsList, getProjectsList } from '@/lib/procurement-queries';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

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

  const hasFilters = params.status || params.vendor || params.project || params.search;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Purchase Orders</h1>
        <Link href="/procurement/new">
          <Button>New PO</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="status" defaultValue={params.status ?? ''} className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="vendor" defaultValue={params.vendor ?? ''} className="w-48">
              <option value="">All Vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.company_name}</option>
              ))}
            </Select>
            <Select name="project" defaultValue={params.project ?? ''} className="w-52">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.customer_name}
                </option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search PO number..."
              className="w-52"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/procurement">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No purchase orders found.
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
