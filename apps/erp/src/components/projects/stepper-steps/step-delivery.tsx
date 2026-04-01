import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepDeliveryData } from '@/lib/project-stepper-queries';
import { Truck } from 'lucide-react';

interface StepDeliveryProps {
  projectId: string;
}

export async function StepDelivery({ projectId }: StepDeliveryProps) {
  const challans = await getStepDeliveryData(projectId);

  if (challans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Truck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Delivery Challans</h3>
        <p className="text-[13px] text-[#7C818E]">Delivery challans will appear here once materials are dispatched.</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Delivery Challans</CardTitle>
        <span className="text-sm font-mono text-[#7C818E]">{challans.length} challans</span>
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
