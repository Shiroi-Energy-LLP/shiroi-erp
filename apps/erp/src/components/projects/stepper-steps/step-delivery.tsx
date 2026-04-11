import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
  Button,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepDeliveryData, getStepBoqData } from '@/lib/project-stepper-queries';
import { getVendorsForDropdown, getProjectSiteAddress } from '@/lib/project-step-actions';
import { Truck, PackageCheck } from 'lucide-react';
import { DeliveryChallanForm } from '@/components/projects/forms/delivery-challan-form';
import { CreateDcDialog } from '@/components/projects/forms/create-dc-dialog';
import { DcExpandableRow } from '@/components/projects/forms/dc-actions-buttons';
import Link from 'next/link';

interface StepDeliveryProps {
  projectId: string;
}

export async function StepDelivery({ projectId }: StepDeliveryProps) {
  let deliveryData: Awaited<ReturnType<typeof getStepDeliveryData>>;
  let vendors: Awaited<ReturnType<typeof getVendorsForDropdown>>;
  let boqData: Awaited<ReturnType<typeof getStepBoqData>>;
  let siteAddress: string = '';

  try {
    [deliveryData, vendors, boqData, siteAddress] = await Promise.all([
      getStepDeliveryData(projectId),
      getVendorsForDropdown(),
      getStepBoqData(projectId),
      getProjectSiteAddress({ projectId }),
    ]);
  } catch (error) {
    console.error('[StepDelivery] Failed to load data:', error);
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Truck className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">Failed to Load</h3>
        <p className="text-[13px] text-[#7C818E]">Could not load delivery data. Please refresh the page.</p>
      </div>
    );
  }

  const { outgoingChallans, vendorChallans } = deliveryData;
  const hasOutgoing = outgoingChallans.length > 0;
  const hasVendor = vendorChallans.length > 0;

  // Get "Ready to Dispatch" items from BOQ — include hsn_code
  const readyItems = boqData.type === 'items'
    ? boqData.items.filter((item: any) => item.procurement_status === 'ready_to_dispatch')
        .map((item: any) => ({
          id: item.id,
          item_description: item.item_description,
          item_category: item.item_category,
          hsn_code: item.hsn_code ?? null,
          quantity: Number(item.quantity),
          dispatched_qty: Number(item.dispatched_qty || 0),
          unit: item.unit,
        }))
        .filter((item: any) => item.quantity - item.dispatched_qty > 0)
    : [];

  // DC count for display
  const dcCount = outgoingChallans.length;
  const draftCount = outgoingChallans.filter((dc: any) => dc.status === 'draft').length;
  const dispatchedCount = outgoingChallans.filter((dc: any) => dc.status === 'dispatched').length;
  const deliveredCount = outgoingChallans.filter((dc: any) => dc.status === 'delivered').length;

  return (
    <div className="space-y-6">
      {/* Create DC section + status summary */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <CreateDcDialog projectId={projectId} readyItems={readyItems} siteAddress={siteAddress} />
          {readyItems.length === 0 && (
            <span className="text-xs text-n-500">
              No items with &quot;Ready to Dispatch&quot; status. Update item status in the BOQ tab.
            </span>
          )}
        </div>

        {/* Status summary pills */}
        {dcCount > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-n-500">{dcCount} DCs</span>
            {draftCount > 0 && <Badge variant="neutral" className="text-[10px]">{draftCount} Draft</Badge>}
            {dispatchedCount > 0 && <Badge variant="warning" className="text-[10px]">{dispatchedCount} Dispatched</Badge>}
            {deliveredCount > 0 && <Badge variant="success" className="text-[10px]">{deliveredCount} Delivered</Badge>}
          </div>
        )}
      </div>

      {/* Upload vendor DC form */}
      <DeliveryChallanForm projectId={projectId} vendors={vendors} />

      {/* Outgoing Delivery Challans */}
      {hasOutgoing && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-p-500" />
              <CardTitle className="text-base">Delivery Challans</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/projects/${projectId}?tab=execution`}>
                <Button size="sm" variant="ghost" className="text-xs">
                  Continue to Execution &rarr;
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500 w-[60px]">DC #</th>
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500">Challan No.</th>
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500">Date</th>
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500">Deliver To</th>
                    <th className="px-2 py-2 text-center text-[10px] font-medium text-n-500 w-[50px]">Items</th>
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500 w-[80px]">Status</th>
                    <th className="px-2 py-2 text-left text-[10px] font-medium text-n-500 w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outgoingChallans.map((dc: any, idx: number) => (
                    <DcExpandableRow
                      key={dc.id}
                      dc={dc}
                      projectId={projectId}
                      dcLabel={`DC${idx + 1}`}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vendor Incoming Challans */}
      {hasVendor && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-n-500" />
              <CardTitle className="text-base">Vendor Incoming Challans</CardTitle>
            </div>
            <span className="text-sm font-mono text-[#7C818E]">{vendorChallans.length} DCs</span>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DC Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>DC Date</TableHead>
                  <TableHead>Received Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorChallans.map((dc: any) => {
                  const vendorName = dc.vendors && 'company_name' in dc.vendors
                    ? (dc.vendors as { company_name: string }).company_name
                    : '\u2014';

                  return (
                    <TableRow key={dc.id}>
                      <TableCell className="font-mono font-medium">{dc.vendor_dc_number}</TableCell>
                      <TableCell>{vendorName}</TableCell>
                      <TableCell>{formatDate(dc.vendor_dc_date)}</TableCell>
                      <TableCell>{formatDate(dc.received_date)}</TableCell>
                      <TableCell>
                        <VendorStatusBadge status={dc.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasOutgoing && !hasVendor && (
        <div className="flex flex-col items-center justify-center py-16">
          <Truck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Delivery Challans</h3>
          <p className="text-[13px] text-[#7C818E] max-w-md text-center">
            Create a DC above when items are &quot;Ready to Dispatch&quot; in the BOQ tab.
            DCs are auto-numbered (DC-001, DC-002, etc.) and can be downloaded as PDF.
          </p>
          <Link href={`/projects/${projectId}?tab=boq`} className="mt-3">
            <Button size="sm" variant="ghost">&larr; Go to BOQ</Button>
          </Link>
        </div>
      )}

      {/* Navigation if no outgoing section showed the button */}
      {!hasOutgoing && hasVendor && (
        <div className="flex justify-end">
          <Link href={`/projects/${projectId}?tab=execution`}>
            <Button size="sm" variant="ghost" className="text-xs">
              Continue to Execution &rarr;
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function VendorStatusBadge({ status }: { status: string }) {
  const variant = status === 'accepted' ? 'success'
    : status === 'rejected' ? 'error'
    : status === 'partial' ? 'warning'
    : 'neutral';

  return (
    <Badge variant={variant} className="capitalize text-xs">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
