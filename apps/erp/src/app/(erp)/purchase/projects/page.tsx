// =============================================================================
// /purchase/projects — per-project purchase rollup (spec §3, adapted)
// =============================================================================
// Server component: role-gated to price-visible roles (budgets/profit are
// money). Data = get_purchase_project_rollup RPC (SQL aggregates per project,
// NEVER-DO #12) + the projects table's procurement badge columns joined in by
// the query layer. The four KPI numbers are sums OF the RPC's per-project
// aggregates — aggregates of aggregates, summed here server-side with
// decimal.js (never in the client).
// =============================================================================

import Decimal from 'decimal.js';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { getPurchaseProjectRollup } from '@/lib/purchase-flow-queries';
import {
  PRICE_VISIBLE_ROLES,
  PURCHASE_WRITE_ROLES,
} from '@/lib/purchase-flow-constants';
import { PurchaseProjectsClient } from '@/components/purchase-flow/purchase-projects-client';

export const dynamic = 'force-dynamic';

export default async function PurchaseProjectsPage() {
  const { role } = await getSessionContext();
  if (!role) redirect('/login');
  // Site engineers get the intake screen only (spec §11) — never this page.
  if (role === 'site_supervisor') redirect('/purchase/intake');
  if (!(PRICE_VISIBLE_ROLES as readonly string[]).includes(role)) {
    redirect('/dashboard');
  }

  const rollup = await getPurchaseProjectRollup();
  // Stable display order (the RPC has no ORDER BY).
  rollup.sort((a, b) => a.project_name.localeCompare(b.project_name));

  let budget = new Decimal(0);
  let boi = new Decimal(0);
  let expenses = new Decimal(0);
  for (const r of rollup) {
    budget = budget.plus(r.project_budget ?? 0);
    boi = boi.plus(r.boi_total ?? 0);
    expenses = expenses.plus(r.expenses_total ?? 0);
  }

  return (
    <PurchaseProjectsClient
      rows={rollup}
      kpis={{
        projectCount: rollup.length,
        totalBudget: budget.toDecimalPlaces(2).toNumber(),
        totalBoi: boi.toDecimalPlaces(2).toNumber(),
        totalExpenses: expenses.toDecimalPlaces(2).toNumber(),
      }}
      canWrite={(PURCHASE_WRITE_ROLES as readonly string[]).includes(role)}
    />
  );
}
