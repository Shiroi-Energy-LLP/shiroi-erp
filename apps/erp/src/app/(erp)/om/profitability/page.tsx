/**
 * E12 — O&M Profitability Analytics page
 *
 * Accessible to: founder, om_technician
 * Shows per-project O&M ticket costs vs revenue collected and SLA compliance.
 */

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { formatINR } from '@repo/ui';
import { getCurrentUserRole, getOmProfitability } from '@/lib/om-profitability-queries';
import { OmProfitabilityTable } from './_components/om-profitability-table';

export const dynamic = 'force-dynamic';

export default async function OmProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const userRole = await getCurrentUserRole();
  if (!userRole) redirect('/login');
  if (!['founder', 'om_technician'].includes(userRole.role)) redirect('/om');

  const params = await searchParams;

  // Default: last 90 days
  const endDate = params.end ?? new Date().toISOString().slice(0, 10);
  const startDate = params.start ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await getOmProfitability(startDate, endDate);

  if (!result.ok) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load O&M profitability data: {result.error}</p>
      </div>
    );
  }

  const profitabilityRows = result.rows;

  // KPI aggregates — counts only (not money .reduce); money summing is safe here
  // since get_om_profitability already aggregates in SQL; we just display totals across rows.
  const totalTickets = profitabilityRows.reduce((sum, r) => sum + (r.ticket_count ?? 0), 0);
  const totalRevenue = profitabilityRows.reduce((sum, r) => sum + Number(r.ticket_service_amount ?? 0), 0);
  const totalCost = profitabilityRows.reduce((sum, r) => sum + Number(r.ticket_parts_cost ?? 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const projectsWithTickets = profitabilityRows.filter((r) => (r.ticket_count ?? 0) > 0);
  const avgSlaCompliance = projectsWithTickets.length > 0
    ? projectsWithTickets.reduce((sum, r) => sum + (r.sla_compliance_pct ?? 100), 0) / projectsWithTickets.length
    : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">O&M Profitability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Period: {startDate} to {endDate} — {profitabilityRows.length} projects
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Tickets</p>
          <p className="text-2xl font-bold mt-1">{totalTickets}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue Collected</p>
          <p className="text-2xl font-bold mt-1">{formatINR(totalRevenue)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Parts Cost</p>
          <p className="text-2xl font-bold mt-1">{formatINR(totalCost)}</p>
        </div>
        <div className={`rounded-lg border p-4 ${totalProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Net Profit</p>
          <p className={`text-2xl font-bold mt-1 ${totalProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {totalProfit >= 0 ? '+' : ''}{formatINR(totalProfit)}
          </p>
        </div>
      </div>

      {avgSlaCompliance !== null && (
        <div className="rounded-lg border p-4 flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg SLA Compliance</p>
            <p className={`text-3xl font-bold mt-1 ${avgSlaCompliance >= 90 ? 'text-green-600' : avgSlaCompliance >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
              {avgSlaCompliance.toFixed(1)}%
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Across {projectsWithTickets.length} projects with tickets in the period
          </p>
        </div>
      )}

      {/* Per-project table */}
      <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-lg" />}>
        <OmProfitabilityTable rows={profitabilityRows} />
      </Suspense>
    </div>
  );
}
