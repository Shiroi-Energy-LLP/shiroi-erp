import Link from 'next/link';
import { getPurchaseOrders, getVendorsList, getProjectsList } from '@/lib/procurement-queries';
import { CreatePODialog } from '@/components/procurement/create-po-dialog';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  EmptyState,
} from '@repo/ui';
import { ShoppingCart, ArrowLeft } from 'lucide-react';
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

interface POListPageProps {
  searchParams: Promise<{
    status?: string;
    vendor?: string;
    project?: string;
    search?: string;
  }>;
}

export default async function POListPage({ searchParams }: POListPageProps) {
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/procurement">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <h1 className="text-lg font-heading font-bold text-n-900">
            All Purchase Orders
            <span className="text-sm font-normal text-n-500 ml-2">({purchaseOrders.length})</span>
          </h1>
        </div>
        <CreatePODialog projects={projects} vendors={vendors} />
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/procurement/orders" filterParams={['search', 'status', 'vendor', 'project']}>
            <FilterSelect paramName="status" className="w-36 text-xs h-8">
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="vendor" className="w-40 text-xs h-8">
              <option value="">All Vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.company_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="project" className="w-44 text-xs h-8">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.customer_name}
                </option>
              ))}
            </FilterSelect>
            <SearchInput placeholder="Search PO number..." className="w-48 h-8 text-xs" />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {purchaseOrders.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={<ShoppingCart className="h-10 w-10" />}
                title="No purchase orders found"
                description="Create a purchase order to start procuring materials."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">PO Number</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">PO Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">Total</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">Outstanding</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-2 py-1.5 text-[11px]">
                        <Link href={`/procurement/${po.id}`} className="text-p-600 hover:underline font-medium">
                          {po.po_number}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-n-700">{po.vendors?.company_name ?? '—'}</td>
                      <td className="px-2 py-1.5 text-[11px] text-n-600">
                        {po.projects
                          ? `${po.projects.project_number} — ${po.projects.customer_name}`
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-n-500">{formatDate(po.po_date)}</td>
                      <td className="px-2 py-1.5 text-[11px] text-right font-mono">{formatINR(po.total_amount)}</td>
                      <td className="px-2 py-1.5 text-[11px] text-right font-mono">{formatINR(po.amount_outstanding)}</td>
                      <td className="px-2 py-1.5"><POStatusBadge status={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
