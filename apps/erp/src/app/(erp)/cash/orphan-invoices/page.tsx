import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { getOrphanCounts, getOrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import { TriageShell } from './_components/triage-shell';
import { Eyebrow, Breadcrumb } from '@repo/ui';

export const metadata = { title: 'Zoho Orphan Triage' };

const ALLOWED = new Set(['founder', 'finance', 'marketing_manager']);

export default async function OrphanTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; customer?: string }>;
}) {
  const params = await searchParams;
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (!ALLOWED.has(profile.role)) {
    redirect('/cash?notice=orphan-triage-forbidden');
  }

  const [counts, summary] = await Promise.all([
    getOrphanCounts(),
    getOrphanCustomerSummary(),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[{ label: 'Cash Flow', href: '/cash' }, { label: 'Zoho Orphan Triage' }]}
      />
      <div>
        <Eyebrow className="mb-1">CASH FLOW</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Zoho Orphan Triage</h1>
        <p className="text-sm text-[#7C818E]">
          Attribute parent-company Zoho invoices and payments to ERP projects.
        </p>
      </div>

      <TriageShell
        counts={counts}
        customers={summary}
        activeTab={(params.tab as 'active' | 'deferred' | 'excluded' | 'audit' | undefined) ?? 'active'}
        selectedCustomer={params.customer ?? null}
      />
    </div>
  );
}
