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
  /**
   * Per-category brand preference. When set, the category selector picks the
   * cheapest active item in the given brand; if the brand isn't in the category,
   * it falls back to the global cheapest active item.
   *
   * Used by Prem to steer default selections without building a full template
   * system: `{ panel: 'Waree', inverter: 'Sungrow' }`.
   */
  preferredBrands?: Partial<Record<string, string>>;
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
  /**
   * FK into price_book.id. Populated by the category selector for every line
   * generated post-migration 052. Enables Quote -> BOQ -> PO traceability via
   * a single master key.
   */
  price_book_id: string | null;
}

const STRUCTURE_MULTIPLIERS: Record<string, string> = {
  elevated: '1.15',
  high_rise: '1.10',
};

const DEFAULT_PANEL_WATTAGE = 540;
const DEFAULT_BATTERY_KWH_PER_KWP = 2; // 2 kWh per kWp for hybrid

/**
 * Balance-of-System (Misc) lumpsum per kWp.
 *
 * The price_book has 4 buckets that the per-category generator doesn't
 * itemise — AC cabling (43 rows), earthing (10 rows), conduits (24 rows),
 * miscellaneous fasteners/lugs (14 rows), and safety accessories (4 rows).
 * Picking the "cheapest" from each is meaningless (a ₹1 screw, a ₹40 wire).
 * Industry norm for BoS on rooftop solar is 8–12% of system cost; for
 * Shiroi's price points (~₹40-55K/kWp total) that maps to roughly
 * ₹3,500–₹5,500/kWp depending on segment. We pick a flat ₹4,000/kWp
 * lumpsum and emit it as a single "Misc / BoS" line. Adjustable later if
 * a per-segment refinement is needed.
 */
const MISC_BOS_PER_KWP = 4000;
const MISC_BOS_DESCRIPTION =
  'Balance of System — AC cabling, earthing, conduits, safety & misc accessories';

/**
 * Logical → price_book category mapping.
 *
 * The Quick Quote BOM generator reasons in "logical" category names (panel,
 * inverter, structure, dc_cable, ...) that match what the manual proposal
 * wizard, BOQ tooling, and PDF renderer expect. The price_book table, however,
 * was imported with a *different* vocabulary derived from Shiroi's existing
 * CSV master ('solar_panels', 'mms', 'dc_accessories', 'ic', etc.).
 *
 * Without this map, `findItem('panel', ...)` returns nothing because no row
 * has `item_category='panel'`. The Quick Quote feature shipped with this
 * vocabulary mismatch and silently produced 1-line ₹0 quotes from day one
 * (only `inverter` matched by coincidence; `battery` matched but on_grid
 * quotes skip it). Fixed 2026-05-20.
 *
 * One logical bucket can map to multiple DB categories (rare today; reserved
 * for the future when a bucket like `electricals` might span both
 * `dc_accessories` and `ac_accessories`).
 */
const PRICE_BOOK_CATEGORY: Record<string, readonly string[]> = {
  panel:               ['solar_panels', 'panel'],
  inverter:            ['inverter'],
  battery:             ['battery'],
  structure:           ['mms', 'structure'],
  dc_cable:            ['dc_accessories', 'dc_cable'],
  ac_cable:            ['ac_accessories', 'ac_cable'],
  earthing:            ['earthing_accessories', 'earthing'],
  installation_labour: ['ic', 'installation_labour'],
  net_meter:           ['generation_meter', 'net_meter'],
  civil_work:          ['transport_civil', 'civil_work'],
};

/** Segment label fragments expected inside price_book item_description for segment-aware matches. */
const SEGMENT_KEYWORDS: Record<string, string[]> = {
  residential: ['residential'],
  // Industrial proposals share commercial pricing rows in Shiroi's price book.
  commercial:  ['commercial'],
  industrial:  ['commercial'],
};

/** Resolve the candidate DB rows for a logical category. */
function rowsForCategory(priceBook: PriceBookItem[], logicalCategory: string): PriceBookItem[] {
  const dbCategories = PRICE_BOOK_CATEGORY[logicalCategory] ?? [logicalCategory];
  return priceBook.filter(
    (p) => dbCategories.includes(p.item_category) && Number(p.base_price) > 0,
  );
}

/**
 * Find the best price_book item for a logical category.
 *
 * Selection order (first satisfied rule wins):
 *   1. Preferred brand match → cheapest in that brand.
 *   2. `prefer` predicate match → cheapest among matches (used for segment-
 *      specific rows like "Installation Labour per kWp (Commercial)" or
 *      capacity-specific inverters like "150 KW / Three Phase On grid").
 *   3. Cheapest overall in the logical category.
 *
 * Always filters out rows with base_price ≤ 0 (placeholder/draft entries) —
 * these were the second cause of broken Quick Quotes pre-2026-05-20.
 */
