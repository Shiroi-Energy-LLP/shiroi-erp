import { describe, it, expect } from 'vitest';
import { buildBoqItemDiff, type BoqItemSnapshot } from './boq-item-diff';

const CURRENT: BoqItemSnapshot = {
  item_description: 'Solar Panel 540Wp',
  brand: 'Adani',
  model: 'AS-540',
  quantity: 10,
  unit: 'Nos',
  unit_price: 11500,
  gst_rate: 12,
};

describe('buildBoqItemDiff', () => {
  it('returns empty diff when nothing changed', () => {
    expect(buildBoqItemDiff(CURRENT, { ...CURRENT })).toEqual({});
  });

  it('captures old and new for changed fields only', () => {
    const diff = buildBoqItemDiff(CURRENT, { ...CURRENT, quantity: 12, brand: 'Waaree' });
    expect(diff).toEqual({
      quantity: { old: 10, new: 12 },
      brand: { old: 'Adani', new: 'Waaree' },
    });
  });

  it('ignores undefined fields in the patch', () => {
    const diff = buildBoqItemDiff(CURRENT, { quantity: 12 });
    expect(Object.keys(diff)).toEqual(['quantity']);
  });

  it('treats numeric strings from the DB as numbers (NUMERIC columns)', () => {
    const current = { ...CURRENT, quantity: '10' as unknown as number };
    expect(buildBoqItemDiff(current, { quantity: 10 })).toEqual({});
  });

  it('normalizes empty strings to null for text fields', () => {
    const diff = buildBoqItemDiff(CURRENT, { model: '' });
    expect(diff).toEqual({ model: { old: 'AS-540', new: null } });
  });

  it('detects a change from null to a value', () => {
    const current = { ...CURRENT, brand: null };
    const diff = buildBoqItemDiff(current, { brand: 'Adani' });
    expect(diff).toEqual({ brand: { old: null, new: 'Adani' } });
  });
});
