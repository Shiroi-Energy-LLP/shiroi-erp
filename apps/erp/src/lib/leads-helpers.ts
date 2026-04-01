import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'on_hold', 'disqualified'],
  contacted: ['site_survey_scheduled', 'on_hold', 'disqualified'],
  site_survey_scheduled: ['site_survey_done', 'on_hold', 'disqualified'],
  site_survey_done: ['proposal_sent', 'on_hold', 'disqualified'],
  proposal_sent: ['negotiation', 'on_hold', 'disqualified'],
  negotiation: ['won', 'lost', 'on_hold', 'disqualified'],
  won: [],
  lost: [],
  on_hold: ['new', 'contacted', 'site_survey_scheduled', 'site_survey_done', 'proposal_sent', 'negotiation', 'disqualified'],
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
