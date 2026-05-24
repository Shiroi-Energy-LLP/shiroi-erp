'use server';

/**
 * win-loss-actions.ts — server actions for win/loss pattern analysis.
 *
 * Wraps the analyser for the "Run analysis now" manual trigger button.
 * Role-gated: founder only.
 */

import { requireRole } from '@/lib/auth';
import { analyseWinLossWeek, type WinLossAnalysisResult } from '@/lib/ai/win-loss-analyser';
import { ok, err, type ActionResult } from '@/lib/types/actions';

/**
 * runWinLossAnalysisNow — manual trigger for the founder button.
 *
 * Runs analysis for the current (or most recently complete) Monday–Sunday week.
 * segment = undefined → all-segment report.
 */
export async function runWinLossAnalysisNow(
  segment?: string,
): Promise<ActionResult<WinLossAnalysisResult>> {
  const op = '[runWinLossAnalysisNow]';

  try {
    // Role gate: founder only
    await requireRole(['founder']);

    // Compute current week Mon–Sun
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + daysToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const periodStart = monday.toISOString().split('T')[0]!;
    const periodEnd = sunday.toISOString().split('T')[0]!;

    const result = await analyseWinLossWeek({
      periodStart,
      periodEnd,
      segment: segment ?? null,
    });

    if (!result.success) {
      console.error(`${op} failed`, { error: result.error, timestamp: new Date().toISOString() });
      return err(result.error, result.code);
    }

    return ok(result.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
