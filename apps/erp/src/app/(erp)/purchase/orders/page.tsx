// =============================================================================
// /purchase/orders — quick-PO history log (spec §7)
// =============================================================================
// Server component: role-gates the page (site engineers → intake; money page,
// so price-visible roles only), reads the search/page params and fetches one
// page of source='boi_quick' POs (newest first) plus the SQL-side KPI
// aggregates, then hands off to the client log.
// =============================================================================

import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { getBoiPos, getProjectOptions } from '@/lib/purchase-flow-queries';
import {
  PRICE_VISIBLE_ROLES,
  PURCHASE_WRITE_ROLES,
} from '@/lib/purchase-flow-constants';
import { PoLogClient } from '@/components/purchase-flow/po-log-client';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PurchaseOrdersPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const { role } = await getSessionContext();
  if (!role) redirect('/login');
  // Site engineers get the intake screen only (spec §11) — never this page.
  if (role === 'site_supervisor') redirect('/purchase/intake');
  if (!(PRICE_VISIBLE_ROLES as readonly string[]).includes(role)) {
    redirect('/dashboard');
  }

  const search = typeof params.search === 'string' ? params.search.trim() : '';
  const pageRaw = typeof params.page === 'string' ? parseInt(params.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const [{ rows, total, totalValue }, projects] = await Promise.all([
    getBoiPos({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    // Project options feed the edit modal's combobox.
    getProjectOptions(),
  ]);

  return (
    <PoLogClient
      rows={rows}
      total={total}
      totalValue={totalValue}
      page={page}
      pageSize={PAGE_SIZE}
      search={search}
      projects={projects}
      canWrite={(PURCHASE_WRITE_ROLES as readonly string[]).includes(role)}
    />
  );
}
