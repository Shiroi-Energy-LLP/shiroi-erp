import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

/**
 * Lead status state machine.
 *
 * Scope rule: destination lists only contain statuses that appear on the
 * stepper bar (lead-stage-nav.tsx). Terminal/legacy values (disqualified,
 * converted, proposal_sent) are NOT offered as destinations in the dropdown
 * — they exist in the enum for historical data and for triggers, not for
 * user-driven transitions.
 *
 * Won fires an AFTER UPDATE trigger (fn_mark_proposal_accepted_on_lead_won,
 * migration 055) which cascades into the existing
 * create_project_from_accepted_proposal trigger, so flipping a lead to won
 * from ANY source status here auto-creates the project downstream.
 */
const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'on_hold'],
  contacted: ['quick_quote_sent', 'site_survey_scheduled', 'on_hold'],
  // Path A (Quick) — added by migration 051
  quick_quote_sent: ['negotiation', 'site_survey_scheduled', 'lost', 'on_hold'],
  // Path B (Detailed)
  site_survey_scheduled: ['site_survey_done', 'design_in_progress', 'on_hold'],
  site_survey_done: ['design_in_progress', 'on_hold'],
  design_in_progress: ['design_confirmed', 'on_hold'],
  design_confirmed: ['detailed_proposal_sent', 'design_in_progress', 'on_hold'],
  detailed_proposal_sent: ['negotiation', 'design_in_progress', 'lost', 'on_hold'],
  // Shared tail
  negotiation: ['closure_soon', 'won', 'lost', 'on_hold'],
  closure_soon: ['won', 'lost', 'negotiation', 'on_hold'],

  // ─── Legacy / terminal stages (not surfaced in the dropdown) ───
  // Historical rows may still be in proposal_sent; leave a forward path so
  // they can be moved out of it, but we don't offer proposal_sent as a
  // destination from anywhere.
  proposal_sent: ['detailed_proposal_sent', 'negotiation', 'on_hold'],
  won: [],
  converted: [],
  lost: [],
  // Resume from on_hold to any visible pipeline stage
  on_hold: [
    'new',
    'contacted',
    'quick_quote_sent',
    'site_survey_scheduled',
    'site_survey_done',
    'design_in_progress',
    'design_confirmed',
    'detailed_proposal_sent',
    'negotiation',
    'closure_soon',
  ],
  // disqualified is a terminal hidden state — no user-driven exit
  disqualified: [],
};

export function isValidTransition(from: LeadStatus, to: LeadStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

export function getValidNextStatuses(current: LeadStatus): LeadStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

/** Statuses that DON'T require a next follow-up date */
const TERMINAL_STATUSES: LeadStatus[] = ['won', 'lost', 'disqualified', 'converted'];

/**
 * Returns true if the given status requires a mandatory next follow-up date.
 */
export function requiresFollowUp(status: LeadStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

/**
 * Human-readable labels for every lead_status enum value.
 * Single source of truth — consumed by status-change.tsx, lead-stage-nav.tsx,
 * and any other UI surface that needs to display a stage name.
 */
export const STAGE_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  quick_quote_sent: 'Quick Quote Sent',
  site_survey_scheduled: 'Survey Scheduled',
  site_survey_done: 'Survey Done',
  design_in_progress: 'Design In Progress',
  design_confirmed: 'Design Confirmed',
  detailed_proposal_sent: 'Detailed Proposal Sent',
  proposal_sent: 'Proposal Sent (legacy)',
  negotiation: 'Negotiation',
  closure_soon: 'Closure Soon',
  won: 'Won',
  converted: 'Converted',
  lost: 'Lost',
  on_hold: 'On Hold',
  disqualified: 'Disqualified',
};

/** Default close probabilities by stage (can be overridden by user) */
export const DEFAULT_PROBABILITY: Partial<Record<LeadStatus, number>> = {
  new: 5,
  contacted: 10,
  quick_quote_sent: 45,
  site_survey_scheduled: 20,
  site_survey_done: 30,
  design_in_progress: 40,
  proposal_sent: 40,
  design_confirmed: 55,
  detailed_proposal_sent: 65,
  negotiation: 75,
  closure_soon: 90,
  won: 100,
  lost: 0,
  on_hold: 10,
  disqualified: 0,
};
