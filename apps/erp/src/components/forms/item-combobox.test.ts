import { describe, it, expect } from 'vitest';
import { filterAndRank, type ItemSuggestion } from './item-combobox-filter';

const SAMPLE: ItemSuggestion[] = [
  { description: 'Waree 540Wp Mono PERC WSMD-540', category: 'solar_panels', unit: 'Nos', base_price: 13500, source: 'price_book' },
  { description: 'Solar Panel 540W Adani Mono', category: 'solar_panels', unit: 'Nos', base_price: 14200, source: 'price_book' },
  { description: 'Sungrow SG50CX 50kW Inverter', category: 'inverter', unit: 'Nos', base_price: 325000, source: 'price_book' },
  { description: 'Polycab 4 sq mm DC Cable Red', category: 'dc_accessories', unit: 'Meter', base_price: 35, source: 'price_book' },
  { description: 'Polycab 4 sq mm DC Cable Black', category: 'dc_accessories', unit: 'Meter', base_price: 35, source: 'boq' },
  { description: 'Havells 40A DC Isolator', category: 'dc_accessories', unit: 'Nos', base_price: 1200, source: 'boq' },
  { description: 'MC4 Connector Pair', category: 'dc_accessories', unit: 'Pair', base_price: 45, source: 'price_book' },
];

describe('filterAndRank', () => {
  it('returns the top N suggestions when query is empty', () => {
    const result = filterAndRank('', SAMPLE, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(SAMPLE[0]);
  });

  it('ranks exact prefix matches highest', () => {
    const result = filterAndRank('waree', SAMPLE);
    expect(result[0]?.description).toContain('Waree');
  });

  it('finds substring matches when no prefix matches', () => {
    const result = filterAndRank('sungrow', SAMPLE);
    expect(result[0]?.description).toContain('Sungrow');
  });

  it('falls back to Jaccard token overlap', () => {
    // "dc cable polycab" — no single word matches as prefix/substring of a full desc
    const result = filterAndRank('dc cable polycab', SAMPLE);
    expect(result.length).toBeGreaterThan(0);
    const top = result[0]?.description ?? '';
    expect(top.toLowerCase()).toMatch(/polycab.*dc cable|dc cable.*polycab/);
  });

  it('prefers Price Book over BOQ when scores tie', () => {
    // "Polycab 4 sq mm DC Cable" appears in both price_book (Red) and boq (Black).
    // They should tie on substring score; Price Book wins via +5 bonus.
    const result = filterAndRank('polycab 4 sq mm', SAMPLE);
    expect(result[0]?.source).toBe('price_book');
  });

  it('respects the limit parameter', () => {
    const result = filterAndRank('', SAMPLE, 3);
    expect(result).toHaveLength(3);
  });

  it('returns zero results when nothing matches', () => {
    const result = filterAndRank('completely-unrelated-xyz', SAMPLE);
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const lower = filterAndRank('waree', SAMPLE);
    const upper = filterAndRank('WAREE', SAMPLE);
    const mixed = filterAndRank('WaReE', SAMPLE);
    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
  });

  it('handles whitespace-only query like empty query', () => {
    const result = filterAndRank('   ', SAMPLE, 5);
    expect(result).toHaveLength(5);
  });
});
