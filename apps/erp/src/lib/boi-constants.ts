// Manivel's 14 BOI categories — shared between server and client components
// DO NOT add 'use client' here — this must be importable by server components

export const BOI_CATEGORIES: { value: string; label: string }[] = [
  { value: 'solar_panels', label: 'Solar Panels' },
  { value: 'inverter', label: 'Inverter' },
  { value: 'mms', label: 'MMS (Module Mounting Structure)' },
  { value: 'dc_accessories', label: 'DC & Accessories' },
  { value: 'ac_accessories', label: 'AC & Accessories' },
  { value: 'conduits', label: 'Conduits' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
  { value: 'safety_accessories', label: 'Safety & Accessories' },
  { value: 'earthing_accessories', label: 'Earthing & Accessories' },
  { value: 'generation_meter', label: 'Generation Meter & Accessories' },
  { value: 'ic', label: 'I&C (Instrumentation & Control)' },
  { value: 'statutory_approvals', label: 'Statutory Approvals' },
  { value: 'transport_civil', label: 'Transport & Civil' },
  { value: 'others', label: 'Others' },
];

export function getCategoryLabel(value: string): string {
  return BOI_CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}
