'use client';

/**
 * Types, constants, factories, and the TotalLine JSX helper for the
 * Proposal Wizard. Shared by all four step components + the main shell.
 *
 * Split out of proposal-wizard.tsx (1,024 LOC) to keep every file under
 * the 500-LOC rule.
 */
import { formatINR } from '@repo/ui/formatters';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Enum types from the database schema
// ═══════════════════════════════════════════════════════════════════════

export type SystemType = Database['public']['Enums']['system_type'];
export type GSTType = Database['public']['Enums']['gst_type'];
export type ScopeOwner = Database['public']['Enums']['scope_owner'];

// ═══════════════════════════════════════════════════════════════════════
// Wizard-input shapes
// ═══════════════════════════════════════════════════════════════════════

export interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  city: string | null;
  segment: string;
  system_type: SystemType | null;
  estimated_size_kwp: number | null;
}

export interface BOMLineInput {
  key: string;
  item_category: string;
  item_description: string;
  brand: string;
  model: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_type: GSTType;
  scope_owner: ScopeOwner;
}

export interface MilestoneInput {
  key: string;
  milestone_name: string;
  percentage: number;
  due_trigger: string;
  custom_trigger_description: string;
  invoice_type: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

export const STEPS = [
  'Lead & System',
  'Bill of Materials',
  'Payment Schedule',
  'Review',
] as const;

export const SYSTEM_TYPES: { value: SystemType; label: string }[] = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];

export const SCOPE_OWNERS: { value: ScopeOwner; label: string }[] = [
  { value: 'shiroi', label: 'Shiroi' },
  { value: 'client', label: 'Client' },
  { value: 'builder', label: 'Builder' },
  { value: 'excluded', label: 'Excluded' },
];

export const CATEGORIES = [
  'Solar Panels',
  'Inverter',
  'Battery',
  'Mounting Structure',
  'Electrical',
  'Civil Works',
  'Labour',
  'Net Metering',
  'Safety Equipment',
  'Other',
];

export const DEFAULT_TRIGGERS = [
  'On booking',
  'On material delivery',
  'On structure erection',
  'On panel mounting',
  'On commissioning',
  'On net metering approval',
];

// ═══════════════════════════════════════════════════════════════════════
// Factory helpers
// ═══════════════════════════════════════════════════════════════════════

export function createBOMLine(): BOMLineInput {
  return {
    key: crypto.randomUUID(),
    item_category: 'Solar Panels',
    item_description: '',
    brand: '',
    model: '',
    hsn_code: '',
    quantity: 1,
    unit: 'Nos',
    unit_price: 0,
    gst_type: 'supply',
    scope_owner: 'shiroi',
  };
}

export function createMilestone(): MilestoneInput {
  return {
    key: crypto.randomUUID(),
    milestone_name: '',
    percentage: 0,
    due_trigger: DEFAULT_TRIGGERS[0] ?? 'On booking',
    custom_trigger_description: '',
    invoice_type: '',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TotalLine — shared currency row used in StepBOM and StepReview
// ═══════════════════════════════════════════════════════════════════════

export function TotalLine({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-base' : ''}`}>
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`font-mono ${bold ? 'text-n-900' : ''}`}>{formatINR(value)}</span>
    </div>
  );
}
