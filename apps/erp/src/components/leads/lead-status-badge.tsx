import type { Database } from '@repo/types/database';
import { STAGE_LABELS_SHORT } from '@/lib/leads-helpers';

type LeadStatus = Database['public']['Enums']['lead_status'];

/**
 * Per-status inline colour pairs (background / text).
 * Record<LeadStatus, ...> enforces compile-time exhaustiveness — adding a new
 * enum value will cause a TS error here until the palette entry is added.
 * Colours are taken verbatim from the Stream-E spec (marketing feedback round 2).
 */
const STATUS_PALETTE: Record<LeadStatus, { bg: string; text: string }> = {
  new:                    { bg: '#EFF6FF', text: '#1E40AF' },
  contacted:              { bg: '#F1F3F5', text: '#3F424D' },
  quick_quote_sent:       { bg: '#FFF7ED', text: '#9A3412' },
  site_survey_scheduled:  { bg: '#FEF3C7', text: '#92400E' },
  site_survey_done:       { bg: '#FEF9C3', text: '#854D0E' },
  design_in_progress:     { bg: '#EDE9FE', text: '#5B21B6' },
  design_confirmed:       { bg: '#E0E7FF', text: '#3730A3' },
  detailed_proposal_sent: { bg: '#FCE7F3', text: '#9D174D' },
  proposal_sent:          { bg: '#FCE7F3', text: '#9D174D' }, // legacy — same as detailed_proposal_sent
  negotiation:            { bg: '#FFE4E6', text: '#9F1239' },
  closure_soon:           { bg: '#FFEDD5', text: '#9A3412' },
  won:                    { bg: '#DCFCE7', text: '#166534' },
  lost:                   { bg: '#FEE2E2', text: '#991B1B' },
  on_hold:                { bg: '#F1F3F5', text: '#6B7280' },
  disqualified:           { bg: '#F1F3F5', text: '#6B7280' }, // same as on_hold
  converted:              { bg: '#F1F3F5', text: '#6B7280' }, // same as on_hold
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const { bg, text } = STATUS_PALETTE[status];
  return (
    <span
      className="inline-flex items-center rounded-full h-5 px-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: bg, color: text }}
    >
      {STAGE_LABELS_SHORT[status]}
    </span>
  );
}
