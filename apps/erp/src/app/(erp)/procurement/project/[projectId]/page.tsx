/**
 * Procurement — Project workspace (5-tab shell)
 *
 * URL-driven tabs via `?tab=boq|rfq|comparison|po|dispatch` (default `boq`).
 *
 * Architecture:
 *   - Server component (this file) fetches every tab's data in parallel via
 *     Promise.all and passes it down.
 *   - @repo/ui Tabs is a client component; the shell uses plain <Link>-based
 *     navigation so only the active tab's heavy children are server-rendered.
 *   - Tab content lives in `_tabs/*.tsx`; client interactivity lives in `_client/*.tsx`.
 */

import Link from 'next/link';
import { Card, CardContent, Badge, Button } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { ArrowLeft, ShoppingCart, Check, Lock } from 'lucide-react';

import { getPurchaseDetail } from '@/lib/procurement-queries';
import { listRfqsForProject, getRfqComparisonData, getPendingApprovalPOs } from '@/lib/rfq-queries';
import { getUserProfile } from '@/lib/auth';
import { PriorityToggle } from '@/components/procurement/purchase-detail-controls';

import { TabBoq } from './_tabs/tab-boq';
import { TabRfq } from './_tabs/tab-rfq';
import { TabComparison } from './_tabs/tab-comparison';
import { TabPo } from './_tabs/tab-po';
import { TabDispatch } from './_tabs/tab-dispatch';

type TabKey = 'boq' | 'rfq' | 'comparison' | 'po' | 'dispatch';

const VALID_TABS: readonly TabKey[] = ['boq', 'rfq', 'comparison', 'po', 'dispatch'] as const;

