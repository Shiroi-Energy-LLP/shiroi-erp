import { describe, it, expect } from 'vitest';
import {
  BOI_CATEGORIES,
  ITEM_CATEGORY_VALUES,
  getCategoryLabel,
  mapLegacyToManivel,
  type ItemCategory,
} from './boi-constants';

describe('BOI_CATEGORIES', () => {
  it('has exactly 15 entries', () => {
    expect(BOI_CATEGORIES).toHaveLength(15);
  });

  it('includes Battery (the new #15)', () => {
    const values = BOI_CATEGORIES.map((c) => c.value);
    expect(values).toContain('battery');
  });

  it('labels I&C as Installation & Commissioning (not Instrumentation & Control)', () => {
    const ic = BOI_CATEGORIES.find((c) => c.value === 'ic');
    expect(ic?.label).toBe('I&C (Installation & Commissioning)');
  });

  it('has no duplicate values', () => {
    const values = BOI_CATEGORIES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('ITEM_CATEGORY_VALUES', () => {
  it('contains the same values as BOI_CATEGORIES', () => {
    expect(ITEM_CATEGORY_VALUES).toEqual(BOI_CATEGORIES.map((c) => c.value));
  });
});

describe('getCategoryLabel', () => {
  it('returns the correct label for a known value', () => {
    expect(getCategoryLabel('solar_panels')).toBe('Solar Panels');
    expect(getCategoryLabel('mms')).toBe('MMS (Module Mounting Structure)');
    expect(getCategoryLabel('ic')).toBe('I&C (Installation & Commissioning)');
  });

  it('falls back to a human-readable form for an unknown value', () => {
    expect(getCategoryLabel('foo_bar')).toBe('foo bar');
  });
});

describe('mapLegacyToManivel', () => {
  it('maps legacy solar panel variants to solar_panels', () => {
    expect(mapLegacyToManivel('panel')).toBe('solar_panels');
    expect(mapLegacyToManivel('solar_panel')).toBe('solar_panels');
  });

  it('maps structure variants to mms', () => {
    expect(mapLegacyToManivel('structure')).toBe('mms');
    expect(mapLegacyToManivel('mounting_structure')).toBe('mms');
  });

  it('collapses all DC-side BOS to dc_accessories', () => {
    expect(mapLegacyToManivel('dc_cable')).toBe('dc_accessories');
    expect(mapLegacyToManivel('dc_access')).toBe('dc_accessories');
    expect(mapLegacyToManivel('dcdb')).toBe('dc_accessories');
    expect(mapLegacyToManivel('connector')).toBe('dc_accessories');
    expect(mapLegacyToManivel('junction_box')).toBe('dc_accessories');
  });

  it('collapses all AC-side BOS to ac_accessories', () => {
    expect(mapLegacyToManivel('ac_cable')).toBe('ac_accessories');
    expect(mapLegacyToManivel('acdb')).toBe('ac_accessories');
    expect(mapLegacyToManivel('lt_panel')).toBe('ac_accessories');
    expect(mapLegacyToManivel('ht_cable')).toBe('ac_accessories');
    expect(mapLegacyToManivel('transformer')).toBe('ac_accessories');
  });

  it('maps gi_cable_tray to conduits (Vivek correction)', () => {
    expect(mapLegacyToManivel('gi_cable_tray')).toBe('conduits');
    expect(mapLegacyToManivel('conduit')).toBe('conduits');
  });

  it('maps lightning_arrestor to earthing_accessories (Vivek correction)', () => {
    expect(mapLegacyToManivel('lightning_arrestor')).toBe('earthing_accessories');
    expect(mapLegacyToManivel('earthing')).toBe('earthing_accessories');
    expect(mapLegacyToManivel('earth_access')).toBe('earthing_accessories');
  });

  it('maps installation_labour to ic (Installation & Commissioning)', () => {
    expect(mapLegacyToManivel('installation_labour')).toBe('ic');
  });

  it('maps liaison to statutory_approvals', () => {
    expect(mapLegacyToManivel('liaison')).toBe('statutory_approvals');
  });

  it('collapses transport and civil_work to transport_civil', () => {
    expect(mapLegacyToManivel('transport')).toBe('transport_civil');
    expect(mapLegacyToManivel('civil_work')).toBe('transport_civil');
  });

  it('maps singular "other" to plural "others"', () => {
    expect(mapLegacyToManivel('other')).toBe('others');
  });

  it('passes Manivel values through unchanged', () => {
    const manivelValues: ItemCategory[] = [
      'solar_panels', 'inverter', 'battery', 'mms', 'dc_accessories',
      'ac_accessories', 'conduits', 'earthing_accessories', 'safety_accessories',
      'generation_meter', 'ic', 'statutory_approvals', 'transport_civil',
      'miscellaneous', 'others',
    ];
    for (const v of manivelValues) {
      expect(mapLegacyToManivel(v)).toBe(v);
    }
  });

  it('passes unknown values through unchanged', () => {
    expect(mapLegacyToManivel('something_made_up')).toBe('something_made_up');
  });
});
