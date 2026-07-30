// =============================================================================
// AMC constants — client-safe (NEVER-DO #21)
// =============================================================================
// No server imports. `'use client'` components import from here rather than
// from amc-actions.ts, so nothing drags the server Supabase client into a
// client bundle. amc-actions.ts may re-export from this file.
// =============================================================================

/** Mirrors the om_visit_schedules.status CHECK constraint (mig 005d). */
export const VISIT_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'missed', label: 'Missed' },
] as const;

export type VisitStatusVariant = 'success' | 'info' | 'warning' | 'error' | 'outline';

export function visitStatusVariant(status: string): VisitStatusVariant {
  switch (status) {
    case 'completed': return 'success';
    case 'scheduled': return 'info';
    case 'confirmed': return 'info';
    case 'rescheduled': return 'warning';
    case 'missed': return 'error';
    case 'cancelled': return 'outline';
    default: return 'outline';
  }
}

export const AMC_CATEGORY_LABELS: Record<string, string> = {
  free_amc: 'Free AMC',
  paid_amc: 'Paid AMC',
};

/** Contract-level statuses treated as "open" on the list page and detail header. */
export const AMC_OPEN_STATUSES = ['active', 'quoted'] as const;

/** Roles allowed to delete an AMC contract or an individual visit (mig 218). */
export const AMC_DELETE_ROLES = ['founder', 'om_technician', 'project_manager'] as const;
