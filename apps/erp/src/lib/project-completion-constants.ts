/**
 * project-completion-constants.ts
 *
 * Constants + types for the C9 completion checklist. **No server imports** —
 * safe to use from `'use client'` components. Mirrors the pattern in
 * `documents-constants.ts` and `dc-certificate-constants.ts`.
 */

import type { Database } from '@repo/types/database';

export type CompletionItemRow = Database['public']['Tables']['project_completion_items']['Row'];
export type CompletionComponent = CompletionItemRow['component'];

// Component weights (must match the SQL RPC `get_project_completion_pct`).
export const COMPONENT_WEIGHTS: Record<CompletionComponent, number> = {
  site_preparation: 5,
  structure_mounting: 20,
  panel_installation: 25,
  dc_wiring: 10,
  inverter_installation: 15,
  ac_wiring: 10,
  earthing: 5,
  net_metering_applied: 5,
  commissioning: 5,
  handover: 0, // milestone only, not weighted
};

export const COMPONENT_LABELS: Record<CompletionComponent, string> = {
  site_preparation: 'Site Preparation',
  structure_mounting: 'Structure Mounting',
  panel_installation: 'Panel Installation',
  dc_wiring: 'DC Wiring',
  inverter_installation: 'Inverter Installation',
  ac_wiring: 'AC Wiring',
  earthing: 'Earthing',
  net_metering_applied: 'Net Metering Applied',
  commissioning: 'Commissioning',
  handover: 'Handover',
};

export const COMPONENT_ORDER: CompletionComponent[] = [
  'site_preparation',
  'structure_mounting',
  'panel_installation',
  'dc_wiring',
  'inverter_installation',
  'ac_wiring',
  'earthing',
  'net_metering_applied',
  'commissioning',
  'handover',
];
