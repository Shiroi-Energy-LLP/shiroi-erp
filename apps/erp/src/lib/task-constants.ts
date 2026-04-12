// ── Task Categories (aligned with execution_milestones_master table) ──
// Extracted from tasks-actions.ts because 'use server' files
// can only export async functions, not objects/constants.

export const TASK_CATEGORIES = [
  { value: 'material_delivery', label: 'Material Delivery' },
  { value: 'structure_installation', label: 'Structure Installation' },
  { value: 'panel_installation', label: 'Panel Installation' },
  { value: 'electrical_work', label: 'Electrical Work' },
  { value: 'earthing_work', label: 'Earthing Work' },
  { value: 'civil_work', label: 'Civil Work' },
  { value: 'testing_commissioning', label: 'Testing & Commissioning' },
  { value: 'net_metering', label: 'Net Metering' },
  { value: 'handover', label: 'Handover' },
  { value: 'follow_ups', label: 'Follow-ups' },
  { value: 'general', label: 'General' },
] as const;
