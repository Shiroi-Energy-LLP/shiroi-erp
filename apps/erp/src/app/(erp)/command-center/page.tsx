import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getCommandCenterData } from '@/lib/command-center-queries';
import {
  KpiCard, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, shortINR,
} from '@repo/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Command Center · Shiroi ERP' };

function yearLabel(b: string): string {
  return b === '<=2021' ? '≤2021' : b === 'unknown' ? 'Unknown' : b;
}

export default async function CommandCenterPage() {
  await requireRole(['founder', 'project_manager']);
  const { years, total, needsReview } = await getCommandCenterData();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Command Center</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every project, by year — the ERP&apos;s answer to the tracking sheet. Older jobs (no order date)
          are grouped under ≤2021. Cost &amp; margin are computed from real ERP transactions
          (committed POs + approved expenses); where that under-counts a project, the figure firms up as
          reconciliation is completed.
        </p>
      </div>

      {needsReview > 0 && (
        <Link
          href="/reconciliation"
          className="block rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
        >
          <strong>{needsReview}</strong> sheet↔ERP matches need review before these numbers are fully trusted →
          open Reconciliation
        </Link>
      )}

      {total && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Projects" value={total.projectCount} icon="HardHat" subNote={`${total.completedCount} completed`} />
          <KpiCard label="Completed" value={total.completedCount} icon="CheckCircle" />
          <KpiCard label="Total value" value={shortINR(total.totalContracted)} icon="IndianRupee" subNote="contracted" />
          <KpiCard label="ERP cost" value={shortINR(total.totalCostErp)} icon="Receipt" subNote="POs + expenses" />
          <KpiCard label="Avg margin" value={total.avgMarginPct != null ? `${total.avgMarginPct}%` : '—'} icon="TrendingUp" />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Contracted value</TableHead>
              <TableHead className="text-right">ERP cost</TableHead>
              <TableHead className="text-right">Avg margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y) => (
              <TableRow key={y.yearBucket}>
                <TableCell className="font-medium">{yearLabel(y.yearBucket)}</TableCell>
                <TableCell className="text-right">{y.projectCount}</TableCell>
                <TableCell className="text-right">{y.completedCount}</TableCell>
                <TableCell className="text-right">{shortINR(y.totalContracted)}</TableCell>
                <TableCell className="text-right">{y.totalCostErp > 0 ? shortINR(y.totalCostErp) : '—'}</TableCell>
                <TableCell className="text-right">{y.avgMarginPct != null ? `${y.avgMarginPct}%` : '—'}</TableCell>
              </TableRow>
            ))}
            {total && (
              <TableRow className="border-t-2 bg-slate-50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{total.projectCount}</TableCell>
                <TableCell className="text-right">{total.completedCount}</TableCell>
                <TableCell className="text-right">{shortINR(total.totalContracted)}</TableCell>
                <TableCell className="text-right">{shortINR(total.totalCostErp)}</TableCell>
                <TableCell className="text-right">{total.avgMarginPct != null ? `${total.avgMarginPct}%` : '—'}</TableCell>
              </TableRow>
            )}
            {years.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">No data.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
