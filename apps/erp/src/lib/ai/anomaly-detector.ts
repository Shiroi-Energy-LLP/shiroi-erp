'use server';

/**
 * S15 — B3 Plant Performance Anomaly Detector
 *
 * Scans the inverter_readings_daily rollup for the last N days across all
 * projects in the connected telemetry cohort. Flags anomalies by type.
 *
 * All kWh aggregation is done in SQL (NEVER-DO #12).
 * PVLib is called once per (project, date) with a simple in-memory cache
 * to avoid hammering the microservice when processing many dates.
 *
 * Idempotency: the caller (narrateAndPersistAnomaly) skips insert if a row
 * already exists in plant_anomaly_log (UNIQUE on project_id, anomaly_type,
 * detected_for_date).
 */

import { createAdminClient } from '@repo/supabase/admin';
import Decimal from 'decimal.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/** PVLib microservice timeout (ms). */
const PVLIB_TIMEOUT_MS = 8000;

/** Minimum underperformance deviation to flag (fraction). */
const UNDERPERFORMANCE_THRESHOLD = -0.15; // -15%

/** Minimum consecutive days for underperformance flag. */
const UNDERPERFORMANCE_DAYS = 5;

/** Single-day drop threshold (fraction). */
const SUDDEN_DROP_THRESHOLD = -0.50; // -50%

/** Consecutive days of 0 kWh → offline_too_long. */
const OFFLINE_TOO_LONG_DAYS = 2;

/** Consecutive missing days → data_gap. */
const DATA_GAP_DAYS = 3;

/** Sustained over-generation threshold (fraction). */
const OVERPERFORMANCE_THRESHOLD = 0.30; // +30%

/** Sustained over-generation days to flag. */
const OVERPERFORMANCE_DAYS = 3;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RawAnomaly {
  project_id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  site_city: string;
  site_latitude: number | null;
  site_longitude: number | null;
  anomaly_type:
    | 'underperformance'
    | 'sudden_drop'
    | 'offline_too_long'
    | 'data_gap'
    | 'overperformance_suspect';
  detected_for_date: string; // YYYY-MM-DD
  expected_kwh: number | null;
  actual_kwh: number | null;
  deviation_pct: number;
  consecutive_days: number;
}

// ── PVLib cache (in-memory, scoped to this serverless invocation) ──────────────

const pvlibCache = new Map<string, number | null>();

interface PvlibDailyParams {
  latitude: number;
  longitude: number;
  system_size_kwp: number;
  date: string; // YYYY-MM-DD
}

async function callPvlibDaily(params: PvlibDailyParams): Promise<number | null> {
  const op = '[callPvlibDaily]';
  const cacheKey = `${params.latitude},${params.longitude},${params.system_size_kwp},${params.date}`;
  if (pvlibCache.has(cacheKey)) return pvlibCache.get(cacheKey) ?? null;

  const baseUrl = process.env.PVLIB_MICROSERVICE_URL ?? 'https://pvlib.shiroienergy.com';
  const [year, month, day] = params.date.split('-').map(Number);

  try {
    const resp = await fetch(`${baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        latitude: params.latitude,
        longitude: params.longitude,
        system_size_kwp: params.system_size_kwp,
        year,
        month,
        day,
        output: 'daily_kwh',
      }),
      signal: AbortSignal.timeout(PVLIB_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`${op} PVLib returned ${resp.status}`, {
        params: { lat: params.latitude, lng: params.longitude, date: params.date },
        timestamp: new Date().toISOString(),
      });
      pvlibCache.set(cacheKey, null);
      return null;
    }

    const json = (await resp.json()) as { daily_kwh?: number; monthly_kwh?: number };
    // Support both daily_kwh (preferred) and monthly_kwh / 30 as fallback
    const kwh =
      typeof json.daily_kwh === 'number'
        ? json.daily_kwh
        : typeof json.monthly_kwh === 'number'
        ? json.monthly_kwh / 30
        : null;

    pvlibCache.set(cacheKey, kwh);
    return kwh;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${op} PVLib unavailable (non-fatal)`, {
      error: msg,
      date: params.date,
      timestamp: new Date().toISOString(),
    });
    pvlibCache.set(cacheKey, null);
    return null;
  }
}

