'use server';

/**
 * S15 — B3 Anomaly Orchestrator
 *
 * runAnomalyDetectionForAllActiveProjects():
 *   1. Calls detectAnomalies() — scans the last 7 days of telemetry for the
 *      full connected cohort (projects with plant_monitoring_credentials).
 *   2. For each detected anomaly, calls narrateAndPersistAnomaly().
 *   3. Returns summary: { projects_scanned, anomalies_detected, tickets_auto_created }.
 *
 * Bounded concurrency: anomalies are narrated in chunks of 5 to avoid
 * hammering the Anthropic API.
 *
 * Bounded run time: bails out after 25 minutes (n8n cron safety net).
 */

import { detectAnomalies, type RawAnomaly } from './anomaly-detector';
import { narrateAndPersistAnomaly, type NarrateResult } from './anomaly-narrator';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Number of anomalies to narrate in parallel. */
const NARRATION_CONCURRENCY = 5;

/** Wall-clock timeout for the entire orchestration run (ms). */
const MAX_RUN_MS = 25 * 60 * 1000; // 25 minutes

// ── Result shape ───────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  projects_scanned: number;
  anomalies_detected: number;
  anomalies_narrated: number;
  tickets_auto_created: number;
  timed_out: boolean;
  duration_ms: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Process an array of items in bounded-concurrency chunks.
 * Returns the collected results in the same order as the input.
 */
async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
  deadline: number,
): Promise<{ results: R[]; timedOut: boolean }> {
  const results: R[] = [];
  let timedOut = false;

  for (let i = 0; i < items.length; i += chunkSize) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }

    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }

  return { results, timedOut };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * runAnomalyDetectionForAllActiveProjects — entry point for the daily cron.
 *
 * Intentionally does NOT call revalidatePath — the cron runs in the background
 * and the next page load will pick up fresh data from the DB automatically.
 */
export async function runAnomalyDetectionForAllActiveProjects(): Promise<OrchestratorResult> {
  const op = '[runAnomalyDetectionForAllActiveProjects]';
  const startMs = Date.now();
  const deadline = startMs + MAX_RUN_MS;

  const result: OrchestratorResult = {
    projects_scanned: 0,
    anomalies_detected: 0,
    anomalies_narrated: 0,
    tickets_auto_created: 0,
    timed_out: false,
    duration_ms: 0,
  };

  console.log(`${op} starting`, { timestamp: new Date().toISOString() });

  // ── Step 1: Detect anomalies across the full connected cohort ────────────────
  let anomalies: RawAnomaly[];
  try {
    anomalies = await detectAnomalies(7);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} detectAnomalies threw — aborting`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    result.duration_ms = Date.now() - startMs;
    return result;
  }

  result.anomalies_detected = anomalies.length;

  // Derive unique project count from the anomaly list (cohort size is implicit
  // inside detectAnomalies; we count distinct project_ids here as a proxy).
  const uniqueProjects = new Set<string>(anomalies.map((a) => a.project_id));
  result.projects_scanned = uniqueProjects.size;

  if (anomalies.length === 0) {
    console.log(`${op} no anomalies found`, { timestamp: new Date().toISOString() });
    result.duration_ms = Date.now() - startMs;
    return result;
  }

  console.log(`${op} narrating ${anomalies.length} anomalies across ${uniqueProjects.size} projects`, {
    concurrency: NARRATION_CONCURRENCY,
    timestamp: new Date().toISOString(),
  });

  // ── Step 2: Narrate each anomaly in bounded-concurrency chunks ───────────────
  const { results: narrateResults, timedOut } = await processInChunks<
    RawAnomaly,
    NarrateResult
  >(
    anomalies,
    NARRATION_CONCURRENCY,
    (anomaly) => narrateAndPersistAnomaly(anomaly),
    deadline,
  );

  result.timed_out = timedOut;

  // ── Step 3: Tally results ────────────────────────────────────────────────────
  let narrated = 0;
  let tickets = 0;
  for (const r of narrateResults) {
    narrated++;
    if (r.ticket_id) tickets++;
  }

  result.anomalies_narrated = narrated;
  result.tickets_auto_created = tickets;
  result.duration_ms = Date.now() - startMs;

  if (timedOut) {
    console.warn(`${op} timed out after ${MAX_RUN_MS / 1000}s`, {
      anomalies_narrated: narrated,
      anomalies_remaining: anomalies.length - narrated,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.log(`${op} complete`, {
      projects_scanned: result.projects_scanned,
      anomalies_detected: result.anomalies_detected,
      anomalies_narrated: result.anomalies_narrated,
      tickets_auto_created: result.tickets_auto_created,
      duration_ms: result.duration_ms,
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}