function parseTab(raw: string | string[] | undefined): TabKey {
  if (typeof raw !== 'string') return 'boq';
  return (VALID_TABS as readonly string[]).includes(raw) ? (raw as TabKey) : 'boq';
}

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function ProcurementProjectPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab = parseTab(tabParam);

  // Fetch all tab data + profile in parallel. Each query degrades gracefully
  // (returns null / empty list on failure) so one bad query doesn't blank the page.
  let detail: Awaited<ReturnType<typeof getPurchaseDetail>>;
  try {
    [detail] = await Promise.all([getPurchaseDetail(projectId)]);
  } catch (e) {
    console.error('[ProcurementProjectPage] getPurchaseDetail failed', {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <ShoppingCart className="w-10 h-10 text-red-400 mb-3" />
        <h3 className="text-sm font-bold text-n-700">Failed to Load</h3>
        <p className="text-xs text-n-500">Could not load purchase data for this project.</p>
      </div>
    );
  }

  const { project, items, purchaseOrders, vendors } = detail;

  const [rfqs, comparison, pendingApprovals, profile] = await Promise.all([
    listRfqsForProject(projectId),
    getRfqComparisonData(projectId),
    getPendingApprovalPOs(),
    getUserProfile(),
  ]);

  const viewerRole = profile?.role ?? 'project_manager';
  const viewerId = profile?.id ?? null;

  // ── Tab completion state (drives ✓ / 🔒 badges on tab headers) ─────────────
  const totalWithTax = items.reduce((sum, i) => sum + Number(i.total_price || 0), 0);
  const yetToPlace = items.filter((i) => i.procurement_status === 'yet_to_place').length;
  const ordered = items.filter((i) => i.procurement_status === 'order_placed').length;
  const received = items.filter(
    (i) => i.procurement_status === 'received' ||
           i.procurement_status === 'ready_to_dispatch' ||
           i.procurement_status === 'delivered',
  ).length;

  const tabState = {
    boq: {
      count: items.length,
      complete: items.length > 0,
      locked: false,
    },
    rfq: {
      count: rfqs.length,
      complete: rfqs.some((r) => r.status === 'sent' || r.status === 'comparing' || r.status === 'awarded'),
      locked: items.length === 0,
    },
    comparison: {
      count: comparison?.items.length ?? 0,
      complete: Boolean(comparison && comparison.awards.length > 0),
      locked: !comparison,
    },
    po: {
      count: purchaseOrders.length,
      complete: purchaseOrders.length > 0,
      locked: false,
    },
    dispatch: {
      count: purchaseOrders.filter((po) =>
        po.status === 'sent_to_vendor' || po.status === 'acknowledged' || po.dispatched_at,
      ).length,
      complete: purchaseOrders.length > 0 && purchaseOrders.every((po) => po.actual_delivery_date),
      locked: purchaseOrders.length === 0,
    },
  };

  const tabsConfig: Array<{
    key: TabKey;
    label: string;
    count: number;
    complete: boolean;
    locked: boolean;
  }> = [
    { key: 'boq', label: '1. BOQ', ...tabState.boq },
    { key: 'rfq', label: '2. RFQ', ...tabState.rfq },
    { key: 'comparison', label: '3. Compare', ...tabState.comparison },
    { key: 'po', label: '4. POs', ...tabState.po },
    { key: 'dispatch', label: '5. Dispatch', ...tabState.dispatch },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/procurement">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-heading font-bold text-n-900">
              {project.project_number} — Purchase Workspace
            </h1>
            <p className="text-xs text-n-500">{project.customer_name}</p>
          </div>
        </div>
        <PriorityToggle
          projectId={projectId}
          currentPriority={project.procurement_priority ?? 'medium'}
        />
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-n-900">{items.length}</div>
            <div className="text-[10px] text-n-500 uppercase font-medium">Total Items</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-amber-700">{yetToPlace}</div>
            <div className="text-[10px] text-amber-600 uppercase font-medium">Yet to Place</div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-blue-700">{ordered}</div>
            <div className="text-[10px] text-blue-600 uppercase font-medium">Ordered</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold text-green-700">{received}</div>
            <div className="text-[10px] text-green-600 uppercase font-medium">Received</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <div className="text-lg font-bold font-mono text-n-900">{formatINR(totalWithTax)}</div>
            <div className="text-[10px] text-n-500 uppercase font-medium">Total (incl. GST)</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tab navigation (URL-driven via Link) ────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-n-200">
        {tabsConfig.map((t) => {
          const isActive = t.key === activeTab;
          const baseClasses =
            'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors';
          const activeClasses = 'border-p-600 text-p-700';
          const inactiveClasses = t.locked
            ? 'border-transparent text-n-400 cursor-not-allowed'
            : 'border-transparent text-n-600 hover:text-n-900 hover:border-n-300';

          const inner = (
            <>
              <span>{t.label}</span>
              {t.count > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {t.count}
                </Badge>
              )}
              {t.complete && <Check className="h-3.5 w-3.5 text-green-600" />}
              {t.locked && <Lock className="h-3 w-3 text-n-400" />}
            </>
          );

          if (t.locked && !isActive) {
            return (
              <span
                key={t.key}
                className={`${baseClasses} ${inactiveClasses}`}
                aria-disabled="true"
                title="Complete the previous step first"
              >
                {inner}
              </span>
            );
          }

          return (
            <Link
              key={t.key}
              href={`/procurement/project/${projectId}?tab=${t.key}`}
              className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
              scroll={false}
            >
              {inner}
            </Link>
          );
        })}
      </div>

      {/* ── Active tab content (server-rendered) ────────────────────────── */}
      <div>
        {activeTab === 'boq' && (
          <TabBoq
            projectId={projectId}
            items={items}
            vendors={vendors}
            viewerRole={viewerRole}
          />
        )}
        {activeTab === 'rfq' && (
          <TabRfq
            projectId={projectId}
            items={items}
            rfqs={rfqs}
            vendors={vendors}
            viewerRole={viewerRole}
          />
        )}
        {activeTab === 'comparison' && (
          <TabComparison
            projectId={projectId}
            comparison={comparison}
            viewerRole={viewerRole}
          />
        )}
        {activeTab === 'po' && (
          <TabPo
            projectId={projectId}
            purchaseOrders={purchaseOrders}
            pendingApprovals={pendingApprovals}
            viewerRole={viewerRole}
            viewerId={viewerId}
          />
        )}
        {activeTab === 'dispatch' && (
          <TabDispatch
            projectId={projectId}
            purchaseOrders={purchaseOrders}
            viewerRole={viewerRole}
          />
        )}
      </div>
    </div>
  );
}
