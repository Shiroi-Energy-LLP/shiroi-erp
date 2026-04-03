// apps/erp/src/lib/budgetary-quote.ts
import Decimal from 'decimal.js';
import type { PriceBookItem, CorrectionFactor } from './price-book-queries';

export interface BudgetaryQuoteInput {
  systemSizeKwp: number;
  systemType: 'on_grid' | 'hybrid' | 'off_grid';
  segment: string;
  structureType: string; // flush_mount | elevated | high_rise
  includeLiaison: boolean;
  includeCivil: boolean;
}

export interface GeneratedBOMLine {
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  hsn_code: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  gst_type: string;
  gst_rate: number;
  gst_amount: number;
  scope_owner: 'shiroi' | 'client';
  raw_estimated_cost: number;
  correction_factor: number;
  corrected_cost: number;
}

const STRUCTURE_MULTIPLIERS: Record<string, string> = {
  elevated: '1.15',
  high_rise: '1.10',
};

const DEFAULT_PANEL_WATTAGE = 540;
const DEFAULT_BATTERY_KWH_PER_KWP = 2; // 2 kWh per kWp for hybrid

function findItem(priceBook: PriceBookItem[], category: string): PriceBookItem | undefined {
  return priceBook.find(p => p.item_category === category);
}

function findCorrectionFactor(corrections: CorrectionFactor[], category: string): number {
  const match = corrections.find(c => c.item_category === category);
  return match ? match.correction_factor : 1.0;
}

function makeLine(
  item: PriceBookItem,
  quantity: number,
  unitPrice: number,
  correctionFactor: number,
): GeneratedBOMLine {
  const totalPrice = new Decimal(quantity).mul(unitPrice).toNumber();
  const gstRate = item.gst_type === 'supply' ? 5.0 : 18.0;
  const gstRateDecimal = item.gst_type === 'supply' ? '0.05' : '0.18';
  const gstAmount = new Decimal(totalPrice).mul(gstRateDecimal).toNumber();
  const rawCost = totalPrice;
  const correctedCost = new Decimal(rawCost).mul(correctionFactor).toNumber();

  return {
    item_category: item.item_category,
    item_description: item.item_description,
    brand: item.brand,
    model: item.model,
    hsn_code: item.hsn_code,
    quantity,
    unit: item.unit,
    unit_price: unitPrice,
    total_price: totalPrice,
    gst_type: item.gst_type,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    scope_owner: 'shiroi',
    raw_estimated_cost: rawCost,
    correction_factor: correctionFactor,
    corrected_cost: correctedCost,
  };
}

export function generateBudgetaryBOM(
  input: BudgetaryQuoteInput,
  priceBook: PriceBookItem[],
  corrections: CorrectionFactor[],
): GeneratedBOMLine[] {
  const lines: GeneratedBOMLine[] = [];
  const size = input.systemSizeKwp;

  // 1. Panels — size_kwp * 1000 / wattage, ceil
  const panelItem = findItem(priceBook, 'panel');
  if (panelItem) {
    const wattage = panelItem.specification
      ? parseInt(panelItem.specification, 10) || DEFAULT_PANEL_WATTAGE
      : DEFAULT_PANEL_WATTAGE;
    const count = Math.ceil((size * 1000) / wattage);
    const cf = findCorrectionFactor(corrections, 'panel');
    lines.push(makeLine(panelItem, count, panelItem.base_price, cf));
  }

  // 2. Inverter — 1 unit, nearest match
  const inverterItem = findItem(priceBook, 'inverter');
  if (inverterItem) {
    const cf = findCorrectionFactor(corrections, 'inverter');
    lines.push(makeLine(inverterItem, 1, inverterItem.base_price, cf));
  }

  // 3. Battery — only for hybrid/off_grid
  if (input.systemType !== 'on_grid') {
    const batteryItem = findItem(priceBook, 'battery');
    if (batteryItem) {
      const kwhNeeded = size * DEFAULT_BATTERY_KWH_PER_KWP;
      const cf = findCorrectionFactor(corrections, 'battery');
      lines.push(makeLine(batteryItem, kwhNeeded, batteryItem.base_price, cf));
    }
  }

  // 4. Structure — per kWp, with structure type multiplier
  const structureItem = findItem(priceBook, 'structure');
  if (structureItem) {
    const multiplier = STRUCTURE_MULTIPLIERS[input.structureType] ?? '1.0';
    const adjustedPrice = new Decimal(structureItem.base_price).mul(multiplier).round().toNumber();
    const cf = findCorrectionFactor(corrections, 'structure');
    lines.push(makeLine(structureItem, size, adjustedPrice, cf));
  }

  // 5. Electrical + cabling — per kWp
  const electricalItem = findItem(priceBook, 'dc_cable');
  if (electricalItem) {
    const cf = findCorrectionFactor(corrections, 'dc_cable');
    lines.push(makeLine(electricalItem, size, electricalItem.base_price, cf));
  }

  // 6. Installation labour — per kWp
  const labourItem = findItem(priceBook, 'installation_labour');
  if (labourItem) {
    const cf = findCorrectionFactor(corrections, 'installation_labour');
    lines.push(makeLine(labourItem, size, labourItem.base_price, cf));
  }

  // 7. Net metering + liaison — lumpsum, skip if excluded
  if (input.includeLiaison) {
    const liaisonItem = findItem(priceBook, 'net_meter');
    if (liaisonItem) {
      const cf = findCorrectionFactor(corrections, 'net_meter');
      lines.push(makeLine(liaisonItem, 1, liaisonItem.base_price, cf));
    }
  }

  // 8. Civil works — per kWp, skip if excluded
  if (input.includeCivil) {
    const civilItem = findItem(priceBook, 'civil_work');
    if (civilItem) {
      const cf = findCorrectionFactor(corrections, 'civil_work');
      lines.push(makeLine(civilItem, size, civilItem.base_price, cf));
    }
  }

  return lines;
}
