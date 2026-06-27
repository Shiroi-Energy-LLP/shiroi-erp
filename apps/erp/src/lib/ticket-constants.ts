// Shared service-ticket option lists + label maps. No server imports — safe to
// import from both server pages and `'use client'` components (NEVER-DO #21).

export const ISSUE_TYPES = [
  { value: 'no_generation', label: 'No Generation' },
  { value: 'low_generation', label: 'Low Generation' },
  { value: 'inverter_fault', label: 'Inverter Fault' },
  { value: 'panel_damage', label: 'Panel Damage' },
  { value: 'wiring_issue', label: 'Wiring Issue' },
  { value: 'earthing_issue', label: 'Earthing Issue' },
  { value: 'monitoring_offline', label: 'Monitoring Offline' },
  { value: 'physical_damage', label: 'Physical Damage' },
  { value: 'warranty_claim', label: 'Warranty Claim' },
  { value: 'billing_issue', label: 'Billing Issue' },
  { value: 'other', label: 'Other' },
] as const;

export const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical (4h SLA)' },
] as const;

export const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'escalated', label: 'Escalated' },
] as const;

export function issueTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return ISSUE_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function severityVariant(severity: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (severity) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'outline';
  }
}
