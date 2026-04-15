/**
 * Closure band helpers — pure (non-async) types, constants, and classifier
 * for the Closure Soon workflow.
 *
 * Split out of `closure-actions.ts` because Next.js forbids non-async exports
 * from a `'use server'` file. Server actions must be async functions; the
 * band thresholds, Band/MarginSnapshot types, and the pure `classifyBand()`
 * / `computeSnapshotFromValues()` helpers live here so the action file can
 * stay `'use server'`-clean.
 *
 * Band thresholds (founder-configurable; defaults for post-revamp):
 *   Green  ≥ 10%  → marketing_manager can approve alone, one-click flip to won
 *   Amber  8–10% → founder approval required via lead_closure_approvals
 *   Red    < 8%  → won transition blocked, renegotiate up or mark lost
 */
import Decimal from 'decimal.js';
import { ok, type ActionResult } from './types/actions';

export const GREEN_BAND_MIN_PCT = 10;
export const AMBER_BAND_MIN_PCT = 8;
export const TARGET_MARGIN_PCT = 15;

export type Band = 'green' | 'amber' | 'red';

export interface MarginSnapshot {
  basePrice: number;
  bomCost: number;
  siteExpensesEst: number;
  grossMargin: number; // as percentage, not fraction
  band: Band;
}

/**
 * Map a gross-margin percentage to its band.
 * Pure, synchronous — must not live in a `'use server'` file.
 */
export function classifyBand(grossMarginPct: number): Band {
  if (grossMarginPct >= GREEN_BAND_MIN_PCT) return 'green';
  if (grossMarginPct >= AMBER_BAND_MIN_PCT) return 'amber';
  return 'red';
}

/**
 * Build a MarginSnapshot from the three inputs. Pure math over Decimal.js.
 * Called by `computeMargin()` in closure-actions.ts to avoid duplication.
 */
export function computeSnapshotFromValues(
  basePrice: number,
  bomCost: number,
  siteExpensesEst: number,
): ActionResult<MarginSnapshot> {
  if (basePrice <= 0) {
    return ok({
      basePrice: 0,
      bomCost,
      siteExpensesEst,
      grossMargin: 0,
      band: 'red',
    });
  }

  const totalCost = new Decimal(bomCost).add(siteExpensesEst);
  const profit = new Decimal(basePrice).sub(totalCost);
  const grossMargin = profit.div(basePrice).mul(100).toDP(2).toNumber();

  return ok({
    basePrice,
    bomCost,
    siteExpensesEst,
    grossMargin,
    band: classifyBand(grossMargin),
  });
}
