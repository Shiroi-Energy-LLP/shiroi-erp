import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import {
  getZohoSyncState,
  getRecentZohoSyncRuns,
  getVoucherPushHealth,
  type ZohoSyncQueueStatus,
} from '@/lib/zoho-sync-queries';
import {
  Badge,
  Breadcrumb,
  Eyebrow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toIST,
} from '@repo/ui';
import type { BadgeProps } from '@repo/ui';
import { SyncNowButtons } from './_components/sync-now-buttons';

export const metadata = { title: 'Zoho Sync' };
export const dynamic = 'force-dynamic';

// Founder + finance only — mirrors the RLS SELECT policy on
// zoho_sync_state / zoho_sync_runs (mig 203).
const ALLOWED = new Set(['founder', 'finance']);

/** Human labels for the 12 zoho_sync_state entities (Zoho module keys). */
const ENTITY_LABELS: Record<string, string> = {
  chartofaccounts: 'Chart of Accounts',
  taxes: 'Taxes',
  items: 'Items',
  contacts: 'Contacts (customers)',
  vendors: 'Vendors',
  purchaseorders: 'Purchase Orders',
  invoices: 'Invoices',
  customerpayments: 'Customer Payments',
  bills: 'Vendor Bills',
  vendorpayments: 'Vendor Payments',
  expenses: 'Expenses',
  creditnotes: 'Credit Notes',
};

const RUN_STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  ok: 'success',
  partial: 'warning',
  error: 'error',
};

const QUEUE_STATUS_VARIANTS: Record<ZohoSyncQueueStatus, BadgeProps['variant']> = {
  pending: 'pending',
  syncing: 'info',
  synced: 'success',
  failed: 'error',
  skipped: 'neutral',
};

const QUEUE_STATUS_ORDER: ZohoSyncQueueStatus[] = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'skipped',
];

function istOrDash(ts: string | null): string {
  return ts ? toIST(ts) : '—';
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-n-400">—</span>;
  return <Badge variant={RUN_STATUS_VARIANTS[status] ?? 'neutral'}>{status.toUpperCase()}</Badge>;
}

function TruncatedError({ error }: { error: string | null }) {
  if (!error) return <span className="text-n-400">—</span>;
  return (
    <span className="block max-w-[280px] truncate text-xs text-n-600" title={error}>
      {error}
    </span>
  );
}

export default async function ZohoSyncSettingsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (!ALLOWED.has(profile.role)) redirect('/settings');

  const [syncState, recentRuns, voucherHealth] = await Promise.all([
    getZohoSyncState(),
    getRecentZohoSyncRuns(),
    getVoucherPushHealth(),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[{ label: 'Settings', href: '/settings' }, { label: 'Zoho Sync' }]}
      />

      {/* Header + manual trigger */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="mb-1">SETTINGS</Eyebrow>
          <h1 className="text-2xl font-bold text-n-950">Zoho Books Sync</h1>
          <p className="text-sm text-n-500">
            Inbound pull runs every 15 minutes; approved vouchers push back to Zoho. Times shown
            in IST.
          </p>
        </div>
        <SyncNowButtons />
      </div>

      {/* Per-entity sync state */}
      <section className="rounded-md border border-n-200 bg-white">
        <div className="border-b border-n-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-n-900">Entity sync state</h2>
          <p className="text-xs text-n-500">
            Incremental watermark per Zoho module. An empty watermark means the module has never
            completed a pull (full scan in progress or not yet run).
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>Watermark</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows synced</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {syncState.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-n-500">
                    No sync state yet — run migration 203 and trigger a sync.
                  </TableCell>
                </TableRow>
              )}
              {syncState.map((row) => (
                <TableRow key={row.entity}>
                  <TableCell className="font-medium text-n-900">
                    {ENTITY_LABELS[row.entity] ?? row.entity}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-n-700">
                    {istOrDash(row.watermark)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-n-700">
                    {istOrDash(row.last_run_at)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.last_run_status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-n-700">
                    {row.total_rows_synced.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell>
                    <TruncatedError error={row.last_error} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Voucher push health */}
      <section className="rounded-md border border-n-200 bg-white">
        <div className="border-b border-n-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-n-900">Voucher push health</h2>
          <p className="text-xs text-n-500">
            Outbound queue (approved site-expense vouchers → Zoho). Rows fail permanently after 5
            attempts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {QUEUE_STATUS_ORDER.map((status) => (
            <span
              key={status}
              className="inline-flex items-center gap-2 rounded-full border border-n-200 bg-n-50 px-3 py-1"
            >
              <Badge variant={QUEUE_STATUS_VARIANTS[status]}>{status.toUpperCase()}</Badge>
              <span className="text-sm font-semibold tabular-nums text-n-900">
                {voucherHealth.counts[status].toLocaleString('en-IN')}
              </span>
            </span>
          ))}
        </div>
        {voucherHealth.failedRows.length > 0 && (
          <div className="overflow-x-auto border-t border-n-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue ID</TableHead>
                  <TableHead>Voucher (expense) ID</TableHead>
                  <TableHead className="text-right">Retries</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead>Last attempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voucherHealth.failedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-n-600" title={row.id}>
                      {row.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-n-600" title={row.entity_id}>
                      {row.entity_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-n-700">
                      {row.retry_count}
                    </TableCell>
                    <TableCell>
                      <TruncatedError error={row.last_error} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-n-700">
                      {istOrDash(row.last_attempt_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Recent runs */}
      <section className="rounded-md border border-n-200 bg-white">
        <div className="border-b border-n-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-n-900">Recent runs</h2>
          <p className="text-xs text-n-500">Last 20 sync runs, newest first.</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fetched</TableHead>
                <TableHead className="text-right">Upserted</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-n-500">
                    No runs yet.
                  </TableCell>
                </TableRow>
              )}
              {recentRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap text-n-700">
                    {toIST(run.started_at)}
                  </TableCell>
                  <TableCell className="uppercase text-xs font-semibold text-n-600">
                    {run.mode}
                  </TableCell>
                  <TableCell className="text-n-700">
                    {run.entity ? (ENTITY_LABELS[run.entity] ?? run.entity) : 'Vouchers'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-n-700">
                    {run.rows_fetched.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-n-700">
                    {run.rows_upserted.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-n-700">
                    {formatDuration(run.started_at, run.finished_at)}
                  </TableCell>
                  <TableCell>
                    <TruncatedError error={run.error} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
