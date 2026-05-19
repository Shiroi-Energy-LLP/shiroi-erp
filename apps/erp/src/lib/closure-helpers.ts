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

/**
 * Describes data-quality when computing the margin snapshot.
 *   'ok'           — all inputs present; margin is reliable
 *   'no_bom_cost'  — basePrice > 0 but no BOM cost captured; band forced green,
 *                    grossMargin is null — do not block Won
 *   'no_base_price'— bomCost > 0 but no quote price; band forced red
 *   'no_data'      — both zero; band forced red
 */
export type DataQuality = 'ok' | 'no_bom_cost' | 'no_base_price' | 'no_data';

export interface MarginSnapshot {
  basePrice: number;
  bomCost: number;
  siteExpensesEst: number;
  grossMargin: number | null; // as percentage, not fraction; null when BOM cost unknown
  band: Band;
  dataQuality: DataQuality;
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
 *
 * Data-quality rules (B2 closure-band fallback):
 *   basePrice=0, bomCost=0  → band='red',   dataQuality='no_data'
 *   basePrice>0, bomCost=0  → band='green',  dataQuality='no_bom_cost'  (no cost data — don't block)
 *   basePrice=0, bomCost>0  → band='red',    dataQuality='no_base_price'
 *   both>0                  → normal calc,   dataQuality='ok'
 */
export function computeSnapshotFromValues(
  basePrice: number,
  bomCost: number,
  siteExpensesEst: number,
): ActionResult<MarginSnapshot> {
  // No price and no cost — genuinely unknown, block.
  if (basePrice <= 0 && bomCost <= 0) {
    return ok({
      basePrice: 0,
      bomCost: 0,
      siteExpensesEst,
      grossMargin: 0,
      band: 'red',
      dataQuality: 'no_data',
    });
  }

  // Have a price but no BOM cost — can't compute margin; trust the user, go green.
  if (basePrice > 0 && bomCost <= 0) {
    return ok({
      basePrice,
      bomCost: 0,
      siteExpensesEst,
      grossMargin: null,
      band: 'green',
      dataQuality: 'no_bom_cost',
    });
  }

  // Know cost but no quote price — blocking is correct.
  if (basePrice <= 0 && bomCost > 0) {
    return ok({
      basePrice: 0,
      bomCost,
      siteExpensesEst,
      grossMargin: 0,
      band: 'red',
      dataQuality: 'no_base_price',
    });
  }

  // Both present — normal calculation.
  const totalCost = new Decimal(bomCost).add(siteExpensesEst);
  const profit = new Decimal(basePrice).sub(totalCost);
  const grossMargin = profit.div(basePrice).mul(100).toDP(2).toNumber();

  return ok({
    basePrice,
    bomCost,
    siteExpensesEst,
    grossMargin,
    band: classifyBand(grossMargin),
    dataQuality: 'ok',
  });
}
