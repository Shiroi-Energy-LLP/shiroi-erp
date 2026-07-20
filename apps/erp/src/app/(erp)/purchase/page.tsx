// =============================================================================
// /purchase — Bill of Items workspace (spec §5)
// =============================================================================
// Server component: resolves the viewer's role, role-gates the page, fetches
// the full BOI line set + KPI totals + project/category options and hands off
// to the client root. Status views are this same page with `?status=…`
// (spec §5.2 — the status filter is then locked and its dropdown hidden).
// =============================================================================

import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import {
  getBoiLines,
  getBoiStatusTotals,
  getProjectOptions,
} from '@/lib/purchase-flow-queries';
import { listItemCategories } from '@/lib/item-catalog-queries';
import {
  PRICE_VISIBLE_ROLES,
  isBoiStatus,
  type BoiStatus,
} from '@/lib/purchase-flow-constants';
import { BoiWorkspace } from '@/components/purchase-flow/boi-workspace';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PurchasePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const { role } = await getSessionContext();
  if (!role) redirect('/login');
  // Site engineers get the intake screen only (spec §11) — never this page.
  if (role === 'site_supervisor') redirect('/purchase/intake');
  if (!(PRICE_VISIBLE_ROLES as readonly string[]).includes(role)) {
    redirect('/dashboard');
  }

  const statusRaw = typeof params.status === 'string' ? params.status : null;
  const lockedStatus: BoiStatus | null =
    statusRaw && isBoiStatus(statusRaw) ? statusRaw : null;
  const initialProjectId =
    typeof params.project === 'string' && params.project.length > 0
      ? params.project
      : null;

  const [lines, totals, projects, categories] = await Promise.all([
    getBoiLines(),
    // KPI cards ignore the status filter (spec §5.2) — only project carries in
    // from the URL; the other filters start empty on a fresh load.
    getBoiStatusTotals({ projectId: initialProjectId ?? undefined }),
    getProjectOptions(),
    listItemCategories(),
  ]);

  return (
    <BoiWorkspace
      viewerRole={role}
      initialLines={lines}
      initialTotals={totals}
      initialProjects={projects}
      categories={categories.map((c) => ({ value: c.value, label: c.label }))}
      lockedStatus={lockedStatus}
      initialProjectId={initialProjectId}
    />
  );
}
