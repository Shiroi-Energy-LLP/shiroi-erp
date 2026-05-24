/**
 * S15 — B3 Plant Performance Tab (server component).
 *
 * Renders:
 *  - KPI strip: 7-day actual/expected kWh, deviation %, 30-day daily trend
 *  - Active anomalies list with AI narrative + resolve button
 *  - Collapsible resolved anomalies (last 30 days)
 */

import { notFound } from 'next/navigation';
import {
  getActiveAnomaliesForProject,
  getResolvedAnomaliesForProject,
  getProjectPerformanceKpis,
  type AnomalyRow,
} from '@/lib/plant-anomaly-queries';
import { ANOMALY_TYPE_LABELS, ANOMALY_TYPE_BADGE_CLASSES } from '@/lib/plant-anomaly-constants';
import { ResolveAnomalyButton } from './resolve-anomaly-button';

// ── Allowed roles ──────────────────────────────────────────────────────────────

const RESOLVE_ROLES = new Set(['founder', 'om_technician']);

// ── Small display helpers (server-side, no client boundary) ───────────────────

function deviationClass(pct: number | null): string {
  if (pct === null) return 'text-n-500';
  if (pct <= -20) return 'text-red-600 font-semibold';
  if (pct < 0) return 'text-amber-600 font-semibold';
  if (pct >= 20) return 'text-blue-600 font-semibold';
  return 'text-shiroi-green font-semibold';
}

function formatDeviation(pct: number | null): string {
  if (pct === null) return 'N/A';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatKwh(kwh: number | null): string {
  if (kwh === null) return 'N/A';
  return `${kwh.toFixed(1)} kWh`;
}

function formatDate(dateStr: string): string {
  // YYYY-MM-DD → DD MMM YYYY
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-n-200 bg-white p-4 space-y-1">
      <p className="text-xs text-n-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold text-n-900 ${valueClass ?? ''}`}>{value}</p>
      {sub && <p className="text-xs text-n-400">{sub}</p>}
    </div>
  );
}

