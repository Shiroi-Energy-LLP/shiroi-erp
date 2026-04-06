import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'on_hold', 'disqualified'],
  contacted: ['site_survey_scheduled', 'on_hold', 'disqualified'],
  site_survey_scheduled: ['site_survey_done', 'on_hold', 'disqualified'],
  site_survey_done: ['proposal_sent', 'on_hold', 'disqualified'],
  proposal_sent: ['design_confirmed', 'negotiation', 'on_hold', 'disqualified'],
  design_confirmed: ['negotiation', 'won', 'lost', 'on_hold', 'disqualified'],
  negotiation: ['won', 'lost', 'on_hold', 'disqualified'],
  won: [],
  lost: [],
  on_hold: ['new', 'contacted', 'site_survey_scheduled', 'site_survey_done', 'proposal_sent', 'design_confirmed', 'negotiation', 'disqualified'],
  disqualified: [],
  converted: [],
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

/** Default close probabilities by stage (can be overridden by user) */
export const DEFAULT_PROBABILITY: Partial<Record<LeadStatus, number>> = {
  new: 5,
  contacted: 10,
  site_survey_scheduled: 20,
  site_survey_done: 30,
  proposal_sent: 40,
  design_confirmed: 60,
  negotiation: 75,
  won: 100,
  lost: 0,
  on_hold: 10,
  disqualified: 0,
};
