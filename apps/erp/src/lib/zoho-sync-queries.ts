// apps/erp/src/lib/zoho-sync-queries.ts
//
// Server-only reads for the Zoho sync admin UI (/settings/zoho-sync).
// See docs/superpowers/specs/2026-07-16-zoho-live-api-sync-design.md §7.
//
// RLS on zoho_sync_state / zoho_sync_runs allows SELECT for founder/finance
// only (mig 204); the page additionally role-gates server-side before calling.

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type ZohoSyncStateRow = Database['public']['Tables']['zoho_sync_state']['Row'];
export type ZohoSyncRunRow = Database['public']['Tables']['zoho_sync_runs']['Row'];
type ZohoSyncQueueRow = Database['public']['Tables']['zoho_sync_queue']['Row'];
export type ZohoSyncQueueStatus = Database['public']['Enums']['zoho_sync_status'];

export type FailedVoucherQueueRow = Pick<
  ZohoSyncQueueRow,
  'id' | 'entity_id' | 'retry_count' | 'last_error' | 'last_attempt_at'
>;

export interface VoucherPushHealth {
  /** Queue-row counts per status, scoped to entity_type='expense'. */
  counts: Record<ZohoSyncQueueStatus, number>;
  /** Last 10 failed voucher queue rows, most recent attempt first. */
  failedRows: FailedVoucherQueueRow[];
}

const QUEUE_STATUSES: ZohoSyncQueueStatus[] = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'skipped',
];

/** All 12 zoho_sync_state rows (one per Zoho module), ordered by entity. */
export async function getZohoSyncState(): Promise<ZohoSyncStateRow[]> {
  const op = '[getZohoSyncState]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('zoho_sync_state')
    .select('*')
    .order('entity', { ascending: true });
  if (error) {
    console.error(`${op} query failed`, { error, timestamp: new Date().toISOString() });
    throw new Error(`Failed to load Zoho sync state: ${error.message}`);
  }
  if (!data) {
    console.error(`${op} null data with no error`, { timestamp: new Date().toISOString() });
    return [];
  }
  return data;
}

/**
 * Latest sync runs, newest first. This is a capped recency view (default 20)
 * — deliberately not a paginated browse of the full run log, so .range() with
 * a hard cap is the whole contract.
 */
export async function getRecentZohoSyncRuns(limit = 20): Promise<ZohoSyncRunRow[]> {
  const op = '[getRecentZohoSyncRuns]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('zoho_sync_runs')
    .select('*', { count: 'estimated' })
    .order('started_at', { ascending: false })
    .range(0, limit - 1);
  if (error) {
    console.error(`${op} query failed`, { limit, error, timestamp: new Date().toISOString() });
    throw new Error(`Failed to load Zoho sync runs: ${error.message}`);
  }
  if (!data) {
    console.error(`${op} null data with no error`, { limit, timestamp: new Date().toISOString() });
    return [];
  }
  return data;
}

/**
 * Voucher-push queue health: per-status counts (entity_type='expense') plus
 * the last 10 failed rows. Counts are head-only estimated-count queries — the
 * aggregation happens in Postgres; no rows are fetched and reduced in JS.
 */
export async function getVoucherPushHealth(): Promise<VoucherPushHealth> {
  const op = '[getVoucherPushHealth]';
  const supabase = await createClient();

  const countEntries = await Promise.all(
    QUEUE_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from('zoho_sync_queue')
        .select('id', { count: 'estimated', head: true })
        .eq('entity_type', 'expense')
        .eq('status', status);
      if (error) {
        console.error(`${op} count query failed`, {
          status,
          error,
          timestamp: new Date().toISOString(),
        });
        throw new Error(`Failed to count voucher queue (${status}): ${error.message}`);
      }
      return [status, count ?? 0] as const;
    }),
  );
  const counts = Object.fromEntries(countEntries) as Record<ZohoSyncQueueStatus, number>;

  const { data: failedRows, error: failedErr } = await supabase
    .from('zoho_sync_queue')
    .select('id, entity_id, retry_count, last_error, last_attempt_at')
    .eq('entity_type', 'expense')
    .eq('status', 'failed')
    .order('last_attempt_at', { ascending: false, nullsFirst: false })
    .range(0, 9);
  if (failedErr) {
    console.error(`${op} failed-rows query failed`, {
      error: failedErr,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load failed voucher rows: ${failedErr.message}`);
  }

  return { counts, failedRows: failedRows ?? [] };
}
