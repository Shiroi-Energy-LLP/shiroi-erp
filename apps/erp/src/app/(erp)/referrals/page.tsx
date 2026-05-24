import { Suspense } from 'react';
import { getReferralKpis, getReferralPayouts } from '@/lib/referral-queries';
import { ReferralPageClient } from './referrals-client';
import { Eyebrow } from '@repo/ui';
import { HandCoins } from 'lucide-react';
import Decimal from 'decimal.js';

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

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
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading...</div>}>
        <ReferralsContent />
      </Suspense>
    </div>
  );
}

export const dynamic = 'force-dynamic';