function findItem(
  priceBook: PriceBookItem[],
  logicalCategory: string,
  opts: {
    preferredBrand?: string;
    prefer?: (item: PriceBookItem) => boolean;
  } = {},
): PriceBookItem | undefined {
  const candidates = rowsForCategory(priceBook, logicalCategory);
  if (candidates.length === 0) return undefined;

  if (opts.preferredBrand) {
    const brandMatches = candidates.filter(
      (p) => p.brand && p.brand.toLowerCase() === opts.preferredBrand!.toLowerCase(),
    );
    if (brandMatches.length > 0) {
      return [...brandMatches].sort((a, b) => Number(a.base_price) - Number(b.base_price))[0];
    }
  }

  if (opts.prefer) {
    const preferred = candidates.filter(opts.prefer);
    if (preferred.length > 0) {
      return [...preferred].sort((a, b) => Number(a.base_price) - Number(b.base_price))[0];
    }
  }

  return [...candidates].sort((a, b) => Number(a.base_price) - Number(b.base_price))[0];
}

/**
 * Build a predicate that prefers rows whose item_description mentions the
 * given segment. Used for labour + net-metering rows that come in
 * Residential/Commercial variants.
 */
function preferSegment(segment: string): (item: PriceBookItem) => boolean {
  const keywords = SEGMENT_KEYWORDS[segment.toLowerCase()] ?? [];
  if (keywords.length === 0) return () => false;
  return (item) => {
    const haystack = (item.item_description ?? '').toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  };
}

/**
 * Parse the kW capacity from an inverter's item_description, e.g.
 * "150 KW / Three Phase On grid Inverter" → 150,
 * "1.5 KW / Single Phase On grid Inverter" → 1.5.
 * Returns null if no capacity figure is present.
 */
function parseInverterCapacityKw(description: string | null | undefined): number | null {
  if (!description) return null;
  const match = description.match(/(\d+(?:\.\d+)?)\s*(?:kw|kWp)\b/i);
  return match ? parseFloat(match[1]!) : null;
}

/**
 * Build a predicate that prefers inverter rows whose capacity is closest to
 * (but not absurdly smaller than) the system size. For 150 kWp, this picks
 * a 150 kW inverter — not the cheapest 1.5 kW residential inverter.
 *
 * Tolerance: accept rows within [0.8×size, 1.5×size]. If none qualify, the
 * caller falls back to the cheapest overall.
 */
function preferInverterCapacity(sizeKwp: number): (item: PriceBookItem) => boolean {
  const min = sizeKwp * 0.8;
  const max = sizeKwp * 1.5;
  return (item) => {
    const cap = parseInverterCapacityKw(item.item_description) ?? parseInverterCapacityKw(item.specification);
    return cap !== null && cap >= min && cap <= max;
  };
}

function findCorrectionFactor(corrections: CorrectionFactor[], category: string): number {
  const match = corrections.find((c) => c.item_category === category);
  return match ? Number(match.correction_factor) : 1.0;
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
    // Trace the generated line back to the price_book master row
    price_book_id: item.id,
  };
}

/**
 * Parse the wattage of a panel from spec, description, or model — used when
 * the panel row uses the per-Wp pricing model (unit='Wp'). Falls back to
 * DEFAULT_PANEL_WATTAGE if no figure can be extracted.
 */
function parsePanelWattage(item: PriceBookItem): number {
  const candidates = [item.specification, item.item_description, item.model];
  for (const c of candidates) {
    if (!c) continue;
    const match = c.match(/(\d{3,4})\s*Wp?\b/i);
    if (match) return parseInt(match[1]!, 10);
  }
  return DEFAULT_PANEL_WATTAGE;
}

