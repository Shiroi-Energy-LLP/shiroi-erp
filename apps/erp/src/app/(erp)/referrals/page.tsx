import { Suspense } from 'react';
import { getReferralKpis, getReferralPayouts } from '@/lib/referral-queries';
import { ReferralPageClient } from './referrals-client';
import { Eyebrow, Skeleton, formatINR } from '@repo/ui';
import { HandCoins } from 'lucide-react';

async function ReferralsContent() {
  const [kpis, pending, approved, paid] = await Promise.all([
    getReferralKpis(),
    getReferralPayouts('pending'),
    getReferralPayouts('approved'),
    getReferralPayouts('paid'),
  ]);

  return (
    <ReferralPageClient
      kpis={kpis}
      pendingPayouts={pending}
      approvedPayouts={approved}
      paidPayouts={paid}
      formatINR={formatINR}
    />
  );
}

function ReferralsLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}

export default function ReferralsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <HandCoins className="h-6 w-6 text-muted-foreground" />
        <div>
          <Eyebrow>Channel Partners</Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight">Referral Payouts</h1>
        </div>
      </div>
      <Suspense fallback={<ReferralsLoading />}>
        <ReferralsContent />
      </Suspense>
    </div>
  );
}

export const dynamic = 'force-dynamic';
