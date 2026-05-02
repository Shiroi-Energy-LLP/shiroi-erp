import Link from 'next/link';
import { Card, CardContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import { AlertTriangle } from 'lucide-react';
import { getOrphanCounts } from '@/lib/orphan-triage-queries';

export async function OrphanBanner() {
  const counts = await getOrphanCounts();
  if (counts.pendingInvoiceCount === 0 && counts.pendingPaymentCount === 0) return null;
  const totalRupees = Number(counts.pendingInvoiceTotal) + Number(counts.pendingPaymentTotal);
  return (
    <Link href="/cash/orphan-invoices" className="block">
      <Card className="border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">
              {counts.pendingInvoiceCount} orphan invoices · {shortINR(totalRupees)} unattributed ·{' '}
              {counts.pendingPaymentCount} payments
            </p>
            <p className="text-xs text-amber-700">Click to triage in /cash/orphan-invoices →</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
