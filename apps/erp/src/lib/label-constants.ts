// Centralized label / option maps — single source of truth. No 'use server',
// no server imports → safe to import from client components (NEVER-DO #21).
// Consolidated 2026-06-18 from duplicated per-file copies (redundancy sweep).
import type { Database } from '@repo/types/database';

type SystemType = Database['public']['Enums']['system_type'];

// ── System type — "On Grid" / "Off Grid" (no hyphen), per Vivek 2026-06-18 ──
export const SYSTEM_TYPE_OPTIONS: { value: SystemType; label: string }[] = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];
export const SYSTEM_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// ── Leave types (HR) — long form, per Vivek 2026-06-18 ──
export const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  earned: 'Earned Leave',
  maternity: 'Maternity Leave',
  paternity: 'Paternity Leave',
  compensatory: 'Comp Off',
  loss_of_pay: 'Loss of Pay',
  other: 'Other',
};

// ── WhatsApp-import chat profiles ──
export const WHATSAPP_PROFILE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  llp: 'LLP / Purchase',
  shiroi_energy: 'Shiroi Energy ⚡',
  site: 'Site',
};

// ── Execution milestones ──
export const MILESTONE_LABELS: Record<string, string> = {
  material_delivery: 'Material Delivery',
  structure_installation: 'Structure Installation',
  panel_installation: 'Panel Installation',
  electrical_work: 'Electrical Work',
  earthing_work: 'Earthing Work',
  civil_work: 'Civil Work',
  testing_commissioning: 'Testing & Commissioning',
  net_metering: 'Net Metering',
  handover: 'Handover',
  follow_ups: 'Follow-ups',
};

// ── BOQ item procurement status (labels only; colours deferred with status-map work) ──
export const BOQ_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'yet_to_finalize', label: 'Yet to Finalize' },
  { value: 'yet_to_place', label: 'Yet to Place' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'received', label: 'Received' },
  { value: 'ready_to_dispatch', label: 'Ready to Dispatch' },
  { value: 'delivered', label: 'Delivered' },
];
export const BOQ_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  BOQ_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);
