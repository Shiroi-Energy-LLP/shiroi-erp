// Manivel's 15 item categories — shared between server and client components.
// DO NOT add 'use client' here; this file must be importable by server components.
//
// This is the single source of truth for item categories across:
// - BOI (project_boq_items)
// - BOQ (project_boq_items)
// - Proposal BOM (proposal_bom_lines — accepts union per migration 057)
// - Price Book (price_book)
// - Delivery Challan (delivery_challan_items)

export const BOI_CATEGORIES = [
  { value: 'solar_panels',         label: 'Solar Panels' },
  { value: 'inverter',             label: 'Inverter' },
  { value: 'battery',              label: 'Battery' },
  { value: 'mms',                  label: 'MMS (Module Mounting Structure)' },
  { value: 'dc_accessories',       label: 'DC & Accessories' },
  { value: 'ac_accessories',       label: 'AC & Accessories' },
  { value: 'conduits',             label: 'Conduits' },
  { value: 'earthing_accessories', label: 'Earthing & Accessories' },
  { value: 'safety_accessories',   label: 'Safety & Accessories' },
  { value: 'generation_meter',     label: 'Generation Meter & Accessories' },
  { value: 'ic',                   label: 'I&C (Installation & Commissioning)' },
  { value: 'statutory_approvals',  label: 'Statutory Approvals' },
  { value: 'transport_civil',      label: 'Transport & Civil' },
  { value: 'miscellaneous',        label: 'Miscellaneous' },
  { value: 'others',               label: 'Others' },
] as const;

export type ItemCategory = typeof BOI_CATEGORIES[number]['value'];

export const ITEM_CATEGORY_VALUES: ReadonlyArray<ItemCategory> =
  BOI_CATEGORIES.map((c) => c.value);

export function getCategoryLabel(value: string): string {
  return BOI_CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}

/**
 * Maps a legacy category value to Manivel 15.
 *
 * Used by:
 * - scripts/import-price-book-from-gdrive.ts (row-by-row mapping)
 * - UI code that renders historical rows from proposal_bom_lines / purchase_order_items
 *   (those tables still hold legacy values per strategy C of migration 057)
 *
 * Returns the original value if already on Manivel 15 or not recognized.
 */
export function mapLegacyToManivel(legacy: string): ItemCategory | string {
  const map: Record<string, ItemCategory> = {
    panel: 'solar_panels',
    solar_panel: 'solar_panels',
    structure: 'mms',
    mounting_structure: 'mms',
    dc_cable: 'dc_accessories',
    dc_access: 'dc_accessories',
    dcdb: 'dc_accessories',
    connector: 'dc_accessories',
    junction_box: 'dc_accessories',
    ac_cable: 'ac_accessories',
    acdb: 'ac_accessories',
    lt_panel: 'ac_accessories',
    ht_cable: 'ac_accessories',
    ht_panel: 'ac_accessories',
    transformer: 'ac_accessories',
    bus_duct: 'ac_accessories',
    conduit: 'conduits',
    gi_cable_tray: 'conduits',
    earthing: 'earthing_accessories',
    earth_access: 'earthing_accessories',
    lightning_arrestor: 'earthing_accessories',
    safety_equipment: 'safety_accessories',
    walkway: 'safety_accessories',
    handrail: 'safety_accessories',
    net_meter: 'generation_meter',
    monitoring: 'generation_meter',
    installation_labour: 'ic',
    liaison: 'statutory_approvals',
    transport: 'transport_civil',
    civil_work: 'transport_civil',
    other: 'others',
  };
  return map[legacy] ?? legacy;
}