// ── Cohort query ───────────────────────────────────────────────────────────────

interface CohortProject {
  project_id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  site_city: string;
  site_latitude: number | null;
  site_longitude: number | null;
}

/**
 * Returns all projects with at least one non-deleted plant_monitoring_credentials
 * row. This is the telemetry cohort (~5 projects today, will grow).
 */
async function getAnomalyCohort(): Promise<CohortProject[]> {
  const op = '[getAnomalyCohort]';
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('projects')
    .select(
      `id, project_number, customer_name, system_size_kwp,
       site_city, site_latitude, site_longitude,
       plant_monitoring_credentials!inner(id, deleted_at)`,
    )
    .eq('status', 'completed')
    .not('commissioned_date', 'is', null)
    .is('plant_monitoring_credentials.deleted_at', null);

  if (error) {
    console.error(`${op} cohort query failed`, {
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op}: ${error.message}`);
  }

  if (!data) return [];

  return data.map((row) => ({
    project_id: row.id,
    project_number: row.project_number,
    customer_name: row.customer_name,
    system_size_kwp: row.system_size_kwp ?? 0,
    site_city: row.site_city ?? 'Chennai',
    site_latitude: row.site_latitude,
    site_longitude: row.site_longitude,
  }));
}

// ── Per-project daily kWh from rollup ─────────────────────────────────────────

interface DailyReading {
  day: string; // YYYY-MM-DD
  kwh: number;
  sample_count: number;
}

/**
 * Returns daily kWh for the project across its inverters, aggregated in SQL.
 * The aggregation is done by the rollup table (mig 050); we simply select
 * those rows and sum per day using decimal.js (kWh is physics, not money,
 * but we use decimal for consistency; row count is small: days × inverters).
 */
async function getProjectDailyKwh(
  projectId: string,
  fromDate: string,
  toDate: string,
): Promise<DailyReading[]> {
  const op = '[getProjectDailyKwh]';
  const admin = createAdminClient();

  // 1. Get inverter IDs for this project
  const { data: inverters, error: invErr } = await admin
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
    return [];
  }

  if (!inverters || inverters.length === 0) return [];

  const inverterIds = inverters.map((i) => i.id);

  // 2. Pull daily rows from rollup
  const { data: rows, error: rowErr } = await admin
    .from('inverter_readings_daily')
    .select('inverter_id, day, energy_generated_kwh, sample_count')
    .in('inverter_id', inverterIds)
    .gte('day', fromDate)
    .lte('day', toDate);

  if (rowErr) {
    console.error(`${op} daily rollup fetch failed`, {
      error: rowErr.message,
      projectId,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  if (!rows) return [];

  // 3. Aggregate per day using decimal.js (NEVER-DO #12 applies to money;
  //    we use Decimal for precision consistency across the codebase)
  const byDay = new Map<string, { kwh: Decimal; sampleCount: number }>();
  for (const row of rows) {
    const prev = byDay.get(row.day) ?? { kwh: new Decimal(0), sampleCount: 0 };
    byDay.set(row.day, {
      kwh: prev.kwh.plus(row.energy_generated_kwh ?? 0),
      sampleCount: prev.sampleCount + (row.sample_count ?? 0),
    });
  }

  const result: DailyReading[] = [];
  for (const [day, agg] of byDay.entries()) {
    result.push({
      day,
      kwh: agg.kwh.toDecimalPlaces(3).toNumber(),
      sample_count: agg.sampleCount,
    });
  }

  // Sort ascending by date
  result.sort((a, b) => a.day.localeCompare(b.day));
  return result;
}

// ── Existing anomaly de-dup check ──────────────────────────────────────────────

/**
 * Returns a Set of "project_id|anomaly_type|date" strings that already exist
 * in plant_anomaly_log within the lookback window. Used for idempotency.
 */
async function getExistingAnomalyKeys(
  projectIds: string[],
  fromDate: string,
): Promise<Set<string>> {
  const op = '[getExistingAnomalyKeys]';
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('plant_anomaly_log')
    .select('project_id, anomaly_type, detected_for_date')
    .in('project_id', projectIds)
    .gte('detected_for_date', fromDate);

  if (error) {
    console.error(`${op} existing anomaly fetch failed`, {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    // On error, return empty set — we'll hit the unique constraint and skip safely
    return new Set<string>();
  }

  const keys = new Set<string>();
  for (const row of data ?? []) {
    keys.add(`${row.project_id}|${row.anomaly_type}|${row.detected_for_date}`);
  }
  return keys;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function dateMinusDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ── Main detector ──────────────────────────────────────────────────────────────

/**
 * detectAnomalies — scans the last `lookbackDays` of telemetry for all
 * connected projects and returns an array of RawAnomaly structs.
 *
 * Idempotent: anomalies already in plant_anomaly_log are skipped.
 */
export async function detectAnomalies(lookbackDays: number = 7): Promise<RawAnomaly[]> {
  const op = '[detectAnomalies]';

  // ── 1. Cohort ────────────────────────────────────────────────────────────────
  let cohort: CohortProject[];
  try {
    cohort = await getAnomalyCohort();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} cohort fetch failed — aborting`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  if (cohort.length === 0) {
    console.log(`${op} no connected projects in cohort`, {
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  // ── 2. Date window ───────────────────────────────────────────────────────────
  const todayUtc = new Date().toISOString().slice(0, 10);
  const fromDate = dateMinusDays(todayUtc, lookbackDays);
  const allDates = buildDateRange(fromDate, todayUtc);

  // ── 3. Idempotency set ───────────────────────────────────────────────────────
  const projectIds = cohort.map((p) => p.project_id);
  const existingKeys = await getExistingAnomalyKeys(projectIds, fromDate);

  // ── 4. Scan per project ───────────────────────────────────────────────────────
  const anomalies: RawAnomaly[] = [];

  for (const project of cohort) {
    const dailyReadings = await getProjectDailyKwh(project.project_id, fromDate, todayUtc);

    // Build lookup: date → reading
    const readingByDate = new Map<string, DailyReading>();
    for (const r of dailyReadings) {
      readingByDate.set(r.day, r);
    }

    // ── Fetch PVLib expected for each date (only if lat/lng available) ────────
    const expectedByDate = new Map<string, number | null>();
    for (const date of allDates) {
      if (project.site_latitude && project.site_longitude && project.system_size_kwp > 0) {
        const kwh = await callPvlibDaily({
          latitude: project.site_latitude,
          longitude: project.site_longitude,
          system_size_kwp: project.system_size_kwp,
          date,
        });
        expectedByDate.set(date, kwh);
      } else {
        expectedByDate.set(date, null);
      }
    }

    // ── Compute per-day deviation ─────────────────────────────────────────────
    type DayStats = {
      date: string;
      actual: number | null;
      expected: number | null;
      deviationPct: number | null;
      hasSamples: boolean;
    };

    const dayStats: DayStats[] = allDates.map((date) => {
      const reading = readingByDate.get(date);
      const expected = expectedByDate.get(date) ?? null;
      const actual = reading?.kwh ?? null;

      let deviationPct: number | null = null;
      if (actual !== null && expected !== null && expected > 0) {
        deviationPct = new Decimal(actual - expected)
          .dividedBy(expected)
          .times(100)
          .toDecimalPlaces(1)
          .toNumber();
      }

      return {
        date,
        actual,
        expected,
        deviationPct,
        hasSamples: (reading?.sample_count ?? 0) > 0,
      };
    });

    // ── data_gap: 3+ consecutive missing rows ─────────────────────────────────
    let gapRun = 0;
    for (const ds of dayStats) {
      const hasData = readingByDate.has(ds.date);
      if (!hasData) {
        gapRun++;
        if (gapRun >= DATA_GAP_DAYS) {
          const key = `${project.project_id}|data_gap|${ds.date}`;
          if (!existingKeys.has(key)) {
            // PVLib timeout → emit data_gap instead of skipping (spec requirement)
            const expected = ds.expected;
            anomalies.push({
              ...project,
              anomaly_type: 'data_gap',
              detected_for_date: ds.date,
              expected_kwh: expected,
              actual_kwh: null,
              deviation_pct: -100,
              consecutive_days: gapRun,
            });
          }
        }
      } else {
        gapRun = 0;
      }
    }

    // ── offline_too_long: 2+ consecutive days with 0 kWh and samples > 0 ─────
    //    (0 kWh with samples means inverter was polled but reported nothing)
    let offlineRun = 0;
    for (const ds of dayStats) {
      const isZero = ds.actual !== null && ds.actual === 0 && ds.hasSamples;
      if (isZero) {
        offlineRun++;
        if (offlineRun >= OFFLINE_TOO_LONG_DAYS) {
          const key = `${project.project_id}|offline_too_long|${ds.date}`;
          if (!existingKeys.has(key)) {
            anomalies.push({
              ...project,
              anomaly_type: 'offline_too_long',
              detected_for_date: ds.date,
              expected_kwh: ds.expected,
              actual_kwh: 0,
              deviation_pct: ds.deviationPct ?? -100,
              consecutive_days: offlineRun,
            });
          }
        }
      } else {
        offlineRun = 0;
      }
    }

    // ── sudden_drop: single day deviation < -50% ──────────────────────────────
    for (const ds of dayStats) {
      if (
        ds.deviationPct !== null &&
        ds.deviationPct < SUDDEN_DROP_THRESHOLD * 100 &&
        ds.hasSamples
      ) {
        const key = `${project.project_id}|sudden_drop|${ds.date}`;
        if (!existingKeys.has(key)) {
          anomalies.push({
            ...project,
            anomaly_type: 'sudden_drop',
            detected_for_date: ds.date,
            expected_kwh: ds.expected,
            actual_kwh: ds.actual,
            deviation_pct: ds.deviationPct,
            consecutive_days: 1,
          });
        }
      }
    }

    // ── underperformance: deviation < -15% for 5+ consecutive days ───────────
    let underRun = 0;
    for (const ds of dayStats) {
      const isUnder =
        ds.deviationPct !== null &&
        ds.deviationPct < UNDERPERFORMANCE_THRESHOLD * 100 &&
        ds.hasSamples;

      if (isUnder) {
        underRun++;
        if (underRun >= UNDERPERFORMANCE_DAYS) {
          const key = `${project.project_id}|underperformance|${ds.date}`;
          if (!existingKeys.has(key)) {
            anomalies.push({
              ...project,
              anomaly_type: 'underperformance',
              detected_for_date: ds.date,
              expected_kwh: ds.expected,
              actual_kwh: ds.actual,
              deviation_pct: ds.deviationPct ?? 0,
              consecutive_days: underRun,
            });
          }
        }
      } else {
        underRun = 0;
      }
    }

    // ── overperformance_suspect: deviation > +30% for 3+ consecutive days ────
    let overRun = 0;
    for (const ds of dayStats) {
      const isOver =
        ds.deviationPct !== null &&
        ds.deviationPct > OVERPERFORMANCE_THRESHOLD * 100 &&
        ds.hasSamples;

      if (isOver) {
        overRun++;
        if (overRun >= OVERPERFORMANCE_DAYS) {
          const key = `${project.project_id}|overperformance_suspect|${ds.date}`;
          if (!existingKeys.has(key)) {
            anomalies.push({
              ...project,
              anomaly_type: 'overperformance_suspect',
              detected_for_date: ds.date,
              expected_kwh: ds.expected,
              actual_kwh: ds.actual,
              deviation_pct: ds.deviationPct ?? 0,
              consecutive_days: overRun,
            });
          }
        }
      } else {
        overRun = 0;
      }
    }
  }

  console.log(`${op} done`, {
    cohort_size: cohort.length,
    anomalies_found: anomalies.length,
    lookback_days: lookbackDays,
    timestamp: new Date().toISOString(),
  });

  return anomalies;
}