function SparklineBar({ day, kwh, maxKwh }: { day: string; kwh: number; maxKwh: number }) {
  const pct = maxKwh > 0 ? Math.min(100, (kwh / maxKwh) * 100) : 0;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0" title={`${day}: ${kwh.toFixed(1)} kWh`}>
      <div className="w-full flex flex-col justify-end" style={{ height: 40 }}>
        <div
          className="w-full rounded-sm bg-shiroi-green/60"
          style={{ height: `${Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

function DailyTrend({ days }: { days: Array<{ day: string; kwh: number }> }) {
  if (days.length === 0) {
    return <p className="text-xs text-n-400">No data for trend</p>;
  }
  const maxKwh = Math.max(...days.map((d) => d.kwh), 1);
  return (
    <div className="flex items-end gap-0.5 w-full">
      {days.map((d) => (
        <SparklineBar key={d.day} day={d.day} kwh={d.kwh} maxKwh={maxKwh} />
      ))}
    </div>
  );
}

function AnomalyBadge({ anomalyType }: { anomalyType: string }) {
  const label = ANOMALY_TYPE_LABELS[anomalyType] ?? anomalyType;
  const cls = ANOMALY_TYPE_BADGE_CLASSES[anomalyType] ?? 'bg-n-100 text-n-600 border-n-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function AnomalyCard({
  anomaly,
  canResolve,
}: {
  anomaly: AnomalyRow;
  canResolve: boolean;
}) {
  return (
    <div className="rounded-lg border border-n-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <AnomalyBadge anomalyType={anomaly.anomaly_type} />
          <span className="text-xs text-n-400">{formatDate(anomaly.detected_for_date)}</span>
          {anomaly.consecutive_days > 1 && (
            <span className="text-xs text-n-400">{anomaly.consecutive_days} consecutive days</span>
          )}
        </div>
        {canResolve && !anomaly.resolved_at && (
          <ResolveAnomalyButton anomalyId={anomaly.id} />
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-n-400">Expected</p>
          <p className="font-medium text-n-800">{formatKwh(anomaly.expected_kwh)}</p>
        </div>
        <div>
          <p className="text-xs text-n-400">Actual</p>
          <p className="font-medium text-n-800">{formatKwh(anomaly.actual_kwh)}</p>
        </div>
        <div>
          <p className="text-xs text-n-400">Deviation</p>
          <p className={deviationClass(anomaly.deviation_pct)}>
            {formatDeviation(anomaly.deviation_pct)}
          </p>
        </div>
      </div>

      {anomaly.ai_narrative && (
        <p className="text-sm text-n-700 leading-snug">{anomaly.ai_narrative}</p>
      )}

      {(anomaly.ai_suggested_cause || anomaly.ai_suggested_action) && (
        <div className="rounded bg-n-50 px-3 py-2 space-y-0.5 text-xs text-n-600">
          {anomaly.ai_suggested_cause && (
            <p><span className="font-medium text-n-700">Likely cause:</span> {anomaly.ai_suggested_cause}</p>
          )}
          {anomaly.ai_suggested_action && (
            <p><span className="font-medium text-n-700">Action:</span> {anomaly.ai_suggested_action}</p>
          )}
        </div>
      )}

      {anomaly.resolved_at && (
        <div className="text-xs text-shiroi-green">
          Resolved {formatDate(anomaly.resolved_at.slice(0, 10))}
          {anomaly.resolution_notes ? ` — ${anomaly.resolution_notes}` : ''}
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

interface PerformanceTabProps {
  projectId: string;
  viewerRole: string | null;
}

export async function PerformanceTab({ projectId, viewerRole }: PerformanceTabProps) {
  if (
    !viewerRole ||
    !['founder', 'om_technician', 'project_manager'].includes(viewerRole)
  ) {
    notFound();
  }

  const canResolve = RESOLVE_ROLES.has(viewerRole);

  const [kpis, activeAnomalies, resolvedAnomalies] = await Promise.all([
    getProjectPerformanceKpis(projectId),
    getActiveAnomaliesForProject(projectId),
    getResolvedAnomaliesForProject(projectId, 30),
  ]);

  return (
    <div className="space-y-6">
      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-n-700 mb-3">7-Day Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Actual Generation"
            value={formatKwh(kpis.actual_kwh_7d)}
            sub="last 7 days"
          />
          <KpiCard
            label="Expected Generation"
            value={formatKwh(kpis.expected_kwh_7d)}
            sub="PVLib estimate"
          />
          <KpiCard
            label="Deviation"
            value={formatDeviation(kpis.deviation_pct_7d)}
            sub="vs expected"
            valueClass={deviationClass(kpis.deviation_pct_7d)}
          />
          <div className="rounded-lg border border-n-200 bg-white p-4 space-y-2">
            <p className="text-xs text-n-500 font-medium uppercase tracking-wide">30-Day Trend</p>
            <DailyTrend days={kpis.daily_trend_30d} />
          </div>
        </div>
      </div>

      {/* ── Active Anomalies ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-n-700">Active Anomalies</h3>
          {activeAnomalies.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
              {activeAnomalies.length}
            </span>
          )}
        </div>

        {activeAnomalies.length === 0 ? (
          <div className="rounded-lg border border-n-200 bg-n-50 p-6 text-center text-sm text-n-500">
            No anomalies detected — performance looks normal.
          </div>
        ) : (
          <div className="space-y-3">
            {activeAnomalies.map((anomaly) => (
              <AnomalyCard
                key={anomaly.id}
                anomaly={anomaly}
                canResolve={canResolve}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Resolved (collapsible) ────────────────────────────────────────── */}
      {resolvedAnomalies.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-n-500 hover:text-n-700 list-none flex items-center gap-2">
            <svg
              className="h-4 w-4 transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Resolved ({resolvedAnomalies.length} in last 30 days)
          </summary>
          <div className="mt-3 space-y-3">
            {resolvedAnomalies.map((anomaly) => (
              <AnomalyCard
                key={anomaly.id}
                anomaly={anomaly}
                canResolve={false}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
