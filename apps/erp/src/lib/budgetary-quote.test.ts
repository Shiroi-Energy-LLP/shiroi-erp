// apps/erp/src/lib/budgetary-quote.test.ts
//
// Tests deliberately use the REAL price_book vocabulary that Shiroi's CSV
// imports populated ('solar_panels', 'mms', 'dc_accessories', 'ic',
// 'generation_meter', 'transport_civil') — not the "logical" category names
// the generator reasons about. The 2026-05-20 fix introduced a
// PRICE_BOOK_CATEGORY map; if these tests pass we know the map is correct
// for the actual production data.
import { describe, it, expect } from 'vitest';
import { generateBudgetaryBOM, type BudgetaryQuoteInput } from './budgetary-quote';
import type { PriceBookItem, CorrectionFactor } from './price-book-queries';

// Mirrors the actual rows on dev (sampled 2026-05-20). Prices and units are
// from real CSV imports. The 0-priced inverter row simulates the placeholder
// rows that exist in production (48 of 118 inverter rows have base_price=0)
// — the fix must filter those out.
const REAL_PRICE_BOOK: PriceBookItem[] = [
  // Panels (priced per Watt — Shiroi's standard)
  { id: 'p1', item_category: 'solar_panels', item_description: '545 Wp / Non DCR - Bifacial', brand: 'Renew', model: null, specification: '545Wp', unit: 'Wp', base_price: 14, gst_type: 'supply', gst_rate: 5, hsn_code: '85414011' },
  { id: 'p2', item_category: 'solar_panels', item_description: '540 Wp / NDCR-Monoperc Monofacial', brand: 'Premier', model: null, specification: '540Wp', unit: 'Wp', base_price: 14.50, gst_type: 'supply', gst_rate: 5, hsn_code: '85414011' },
  // Inverters (mix of small residential + large industrial + zero-price placeholder)
  { id: 'i0', item_category: 'inverter', item_description: '5 KW / Placeholder', brand: 'TBD', model: null, specification: null, unit: 'Nos', base_price: 0, gst_type: 'supply', gst_rate: 5, hsn_code: '85044090' },
  { id: 'i1', item_category: 'inverter', item_description: '1.5 KW / Single Phase On grid Inverter', brand: 'Deye', model: null, specification: null, unit: 'Nos', base_price: 13669, gst_type: 'supply', gst_rate: 5, hsn_code: '85044090' },
  { id: 'i2', item_category: 'inverter', item_description: '10 KW / Three Phase On grid Inverter', brand: 'Sungrow', model: 'SG10RT', specification: null, unit: 'Nos', base_price: 95000, gst_type: 'supply', gst_rate: 5, hsn_code: '85044090' },
  { id: 'i3', item_category: 'inverter', item_description: '150 KW / Three Phase On grid Inverter', brand: 'Sungrow', model: 'SG150CX', specification: null, unit: 'Nos', base_price: 310000, gst_type: 'supply', gst_rate: 5, hsn_code: '85044090' },
  // Mounting structure
  { id: 'm1', item_category: 'mms', item_description: 'GI Flush Mount Structure per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 7500, gst_type: 'works_contract', gst_rate: 18, hsn_code: '73089090' },
  { id: 'm2', item_category: 'mms', item_description: 'Aluminium Elevated Structure per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 9500, gst_type: 'works_contract', gst_rate: 18, hsn_code: '73089090' },
  // DC cable bucket
  { id: 'd1', item_category: 'dc_accessories', item_description: 'MC4 Connector', brand: 'Ningbo', model: null, specification: null, unit: 'Nos', base_price: 24, gst_type: 'supply', gst_rate: 5, hsn_code: '85446090' },
  { id: 'd2', item_category: 'dc_accessories', item_description: '4 sq mm DC Cable (Type 1)', brand: 'Polycab', model: null, specification: null, unit: 'Meter', base_price: 40, gst_type: 'supply', gst_rate: 5, hsn_code: '85446090' },
  // Labour (segment-aware)
  { id: 'l1', item_category: 'ic', item_description: 'Installation Labour per kWp (Residential)', brand: null, model: null, specification: null, unit: 'kw', base_price: 4500, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  { id: 'l2', item_category: 'ic', item_description: 'Installation Labour per kWp (Commercial)', brand: null, model: null, specification: null, unit: 'kw', base_price: 4000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  // Net Metering (segment-aware)
  { id: 'n1', item_category: 'generation_meter', item_description: 'TNEB Net Metering + Liaison (Residential)', brand: null, model: null, specification: null, unit: 'lumpsum', base_price: 25000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  { id: 'n2', item_category: 'generation_meter', item_description: 'TNEB Net Metering + Liaison (Commercial)', brand: null, model: null, specification: null, unit: 'lumpsum', base_price: 45000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  // Civil (mix of per-kWp and lumpsum)
  { id: 'c1', item_category: 'transport_civil', item_description: 'Foundation + Waterproofing per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 3500, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  { id: 'c2', item_category: 'transport_civil', item_description: 'Material Transport (within Chennai)', brand: null, model: null, specification: null, unit: 'lumpsum', base_price: 8000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
];

const REAL_CORRECTIONS: CorrectionFactor[] = [];

const BASE_INPUT: BudgetaryQuoteInput = {
  systemSizeKwp: 10,
  systemType: 'on_grid',
  segment: 'residential',
  structureType: 'flush_mount',
  includeLiaison: true,
  includeCivil: true,
};

describe('generateBudgetaryBOM — production price_book vocabulary', () => {
  it('produces at least 7 BOM lines for a residential on_grid quote with liaison+civil', () => {
    const result = generateBudgetaryBOM(BASE_INPUT, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    // panel, inverter, structure, dc_cable, labour, net_meter, civil = 7 lines
    expect(result.length).toBeGreaterThanOrEqual(7);
  });

  it('panels are priced per-Wp (size × 1000) when unit is Wp', () => {
    const result = generateBudgetaryBOM(BASE_INPUT, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const panel = result.find((l) => l.item_category === 'solar_panels');
    expect(panel).toBeDefined();
    // 10 kWp → 10,000 Wp at ₹14/Wp = ₹1,40,000
    expect(panel!.quantity).toBe(10000);
    expect(panel!.unit_price).toBe(14);
    expect(panel!.total_price).toBe(140000);
  });

  it('inverter is sized to system capacity (150 kWp picks the 150 kW row, not 1.5 kW cheapest)', () => {
    const result = generateBudgetaryBOM(
      { ...BASE_INPUT, systemSizeKwp: 150, segment: 'industrial' },
      REAL_PRICE_BOOK,
      REAL_CORRECTIONS,
    );
    const inverter = result.find((l) => l.item_category === 'inverter');
    expect(inverter).toBeDefined();
    expect(inverter!.brand).toBe('Sungrow');
    expect(inverter!.unit_price).toBe(310000);
  });

  it('inverter never picks a zero-price placeholder row even if it is the cheapest', () => {
    const result = generateBudgetaryBOM(BASE_INPUT, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const inverter = result.find((l) => l.item_category === 'inverter');
    expect(inverter).toBeDefined();
    expect(inverter!.unit_price).toBeGreaterThan(0);
  });

  it('residential labour picks the Residential row at ₹4500/kWp', () => {
    const result = generateBudgetaryBOM({ ...BASE_INPUT, segment: 'residential' }, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const labour = result.find((l) => l.item_category === 'ic');
    expect(labour).toBeDefined();
    expect(labour!.unit_price).toBe(4500);
  });

  it('industrial labour falls through to Commercial row at ₹4000/kWp', () => {
    const result = generateBudgetaryBOM({ ...BASE_INPUT, segment: 'industrial' }, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const labour = result.find((l) => l.item_category === 'ic');
    expect(labour).toBeDefined();
    expect(labour!.unit_price).toBe(4000);
  });

  it('residential net metering picks the Residential lumpsum at ₹25,000', () => {
    const result = generateBudgetaryBOM({ ...BASE_INPUT, segment: 'residential' }, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const liaison = result.find((l) => l.item_category === 'generation_meter');
    expect(liaison).toBeDefined();
    expect(liaison!.unit_price).toBe(25000);
  });

  it('commercial net metering picks the Commercial lumpsum at ₹45,000', () => {
    const result = generateBudgetaryBOM({ ...BASE_INPUT, segment: 'commercial' }, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const liaison = result.find((l) => l.item_category === 'generation_meter');
    expect(liaison).toBeDefined();
    expect(liaison!.unit_price).toBe(45000);
  });

  it('civil prefers the per-kWp foundation row over the lumpsum transport row', () => {
    const result = generateBudgetaryBOM(BASE_INPUT, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const civil = result.find((l) => l.item_category === 'transport_civil');
    expect(civil).toBeDefined();
    expect(civil!.unit).toBe('kw');
    expect(civil!.unit_price).toBe(3500);
    expect(civil!.quantity).toBe(10);
    expect(civil!.total_price).toBe(35000);
  });

  it('flush_mount uses the GI structure at base ₹7,500/kWp', () => {
    const result = generateBudgetaryBOM(BASE_INPUT, REAL_PRICE_BOOK, REAL_CORRECTIONS);
    const structure = result.find((l) => l.item_category === 'mms');
    expect(structure).toBeDefined();
    expect(structure!.unit_price).toBe(7500);
    expect(structure!.quantity).toBe(10);
    expect(structure!.total_price).toBe(75000);
  });

  it('elevated structure applies 1.15× markup', () => {
    const result = generateBudgetaryBOM(
      { ...BASE_INPUT, structureType: 'elevated' },
      REAL_PRICE_BOOK,
      REAL_CORRECTIONS,
    );
    const structure = result.find((l) => l.item_category === 'mms');
    expect(structure).toBeDefined();
    // Cheapest is GI Flush at 7500; 7500 × 1.15 = 8625
    expect(structure!.unit_price).toBe(8625);
  });

  it('includeLiaison=false skips the net metering line', () => {
    const result = generateBudgetaryBOM(
      { ...BASE_INPUT, includeLiaison: false },
      REAL_PRICE_BOOK,
      REAL_CORRECTIONS,
    );
    expect(result.find((l) => l.item_category === 'generation_meter')).toBeUndefined();
  });

  it('includeCivil=false skips the civil line', () => {
    const result = generateBudgetaryBOM(
      { ...BASE_INPUT, includeCivil: false },
      REAL_PRICE_BOOK,
      REAL_CORRECTIONS,
    );
    expect(result.find((l) => l.item_category === 'transport_civil')).toBeUndefined();
  });

  it('on_grid never includes battery', () => {
    const withBattery: PriceBookItem[] = [
      ...REAL_PRICE_BOOK,
      { id: 'b1', item_category: 'battery', item_description: 'LFP 5kWh', brand: 'Growatt', model: null, specification: null, unit: 'nos', base_price: 165000, gst_type: 'supply', gst_rate: 5, hsn_code: '85076000' },
    ];
    const result = generateBudgetaryBOM(BASE_INPUT, withBattery, REAL_CORRECTIONS);
    expect(result.find((l) => l.item_category === 'battery')).toBeUndefined();
  });

  it('hybrid includes battery sized at 2 kWh/kWp', () => {
    const withBattery: PriceBookItem[] = [
      ...REAL_PRICE_BOOK,
      { id: 'b1', item_category: 'battery', item_description: 'LFP 5kWh', brand: 'Growatt', model: null, specification: null, unit: 'nos', base_price: 165000, gst_type: 'supply', gst_rate: 5, hsn_code: '85076000' },
    ];
    const result = generateBudgetaryBOM(
      { ...BASE_INPUT, systemType: 'hybrid' },
      withBattery,
      REAL_CORRECTIONS,
    );
    const battery = result.find((l) => l.item_category === 'battery');
    expect(battery).toBeDefined();
    expect(battery!.quantity).toBe(20); // 10 kWp × 2 kWh/kWp
  });

  it('150 kWp industrial flush_mount with liaison+civil produces a non-zero quote', () => {
    const result = generateBudgetaryBOM(
      {
        systemSizeKwp: 150,
        systemType: 'on_grid',
        segment: 'industrial',
        structureType: 'flush_mount',
        includeLiaison: true,
        includeCivil: true,
      },
      REAL_PRICE_BOOK,
      REAL_CORRECTIONS,
    );
    const total = result.reduce((sum, l) => sum + l.total_price, 0);
    // Sanity floor: any non-trivial industrial system should exceed ₹40 lakhs
    expect(total).toBeGreaterThan(4_000_000);
    // Inverter sized correctly
    expect(result.find((l) => l.item_category === 'inverter')!.unit_price).toBe(310000);
    // Labour at commercial rate
    expect(result.find((l) => l.item_category === 'ic')!.unit_price).toBe(4000);
  });
});
