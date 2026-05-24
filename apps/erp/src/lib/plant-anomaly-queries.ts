'use server';

/**
 * S15 — B3 Plant anomaly log queries (server-only).
 *
 * All Supabase calls live here. Pages and components import these functions,
 * never call Supabase directly (NEVER-DO #15).
 *
 * KPI strip uses the inverter_readings_daily rollup — never raw inverter_readings
 * (NEVER-DO #16).
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import Decimal from 'decimal.js';

// ── Shared types ───────────────────────────────────────────────────────────────

export type AnomalyRow =
  Database['public']['Tables']['plant_anomaly_log']['Row'];

// ── Anomaly queries ────────────────────────────────────────────────────────────

/**
 * Returns active (unresolved) anomalies for a project, newest first.
 * Role check is enforced by RLS; this function uses the caller's session.
 */
export async function getActiveAnomaliesForProject(
  projectId: string,
): Promise<AnomalyRow[]> {
  const op = '[getActiveAnomaliesForProject]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plant_anomaly_log')
    .select('*')
    .eq('project_id', projectId)
    .is('resolved_at', null)
    .order('detected_for_date', { ascending: false });

  if (error) {
    console.error(`${op} query failed`, {
      error: error.message,
      code: error.code,
      projectId,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  return data ?? [];
}

/**
 * Returns resolved anomalies for a project within the last `sinceDays` days
 * (default 30), newest first.
 */
export async function getResolvedAnomaliesForProject(
  projectId: string,
  sinceDays: number = 30,
): Promise<AnomalyRow[]> {
  const op = '[getResolvedAnomaliesForProject]';
  const supabase = await createClient();

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from('plant_anomaly_log')
    .select('*')
    .eq('project_id', projectId)
    .not('resolved_at', 'is', null)
    .gte('detected_for_date', since)
    .order('detected_for_date', { ascending: false });

  if (error) {
    console.error(`${op} query failed`, {
      error: error.message,
      code: error.code,
      projectId,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  return data ?? [];
}

// ── KPI strip ──────────────────────────────────────────────────────────────────

export interface PlantPerformanceKpis {
  /** Total actual generation in the last 7 days (kWh). */
  actual_kwh_7d: number;
  /** Total expected generation in the last 7 days (kWh). null if PVLib data missing. */
  expected_kwh_7d: number | null;
  /** Overall deviation (%) vs expected over 7 days. null if expected is null. */
  deviation_pct_7d: number | null;
  /** Last 30 days of daily totals for a trend sparkline. */
  daily_trend_30d: Array<{ day: string; kwh: number }>;
}

/**
 * Returns 7-day KPIs and 30-day daily trend for a project.
 *
 * kWh aggregation is done in SQL via the inverter_readings_daily rollup
 * (NEVER-DO #16). The JS layer only sums the small per-inverter rows that
 * come back for each day.
 */
export async function getProjectPerformanceKpis(
  projectId: string,
): Promise<PlantPerformanceKpis> {
  const op = '[getProjectPerformanceKpis]';
  const supabase = await createClient();

  const todayUtc = new Date().toISOString().slice(0, 10);
  const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const from30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // ── Get inverter IDs for this project ────────────────────────────────────────
  const { data: inverters, error: invErr } = await supabase
    .from('inverters')
    .select('id')
    .eq('project_id', projectId)
    .neq('current_status', 'decommissioned');

  if (invErr) {
    console.error(`${op} inverter fetch failed`, {
      error: invErr.message,
      projectId,
      timestamp: new Date().toISOString(),
    });
    return { actual_kwh_7d: 0, expected_kwh_7d: null, deviation_pct_7d: null, daily_trend_30d: [] };
  }

  if (!inverters || inverters.length === 0) {
    return { actual_kwh_7d: 0, expected_kwh_7d: null, deviation_pct_7d: null, daily_trend_30d: [] };
  }

  const inverterIds = inverters.map((i) => i.id);

  // ── Pull 30 days of daily rollup rows (covers both KPI windows) ───────────
  const { data: rows, error: rowErr } = await supabase
    .from('inverter_readings_daily')
    .select('day, energy_generated_kwh, expected_kwh')
    .in('inverter_id', inverterIds)
    .gte('day', from30d)
    .lte('day', todayUtc);

  if (rowErr) {
    console.error(`${op} daily rollup fetch failed`, {
      error: rowErr.message,
      projectId,
      timestamp: new Date().toISOString(),
    });
    return { actual_kwh_7d: 0, expected_kwh_7d: null, deviation_pct_7d: null, daily_trend_30d: [] };
  }

  if (!rows || rows.length === 0) {
    return { actual_kwh_7d: 0, expected_kwh_7d: null, deviation_pct_7d: null, daily_trend_30d: [] };
  }

  // ── Aggregate per day (sum across inverters) ─────────────────────────────
  // kWh is physics not money, but we use Decimal for consistency.
  const byDay = new Map<string, { actual: Decimal; expected: Decimal; hasExpected: boolean }>();
  for (const row of rows) {
    const prev = byDay.get(row.day) ?? {
      actual: new Decimal(0),
      expected: new Decimal(0),
      hasExpected: false,
    };
    byDay.set(row.day, {
      actual: prev.actual.plus(row.energy_generated_kwh ?? 0),
      expected: prev.expected.plus(row.expected_kwh ?? 0),
      hasExpected: prev.hasExpected || row.expected_kwh !== null,
    });
  }

  // ── 30-day daily trend (sorted ascending) ────────────────────────────────
  const daily_trend_30d: Array<{ day: string; kwh: number }> = [];
  for (const [day, agg] of byDay.entries()) {
    daily_trend_30d.push({
      day,
      kwh: agg.actual.toDecimalPlaces(2).toNumber(),
    });
  }
  daily_trend_30d.sort((a, b) => a.day.localeCompare(b.day));

  // ── 7-day KPIs ────────────────────────────────────────────────────────────
  let actual7d = new Decimal(0);
  let expected7d = new Decimal(0);
  let hasExpected7d = false;

  for (const [day, agg] of byDay.entries()) {
    if (day >= from7d && day <= todayUtc) {
      actual7d = actual7d.plus(agg.actual);
      expected7d = expected7d.plus(agg.expected);
      if (agg.hasExpected) hasExpected7d = true;
    }
  }

  const actual_kwh_7d = actual7d.toDecimalPlaces(2).toNumber();
  const expected_kwh_7d = hasExpected7d
    ? expected7d.toDecimalPlaces(2).toNumber()
    : null;

  let deviation_pct_7d: number | null = null;
  if (expected_kwh_7d !== null && expected_kwh_7d > 0) {
    deviation_pct_7d = actual7d
      .minus(expected7d)
      .dividedBy(expected7d)
      .times(100)
      .toDecimalPlaces(1)
      .toNumber();
  }

  return {
    actual_kwh_7d,
    expected_kwh_7d,
    deviation_pct_7d,
    daily_trend_30d,
  };
}
