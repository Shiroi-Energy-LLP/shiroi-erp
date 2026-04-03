// apps/erp/src/lib/budgetary-quote.test.ts
import { describe, it, expect } from 'vitest';
import { generateBudgetaryBOM, type BudgetaryQuoteInput, type GeneratedBOMLine } from './budgetary-quote';
import type { PriceBookItem, CorrectionFactor } from './price-book-queries';

const MOCK_PRICE_BOOK: PriceBookItem[] = [
  { id: '1', item_category: 'panel', item_description: 'Waaree 540W Mono PERC', brand: 'Waaree', model: '540W', specification: '540Wp', unit: 'nos', base_price: 16200, gst_type: 'supply', gst_rate: 5, hsn_code: '85414011' },
  { id: '2', item_category: 'inverter', item_description: 'Sungrow 10kW', brand: 'Sungrow', model: 'SG10RT', specification: '10kW', unit: 'nos', base_price: 95000, gst_type: 'supply', gst_rate: 5, hsn_code: '85044090' },
  { id: '3', item_category: 'structure', item_description: 'GI Mounting Structure per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 8500, gst_type: 'works_contract', gst_rate: 18, hsn_code: '73089090' },
  { id: '4', item_category: 'dc_cable', item_description: 'DC Cable + AC Cable + Conduit per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 5500, gst_type: 'supply', gst_rate: 5, hsn_code: '85446090' },
  { id: '5', item_category: 'installation_labour', item_description: 'Installation Labour per kWp', brand: null, model: null, specification: null, unit: 'kw', base_price: 4000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  { id: '6', item_category: 'net_meter', item_description: 'Net Metering + TNEB Liaison', brand: null, model: null, specification: null, unit: 'lumpsum', base_price: 25000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
  { id: '7', item_category: 'civil_work', item_description: 'Civil Works (foundation, waterproofing)', brand: null, model: null, specification: null, unit: 'kw', base_price: 3000, gst_type: 'works_contract', gst_rate: 18, hsn_code: '99833' },
];

const MOCK_CORRECTIONS: CorrectionFactor[] = [
  { item_category: 'panel', system_type: null, segment: null, correction_factor: 1.0, data_points_count: 25 },
  { item_category: 'structure', system_type: null, segment: null, correction_factor: 1.085, data_points_count: 18 },
];

describe('generateBudgetaryBOM', () => {
  it('generates correct panel count for 10kWp with 540W panels', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 10,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const panelLine = result.find(l => l.item_category === 'panel');
    // 10000W / 540W = 18.5 → ceil to 19 panels
    expect(panelLine).toBeDefined();
    expect(panelLine!.quantity).toBe(19);
    expect(panelLine!.unit_price).toBe(16200);
  });

  it('applies elevated structure markup of 15%', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 10,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'elevated',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const structureLine = result.find(l => l.item_category === 'structure');
    // base 8500 * 1.15 = 9775
    expect(structureLine).toBeDefined();
    expect(structureLine!.unit_price).toBe(9775);
  });

  it('excludes liaison when includeLiaison is false', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 5,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: false,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const liaisonLine = result.find(l => l.item_category === 'net_meter');
    expect(liaisonLine).toBeUndefined();
  });

  it('excludes civil when includeCivil is false', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 5,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: false,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const civilLine = result.find(l => l.item_category === 'civil_work');
    expect(civilLine).toBeUndefined();
  });

  it('applies correction factor to raw cost', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 10,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const structureLine = result.find(l => l.item_category === 'structure');
    // raw = 8500 * 10 = 85000, correction = 1.085, corrected = 92225
    expect(structureLine!.raw_estimated_cost).toBe(85000);
    expect(structureLine!.correction_factor).toBe(1.085);
    expect(structureLine!.corrected_cost).toBe(92225);
  });

  it('does not include battery for on_grid', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 10,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const batteryLine = result.find(l => l.item_category === 'battery');
    expect(batteryLine).toBeUndefined();
  });

  it('includes battery for hybrid systems', () => {
    const priceBookWithBattery: PriceBookItem[] = [
      ...MOCK_PRICE_BOOK,
      { id: '8', item_category: 'battery', item_description: 'LFP Battery 5kWh', brand: 'BYD', model: 'HVS', specification: '5kWh', unit: 'nos', base_price: 150000, gst_type: 'supply', gst_rate: 5, hsn_code: '85076000' },
    ];
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 5,
      systemType: 'hybrid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, priceBookWithBattery, MOCK_CORRECTIONS);
    const batteryLine = result.find(l => l.item_category === 'battery');
    expect(batteryLine).toBeDefined();
    // 5 kWp × 2 kWh/kWp = 10 units
    expect(batteryLine!.quantity).toBe(10);
  });

  it('generates correct GST types (supply vs works_contract)', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 5,
      systemType: 'on_grid',
      segment: 'residential',
      structureType: 'flush_mount',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);

    const panelLine = result.find(l => l.item_category === 'panel');
    expect(panelLine!.gst_rate).toBe(5); // supply

    const structureLine = result.find(l => l.item_category === 'structure');
    expect(structureLine!.gst_rate).toBe(18); // works_contract
  });

  it('applies high_rise structure markup of 10%', () => {
    const input: BudgetaryQuoteInput = {
      systemSizeKwp: 10,
      systemType: 'on_grid',
      segment: 'commercial',
      structureType: 'high_rise',
      includeLiaison: true,
      includeCivil: true,
    };
    const result = generateBudgetaryBOM(input, MOCK_PRICE_BOOK, MOCK_CORRECTIONS);
    const structureLine = result.find(l => l.item_category === 'structure');
    // base 8500 * 1.10 = 9350
    expect(structureLine!.unit_price).toBe(9350);
  });
});
