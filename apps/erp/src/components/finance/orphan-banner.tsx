import Link from 'next/link';
import { InfoBox } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import { getOrphanCounts } from '@/lib/orphan-triage-queries';

export async function OrphanBanner() {
  const counts = await getOrphanCounts();
  if (counts.pendingInvoiceCount === 0 && counts.pendingPaymentCount === 0) return null;
  const totalRupees = Number(counts.pendingInvoiceTotal) + Number(counts.pendingPaymentTotal);
  return (
    <Link href="/cash/orphan-invoices" className="block">
      <InfoBox
        variant="warning"
        className="transition-colors hover:opacity-90"
        title={
          <>
            {counts.pendingInvoiceCount} orphan invoices · {shortINR(totalRupees)} unattributed ·{' '}
            {counts.pendingPaymentCount} payments
          </>
        }
      >
        Click to triage in /cash/orphan-invoices →
      </InfoBox>
    </Link>
  );
}
