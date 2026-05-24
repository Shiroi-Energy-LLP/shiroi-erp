/**
 * win-loss-queries.ts — server-only read queries for lead_win_loss_patterns.
 *
 * Never call Supabase inline from a page or component (NEVER-DO #15).
 * All reads go through these functions.
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type WinLossPatternRow = Database['public']['Tables']['lead_win_loss_patterns']['Row'];

// ── getLatestWinLossReport ────────────────────────────────────────────────────

/**
 * Returns the most recent win/loss report for a given segment (or all if null).
 */
export async function getLatestWinLossReport(
  segment: string | null = null,
): Promise<WinLossPatternRow | null> {
  const op = '[getLatestWinLossReport]';
  const supabase = await createClient();

  const query = supabase
    .from('lead_win_loss_patterns')
    .select('*')
    .order('period_start', { ascending: false })
    .limit(1);

  if (segment) {
    query.eq('segment', segment);
  } else {
    query.is('segment', null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(`${op} failed`, { segment, error: error.message, timestamp: new Date().toISOString() });
    return null;
  }

  return data ?? null;
}

// ── listWinLossReports ────────────────────────────────────────────────────────

export interface ListWinLossReportsOptions {
  limit?: number;
  segment?: string | null;
}

/**
 * Returns the last N win/loss reports, newest first.
 * segment = null → only rows where segment IS NULL (all-segment reports)
 * segment = undefined → all segments (no filter)
 */
export async function listWinLossReports(
  opts: ListWinLossReportsOptions = {},
): Promise<WinLossPatternRow[]> {
  const op = '[listWinLossReports]';
  const supabase = await createClient();
  const limit = opts.limit ?? 12;

  const query = supabase
    .from('lead_win_loss_patterns')
    .select('*')
    .order('period_start', { ascending: false })
    .limit(limit);

  if (opts.segment !== undefined) {
    if (opts.segment === null) {
      query.is('segment', null);
    } else {
      query.eq('segment', opts.segment);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${op} failed`, { error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return data ?? [];
}

// ── getWinLossKpis ────────────────────────────────────────────────────────────

export interface WinLossKpis {
  winRatePct: number | null;        // Win rate % across last 4 weeks (all-segment rows only)
  totalValueWon: number;            // Sum of total_value_won across last 4 weeks
  totalValueLost: number;           // Sum of total_value_lost
  avgDealSize: number | null;       // Avg won deal value across last 4 weeks
  weeksWithData: number;
}

/**
 * Returns aggregated KPIs across the last 4 weeks of all-segment reports.
 * Monetary values come from NUMERIC(14,2) DB columns, summed with plain
 * addition here (not financial aggregation — these are already DB-computed
 * totals being displayed). Values are safe to add as they are already
 * pre-aggregated per-period in the DB.
 */
export async function getWinLossKpis(): Promise<WinLossKpis> {
  const op = '[getWinLossKpis]';
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('lead_win_loss_patterns')
    .select('total_leads_won, total_leads_lost, total_value_won, total_value_lost')
    .is('segment', null)
    .order('period_start', { ascending: false })
    .limit(4);

  if (error) {
    console.error(`${op} failed`, { error: error.message, timestamp: new Date().toISOString() });
    return { winRatePct: null, totalValueWon: 0, totalValueLost: 0, avgDealSize: null, weeksWithData: 0 };
  }

  if (!rows || rows.length === 0) {
    return { winRatePct: null, totalValueWon: 0, totalValueLost: 0, avgDealSize: null, weeksWithData: 0 };
  }

  let sumWon = 0;
  let sumLost = 0;
  let sumValueWon = 0;
  let sumValueLost = 0;

  for (const row of rows) {
    sumWon += row.total_leads_won;
    sumLost += row.total_leads_lost;
    sumValueWon += Number(row.total_value_won);
    sumValueLost += Number(row.total_value_lost);
  }

  const total = sumWon + sumLost;
  const winRatePct = total > 0 ? Math.round((sumWon / total) * 100) : null;
  const avgDealSize = sumWon > 0 ? Math.round(sumValueWon / sumWon) : null;

  return {
    winRatePct,
    totalValueWon: sumValueWon,
    totalValueLost: sumValueLost,
    avgDealSize,
    weeksWithData: rows.length,
  };
}
