import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import {
  getLatestWinLossReport,
  listWinLossReports,
  getWinLossKpis,
} from '@/lib/win-loss-queries';
import { RunWinLossButton } from './run-win-loss-button';
import { WinLossHistoryTable } from './win-loss-history-table';
import { shortINR } from '@repo/ui';
import { Eyebrow, Card, CardContent } from '@repo/ui';
import type { Database } from '@repo/types/database';

type WinLossPatternRow = Database['public']['Tables']['lead_win_loss_patterns']['Row'];

// ── Loss reason shape from JSONB ──────────────────────────────────────────────
interface LossReasonEntry {
  reason: string;
  count: number;
}

// ── Similar won example shape from JSONB ─────────────────────────────────────
interface SimilarWonEntry {
  source_path: string;
  source_id: string | null;
  content_excerpt: string;
  similarity: number;
}

function parseLossReasons(raw: WinLossPatternRow['top_loss_reasons']): LossReasonEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (r): r is LossReasonEntry =>
      typeof r === 'object' && r !== null && 'reason' in r && 'count' in r,
  );
}

function parseSimilarExamples(raw: WinLossPatternRow['similar_won_examples']): SimilarWonEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (e): e is SimilarWonEntry =>
      typeof e === 'object' && e !== null && 'source_path' in e,
  );
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00+05:30');
  const e = new Date(end + 'T00:00:00+05:30');
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${fmt(s)} – ${fmt(e)}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function WinLossPatternsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  // Role gate: founder + marketing_manager
  const isAllowed = profile.role === 'founder' || profile.role === 'marketing_manager';
  if (!isAllowed) redirect('/dashboard');

  const isFounder = profile.role === 'founder';

  // Parallel fetches
  const [latest, reports, kpis] = await Promise.all([
    getLatestWinLossReport(null), // all-segment latest
    listWinLossReports({ limit: 12 }),
    getWinLossKpis(),
  ]);

  const lossReasons = latest ? parseLossReasons(latest.top_loss_reasons) : [];
  const similarExamples = latest ? parseSimilarExamples(latest.similar_won_examples) : [];

  const totalLeads = latest
    ? latest.total_leads_won + latest.total_leads_lost
    : 0;
  const winRateLatest = totalLeads > 0 && latest
    ? Math.round((latest.total_leads_won / totalLeads) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">SALES INTELLIGENCE</Eyebrow>
          <h1 className="text-2xl font-bold text-n-900">Win / Loss Patterns</h1>
          <p className="text-sm text-n-500 mt-1">
            Weekly AI analysis of won and lost leads — runs every Sunday at 23:00 IST
          </p>
        </div>
        {isFounder && <RunWinLossButton />}
      </div>

      {/* KPI strip — last 4 weeks */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-n-500 uppercase tracking-wide font-medium">Win rate (4w)</p>
            <p className="text-2xl font-bold text-n-900 mt-1">
              {kpis.winRatePct !== null ? `${kpis.winRatePct}%` : '—'}
            </p>
            <p className="text-xs text-n-400 mt-1">{kpis.weeksWithData} week{kpis.weeksWithData !== 1 ? 's' : ''} of data</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-n-500 uppercase tracking-wide font-medium">Total won (4w)</p>
            <p className="text-2xl font-bold text-shiroi-green mt-1">
              {kpis.totalValueWon > 0 ? shortINR(kpis.totalValueWon) : '₹0'}
            </p>
            <p className="text-xs text-n-400 mt-1">across last 4 weeks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-n-500 uppercase tracking-wide font-medium">Total lost (4w)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">
              {kpis.totalValueLost > 0 ? shortINR(kpis.totalValueLost) : '₹0'}
            </p>
            <p className="text-xs text-n-400 mt-1">pipeline lost to competitors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-n-500 uppercase tracking-wide font-medium">Avg deal size (won)</p>
            <p className="text-2xl font-bold text-n-900 mt-1">
              {kpis.avgDealSize !== null ? shortINR(kpis.avgDealSize) : '—'}
            </p>
            <p className="text-xs text-n-400 mt-1">per won deal (4w avg)</p>
          </CardContent>
        </Card>
      </div>

      {/* Latest report card */}
      {latest ? (
        <Card>
          <CardContent className="pt-5 pb-5 space-y-5">
            {/* Report meta */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-n-900">
                  Latest report — {formatPeriod(latest.period_start, latest.period_end)}
                </h2>
                <p className="text-sm text-n-500 mt-0.5">
                  {latest.segment ? `Segment: ${latest.segment}` : 'All segments'}
                  {' · '}
                  {latest.total_leads_won}W / {latest.total_leads_lost}L
                  {winRateLatest !== null ? ` · ${winRateLatest}% win rate` : ''}
                  {' · '}
                  Model: {latest.ai_model}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-shiroi-green">
                  Won: {shortINR(Number(latest.total_value_won))}
                </p>
                <p className="text-sm font-medium text-red-600">
                  Lost: {shortINR(Number(latest.total_value_lost))}
                </p>
              </div>
            </div>

            {/* AI narrative */}
            <div>
              <h3 className="text-sm font-semibold text-n-700 uppercase tracking-wide mb-2">AI Analysis</h3>
              <div className="space-y-3 text-sm text-n-800 leading-relaxed">
                {latest.ai_narrative.split('\n\n').map((para, i) => (
                  <p key={i}>{para.trim()}</p>
                ))}
              </div>
            </div>

            {/* Pricing insight */}
            {latest.ai_pricing_insight && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                  Pricing Insight
                </h3>
                <p className="text-sm text-amber-900 leading-relaxed">
                  {latest.ai_pricing_insight}
                </p>
              </div>
            )}

            {/* Top loss reasons */}
            {lossReasons.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-n-700 uppercase tracking-wide mb-2">
                  Top Loss Reasons
                </h3>
                <ul className="space-y-1.5">
                  {lossReasons.map((r, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 text-xs font-bold">
                        {r.count}
                      </span>
                      <span className="text-n-800">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Similar won examples from RAG */}
            {similarExamples.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-n-700 uppercase tracking-wide mb-2">
                  Similar Past Won Deals (via Knowledge Base)
                </h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {similarExamples.map((ex, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-n-200 bg-n-50 p-3 text-xs"
                    >
                      <p className="font-medium text-n-700 truncate mb-1">{ex.source_path}</p>
                      <p className="text-n-500 leading-relaxed line-clamp-3">{ex.content_excerpt}</p>
                      <p className="text-n-400 mt-1">
                        Similarity: {Math.round(ex.similarity * 100)}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-n-500 text-sm">No win/loss reports generated yet.</p>
            {isFounder && (
              <p className="text-n-400 text-xs mt-2">
                Click &ldquo;Run analysis now&rdquo; to generate the first report for the current week.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Historical reports table */}
      {reports.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-n-900 mb-3">History (last 12 reports)</h2>
          <WinLossHistoryTable reports={reports} />
        </div>
      )}
    </div>
  );
}
