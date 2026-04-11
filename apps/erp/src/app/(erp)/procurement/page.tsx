import Link from 'next/link';
import { getPurchaseRequests } from '@/lib/procurement-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Eyebrow,
} from '@repo/ui';
import { ShoppingCart, Package, ArrowRight } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

const STATUS_OPTIONS = [
  { value: 'yet_to_place', label: 'Yet to Place' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'partially_received', label: 'Partially Received' },
  { value: 'received', label: 'Received' },
];

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
];

function getStatusBadge(status: string | null) {
  switch (status) {
    case 'yet_to_place':
      return <Badge variant="warning" className="text-[10px] px-1.5 py-0">Yet to Place</Badge>;
    case 'order_placed':
      return <Badge variant="info" className="text-[10px] px-1.5 py-0">Order Placed</Badge>;
    case 'partially_received':
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Partial</Badge>;
    case 'received':
      return <Badge variant="success" className="text-[10px] px-1.5 py-0">Received</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status ?? '—'}</Badge>;
  }
}

function getPriorityBadge(priority: string | null) {
  if (priority === 'high') return <Badge variant="error" className="text-[10px] px-1.5 py-0">High</Badge>;
  return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Medium</Badge>;
}

interface ProcurementPageProps {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function ProcurementPage({ searchParams }: ProcurementPageProps) {
  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const { items, total } = await getPurchaseRequests({
    status: params.status || undefined,
    priority: params.priority || undefined,
    search: params.search || undefined,
    page: currentPage,
    per_page: perPage,
  });

  const totalPages = Math.ceil(total / perPage);
  const hasFilters = params.status || params.priority || params.search;

  // Summary counts
  const yetToPlaceCount = items.filter((i) => i.procurement_status === 'yet_to_place').length;
  const orderPlacedCount = items.filter((i) => i.procurement_status === 'order_placed').length;
  const receivedCount = items.filter((i) => i.procurement_status === 'received' || i.procurement_status === 'partially_received').length;

  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.status) p.set('status', params.status);
    if (params.priority) p.set('priority', params.priority);
    if (params.search) p.set('search', params.search);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/procurement${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Purchase Module{' '}
            <span className="text-sm font-normal text-n-500">
              ({total} projects)
            </span>
          </h1>
        </div>
        <Link href="/procurement/orders">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
            <Package className="h-3.5 w-3.5" /> View All POs
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-xl font-bold text-amber-700">{yetToPlaceCount}</div>
            <div className="text-[10px] font-medium text-amber-600 uppercase">Yet to Place</div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-xl font-bold text-blue-700">{orderPlacedCount}</div>
            <div className="text-[10px] font-medium text-blue-600 uppercase">Order Placed</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-xl font-bold text-green-700">{receivedCount}</div>
            <div className="text-[10px] font-medium text-green-600 uppercase">Received</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/procurement" filterParams={['search', 'status', 'priority']}>
            <FilterSelect paramName="status" className="w-36 text-xs h-8">
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="priority" className="w-28 text-xs h-8">
              <option value="">All Priority</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search project..."
              className="w-52 h-8 text-xs"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Purchase Requests</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No purchase requests match your filters.'
                  : 'No projects have been sent to purchase yet. Use "Send to Purchase" from the BOQ step.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-10">S.No</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project Name</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Items</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">POs</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Received Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">Total Amount</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Priority</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Delivered Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.project_id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-2 py-1.5 text-[11px] text-n-400 font-mono">
                        {(currentPage - 1) * perPage + idx + 1}
                      </td>
                      <td className="px-2 py-1.5 text-[11px]">
                        <Link
                          href={`/procurement/project/${item.project_id}`}
                          className="text-p-600 hover:underline"
                        >
                          <div className="font-medium leading-tight">{item.project_number}</div>
                          <div className="text-n-500 text-[10px] leading-tight truncate max-w-[160px]">{item.customer_name}</div>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-n-600 font-mono">{item.item_count}</td>
                      <td className="px-2 py-1.5 text-[11px] text-n-600 font-mono">{item.po_count}</td>
                      <td className="px-2 py-1.5 text-[10px] text-n-500">
                        {item.boq_sent_to_purchase_at
                          ? formatDate(item.boq_sent_to_purchase_at)
                          : <span className="text-n-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-right font-mono font-medium">
                        {formatINR(item.total_with_tax)}
                      </td>
                      <td className="px-2 py-1.5">{getStatusBadge(item.procurement_status)}</td>
                      <td className="px-2 py-1.5">{getPriorityBadge(item.procurement_priority)}</td>
                      <td className="px-2 py-1.5 text-[10px] text-n-500">
                        {item.procurement_received_date
                          ? formatDate(item.procurement_received_date)
                          : <span className="text-n-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <Link href={`/procurement/project/${item.project_id}`}>
                          <ArrowRight className="h-3.5 w-3.5 text-n-400 hover:text-p-600" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-n-200 bg-n-50">
              <span className="text-[11px] text-n-500">
                Page {currentPage} of {totalPages} &middot; {total} projects
              </span>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Link href={pageUrl(currentPage - 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      &larr; Previous
                    </Button>
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link href={pageUrl(currentPage + 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      Next &rarr;
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
