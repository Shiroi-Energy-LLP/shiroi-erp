/**
 * S15 — B3 Plant anomaly constants (no server imports — safe for 'use client').
 *
 * Labels, badge colours, and ordering for plant_anomaly_log.anomaly_type.
 * Extracted here so 'use client' components can import without touching the
 * server-only queries file (NEVER-DO #21).
 */

export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  underperformance: 'Underperformance',
  sudden_drop: 'Sudden Drop',
  offline_too_long: 'Offline Too Long',
  data_gap: 'Data Gap',
  overperformance_suspect: 'Overperformance (Suspect)',
};

/** Tailwind classes for the anomaly badge, keyed by anomaly_type. */
export const ANOMALY_TYPE_BADGE_CLASSES: Record<string, string> = {
  underperformance: 'bg-amber-100 text-amber-700 border-amber-200',
  sudden_drop: 'bg-red-100 text-red-700 border-red-200',
  offline_too_long: 'bg-red-100 text-red-700 border-red-200',
  data_gap: 'bg-n-100 text-n-600 border-n-200',
  overperformance_suspect: 'bg-blue-100 text-blue-700 border-blue-200',
};

/** Sort priority: lower number = shown first. */
export const ANOMALY_TYPE_SEVERITY: Record<string, number> = {
  offline_too_long: 1,
  sudden_drop: 2,
  underperformance: 3,
  overperformance_suspect: 4,
  data_gap: 5,
};
