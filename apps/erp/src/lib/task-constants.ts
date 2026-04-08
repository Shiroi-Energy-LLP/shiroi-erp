// ── Task Categories (matching milestone categories + general) ──
// Extracted from tasks-actions.ts because 'use server' files
// can only export async functions, not objects/constants.

export const TASK_CATEGORIES = [
  { value: 'advance_payment', label: 'Advance Payment' },
  { value: 'material_delivery', label: 'Material Delivery' },
  { value: 'structure_installation', label: 'Structure Installation' },
  { value: 'panel_installation', label: 'Panel Installation' },
  { value: 'electrical_work', label: 'Electrical Work' },
  { value: 'testing_commissioning', label: 'Testing & Commissioning' },
  { value: 'civil_work', label: 'Civil Work' },
  { value: 'net_metering', label: 'Net Metering' },
  { value: 'handover', label: 'Handover' },
  { value: 'general', label: 'General' },
] as const;
