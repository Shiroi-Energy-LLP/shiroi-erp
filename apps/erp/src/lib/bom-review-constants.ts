// =============================================================================
// BOM Review display constants — client-safe (NEVER-DO #21)
// =============================================================================
// No server imports. Lives apart from bom-review-queries.ts so the
// 'use client' table can import the label map without dragging the server
// Supabase client into the client bundle.
// =============================================================================

export const BOM_CATEGORY_LABELS: Record<string, string> = {
  panel: 'Panel', inverter: 'Inverter', battery: 'Battery', structure: 'Structure',
  dc_cable: 'DC Cable', ac_cable: 'AC Cable', conduit: 'Conduit', earthing: 'Earthing',
  acdb: 'ACDB', dcdb: 'DCDB', net_meter: 'Net Meter', civil_work: 'Civil Work',
  installation_labour: 'I&C Labour', transport: 'Transport', other: 'Other',
  solar_panels: 'Solar Panels', mms: 'MMS', dc_accessories: 'DC Acc.',
  ac_accessories: 'AC Acc.', conduits: 'Conduits', miscellaneous: 'Misc',
  safety: 'Safety', generation_meter: 'Gen Meter',
  installation_and_commissioning: 'I&C', statutory: 'Statutory',
  transport_and_civil: 'Transport & Civil', others: 'Others',
};

export function bomCategoryLabel(category: string): string {
  return BOM_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}