export function generateBudgetaryBOM(
  input: BudgetaryQuoteInput,
  priceBook: PriceBookItem[],
  corrections: CorrectionFactor[],
): GeneratedBOMLine[] {
  const lines: GeneratedBOMLine[] = [];
  const size = input.systemSizeKwp;
  const prefs = input.preferredBrands ?? {};
  const segmentPredicate = preferSegment(input.segment);

  // 1. Panels — quantity depends on the unit convention used in price_book.
  //    Shiroi's master uses unit='Wp' priced per Watt; older mocks used
  //    unit='Nos' priced per panel. Handle both.
  const panelItem = findItem(priceBook, 'panel', { preferredBrand: prefs.panel });
  if (panelItem) {
    const cf = findCorrectionFactor(corrections, 'panel');
    const isPerWatt = (panelItem.unit ?? '').toLowerCase() === 'wp';
    if (isPerWatt) {
      // size kWp × 1000 → total Wp; unit_price is rupees per Wp.
      const quantityWp = Math.round(size * 1000);
      lines.push(makeLine(panelItem, quantityWp, Number(panelItem.base_price), cf));
    } else {
      const wattage = parsePanelWattage(panelItem);
      const count = Math.ceil((size * 1000) / wattage);
      lines.push(makeLine(panelItem, count, Number(panelItem.base_price), cf));
    }
  }

  // 2. Inverter — prefer one whose capacity matches the system size; fall
  //    back to cheapest priced. Quantity is always 1 (single string for
  //    Quick Quote; refined per-string in detailed proposal).
  const inverterItem = findItem(priceBook, 'inverter', {
    preferredBrand: prefs.inverter,
    prefer: preferInverterCapacity(size),
  });
  if (inverterItem) {
    const cf = findCorrectionFactor(corrections, 'inverter');
    lines.push(makeLine(inverterItem, 1, Number(inverterItem.base_price), cf));
  }

  // 3. Battery — only for hybrid/off_grid
  if (input.systemType !== 'on_grid') {
    const batteryItem = findItem(priceBook, 'battery', { preferredBrand: prefs.battery });
    if (batteryItem) {
      const kwhNeeded = size * DEFAULT_BATTERY_KWH_PER_KWP;
      const cf = findCorrectionFactor(corrections, 'battery');
      lines.push(makeLine(batteryItem, kwhNeeded, Number(batteryItem.base_price), cf));
    }
  }

  // 4. Structure — per kWp, with structure type multiplier (flush_mount = 1×,
  //    elevated = 1.15×, high_rise = 1.10×).
  const structureItem = findItem(priceBook, 'structure', { preferredBrand: prefs.structure });
  if (structureItem) {
    const multiplier = STRUCTURE_MULTIPLIERS[input.structureType] ?? '1.0';
    const adjustedPrice = new Decimal(Number(structureItem.base_price)).mul(multiplier).round().toNumber();
    const cf = findCorrectionFactor(corrections, 'structure');
    lines.push(makeLine(structureItem, size, adjustedPrice, cf));
  }

  // 5. Electrical + cabling — per kWp. Shiroi's master has separate
  //    dc_accessories + ac_accessories rows; we pick the cheapest priced
  //    "per kWp" or per-meter row, treating quantity as system size.
  const electricalItem = findItem(priceBook, 'dc_cable', { preferredBrand: prefs.dc_cable });
  if (electricalItem) {
    const cf = findCorrectionFactor(corrections, 'dc_cable');
    lines.push(makeLine(electricalItem, size, Number(electricalItem.base_price), cf));
  }

  // 6. Installation labour — per kWp. Segment-aware: Industrial uses the
  //    Commercial labour rate.
  const labourItem = findItem(priceBook, 'installation_labour', {
    preferredBrand: prefs.installation_labour,
    prefer: segmentPredicate,
  });
  if (labourItem) {
    const cf = findCorrectionFactor(corrections, 'installation_labour');
    lines.push(makeLine(labourItem, size, Number(labourItem.base_price), cf));
  }

  // 7. Net metering + liaison — lumpsum, segment-aware (TNEB rules differ
  //    for residential vs commercial). Skip if explicitly excluded.
  if (input.includeLiaison) {
    const liaisonItem = findItem(priceBook, 'net_meter', {
      preferredBrand: prefs.net_meter,
      prefer: segmentPredicate,
    });
    if (liaisonItem) {
      const cf = findCorrectionFactor(corrections, 'net_meter');
      lines.push(makeLine(liaisonItem, 1, Number(liaisonItem.base_price), cf));
    }
  }

  // 8. Civil works — per kWp. Prefer the per-kWp foundation/waterproofing
  //    row over the lumpsum transport row in transport_civil.
  if (input.includeCivil) {
    const civilItem = findItem(priceBook, 'civil_work', {
      preferredBrand: prefs.civil_work,
      prefer: (item) => (item.unit ?? '').toLowerCase() === 'kw',
    });
    if (civilItem) {
      const cf = findCorrectionFactor(corrections, 'civil_work');
      lines.push(makeLine(civilItem, size, Number(civilItem.base_price), cf));
    }
  }

  // 9. Misc / Balance of System — synthetic lumpsum per kWp covering AC
  //    cabling, earthing, conduits, safety, and miscellaneous fasteners.
  //    These buckets exist in price_book but their unit/quantity model
  //    doesn't lend itself to "cheapest row × size" — emitting them as a
  //    single per-kWp lumpsum is the convention. No price_book_id since
  //    the line is generator-synthesised; correction factor doesn't apply.
  const miscQty = size;
  const miscTotal = new Decimal(miscQty).mul(MISC_BOS_PER_KWP).toNumber();
  const miscGst = new Decimal(miscTotal).mul('0.18').toNumber();
  lines.push({
    item_category: 'miscellaneous',
    item_description: MISC_BOS_DESCRIPTION,
    brand: null,
    model: null,
    hsn_code: null,
    quantity: miscQty,
    unit: 'kw',
    unit_price: MISC_BOS_PER_KWP,
    total_price: miscTotal,
    gst_type: 'works_contract',
    gst_rate: 18,
    gst_amount: miscGst,
    scope_owner: 'shiroi',
    raw_estimated_cost: miscTotal,
    correction_factor: 1.0,
    corrected_cost: miscTotal,
    price_book_id: null,
  });

  return lines;
}
