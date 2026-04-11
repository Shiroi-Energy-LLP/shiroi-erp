import { getPurchaseDetail } from '@/lib/procurement-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@repo/ui';
import { ArrowLeft, ShoppingCart, Package, Check } from 'lucide-react';
import Link from 'next/link';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import {
  VendorAssignmentTable,
  PriorityToggle,
} from '@/components/procurement/purchase-detail-controls';

interface PurchaseDetailPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function PurchaseDetailPage({ params }: PurchaseDetailPageProps) {
  const { projectId } = await params;

  let data: Awaited<ReturnType<typeof getPurchaseDetail>>;
  try {
    data = await getPurchaseDetail(projectId);
  } catch (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <ShoppingCart className="w-10 h-10 text-red-400 mb-3" />
        <h3 className="text-sm font-bold text-n-700">Failed to Load</h3>
        <p className="text-xs text-n-500">Could not load purchase data.</p>
      </div>
    );
  }

  const { project, items, purchaseOrders, vendors } = data;

  // Summary
  const totalWithTax = items.reduce((sum, i) => sum + Number(i.total_price || 0), 0);
  const totalWithoutTax = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  const yetToPlace = items.filter((i) => i.procurement_status === 'yet_to_place').length;
  const ordered = items.filter((i) => i.procurement_status === 'order_placed').length;
  const received = items.filter((i) => ['received', 'ready_to_dispatch', 'delivered'].includes(i.procurement_status)).length;
  const withVendor = items.filter((i) => i.vendor_id).length;

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
          <div>
            <h1 className="text-lg font-heading font-bold text-n-900">
              {project.project_number} — Purchase Request
            </h1>
            <p className="text-xs text-n-500">{project.customer_name}</p>
          </div>
        </div>
        <PriorityToggle
          projectId={projectId}
          currentPriority={project.procurement_priority ?? 'medium'}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-n-900">{items.length}</div>
            <div className="text-[10px] text-n-500 uppercase font-medium">Total Items</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-amber-700">{yetToPlace}</div>
            <div className="text-[10px] text-amber-600 uppercase font-medium">Yet to Place</div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-blue-700">{ordered}</div>
            <div className="text-[10px] text-blue-600 uppercase font-medium">Ordered</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-green-700">{received}</div>
            <div className="text-[10px] text-green-600 uppercase font-medium">Received</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold font-mono text-n-900">{formatINR(totalWithTax)}</div>
            <div className="text-[10px] text-n-500 uppercase font-medium">Total (incl. GST)</div>
          </CardContent>
        </Card>
      </div>

      {/* BOQ Items with Vendor Assignment */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Purchase Items — Vendor Assignment
              <span className="text-xs font-normal text-n-500 ml-2">
                ({withVendor}/{items.length} assigned)
              </span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <VendorAssignmentTable
            projectId={projectId}
            items={items}
            vendors={vendors}
          />
        </CardContent>
      </Card>

      {/* Generated POs */}
      {purchaseOrders.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold">
              Purchase Orders ({purchaseOrders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">PO Number</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Vendor</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Date</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Amount</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Status</th>
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
                      <td className="px-2 py-1.5 text-[10px] text-n-500">{formatDate(po.po_date)}</td>
                      <td className="px-2 py-1.5 text-[11px] text-right font-mono">{formatINR(po.total_amount)}</td>
                      <td className="px-2 py-1.5"><POStatusBadge status={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
