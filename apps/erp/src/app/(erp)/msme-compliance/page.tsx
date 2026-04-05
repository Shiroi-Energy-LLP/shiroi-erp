import { getMSMEAlertPOs } from '@/lib/procurement-queries';
import { daysSinceDelivery, getMSMEAlertLevel } from '@/lib/msme-calc';
import { formatDate, formatINR } from '@repo/ui/formatters';
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
  EmptyState,
} from '@repo/ui';
import { Shield } from 'lucide-react';

export default async function MSMECompliancePage() {
  const pos = await getMSMEAlertPOs();
  const today = new Date();

  const enriched = pos.map((po) => {
    const deliveryDate = po.actual_delivery_date ? new Date(po.actual_delivery_date) : null;
    const days = deliveryDate ? daysSinceDelivery(deliveryDate, today) : 0;
    const alertLevel = getMSMEAlertLevel(days);
    return { ...po, days, alertLevel };
  });

  // Sort by days descending (most urgent first)
  enriched.sort((a, b) => b.days - a.days);

  function alertBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (level) {
      case 'overdue': return 'destructive';
      case 'red': return 'destructive';
      case 'amber': return 'secondary';
      default: return 'default';
    }
  }

  function alertBadgeLabel(level: string): string {
    switch (level) {
      case 'overdue': return 'OVERDUE';
      case 'red': return 'CRITICAL';
      case 'amber': return 'WARNING';
      default: return 'OK';
    }
  }

  function rowColorClass(level: string): string {
    switch (level) {
      case 'overdue': return 'bg-red-50';
      case 'red': return 'bg-red-50';
      case 'amber': return 'bg-yellow-50';
      default: return '';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">MSME Compliance</h1>
      </div>

      <Card>
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">
            MSME vendor payments are legally due within 45 days of delivery. This page tracks all
            outstanding MSME POs with delivery dates.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>PO Number</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead className="text-right">Days Since</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Alert Level</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<Shield className="h-12 w-12" />}
                      title="No MSME outstanding POs found"
                      description="All MSME vendor payments are up to date. All clear."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                enriched.map((po) => (
                  <TableRow key={po.id} className={rowColorClass(po.alertLevel)}>
                    <TableCell className="font-medium">
                      {po.vendors?.company_name ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{po.po_number}</TableCell>
                    <TableCell>
                      {po.projects
                        ? `${po.projects.project_number} — ${po.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {po.actual_delivery_date
                        ? formatDate(po.actual_delivery_date)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {po.days}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {po.amount_outstanding != null
                        ? formatINR(Number(po.amount_outstanding))
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={alertBadgeVariant(po.alertLevel)}>
                        {alertBadgeLabel(po.alertLevel)}
                      </Badge>
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
