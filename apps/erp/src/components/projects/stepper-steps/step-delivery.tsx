import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
  Button,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepDeliveryData } from '@/lib/project-stepper-queries';
import { getVendorsForDropdown } from '@/lib/project-step-actions';
import { Truck } from 'lucide-react';
import { DeliveryChallanForm } from '@/components/projects/forms/delivery-challan-form';
import Link from 'next/link';

interface StepDeliveryProps {
  projectId: string;
}

export async function StepDelivery({ projectId }: StepDeliveryProps) {
  const [challans, vendors] = await Promise.all([
    getStepDeliveryData(projectId),
    getVendorsForDropdown(),
  ]);

  return (
    <div>
      {/* Upload DC form */}
      <DeliveryChallanForm projectId={projectId} vendors={vendors} />

      {challans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Truck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Delivery Challans</h3>
          <p className="text-[13px] text-[#7C818E]">Click &quot;Upload DC&quot; above to record delivery challans for this project.</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Delivery Challans</CardTitle>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-[#7C818E]">{challans.length} challans</span>
              <Link href={`/projects/${projectId}?tab=execution`}>
                <Button size="sm" variant="ghost" className="text-xs">
                  Continue to Execution →
                </Button>
              </Link>
            </div>
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
                {challans.map((dc) => {
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
                        <StatusBadge status={dc.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'accepted' ? 'success'
    : status === 'rejected' ? 'error'
    : status === 'partial' ? 'warning'
    : 'neutral';

  return (
    <Badge variant={variant} className="capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
