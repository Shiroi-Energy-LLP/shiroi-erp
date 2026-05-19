import type { Database } from '@repo/types/database';
import { STAGE_LABELS_SHORT } from '@/lib/leads-helpers';

type LeadStatus = Database['public']['Enums']['lead_status'];

/**
 * Per-status Tailwind class tokens.
 * Record<LeadStatus, ...> enforces compile-time exhaustiveness — adding a new
 * enum value will cause a TS error here until the palette entry is added.
 */
const STATUS_CLASSES: Record<LeadStatus, { bg: string; text: string; ring?: string }> = {
  new:                    { bg: 'bg-slate-100',   text: 'text-slate-700'  },
  contacted:              { bg: 'bg-blue-100',    text: 'text-blue-700'   },
  quick_quote_sent:       { bg: 'bg-cyan-100',    text: 'text-cyan-800'   },
  site_survey_scheduled:  { bg: 'bg-amber-50',    text: 'text-amber-700'  },
  site_survey_done:       { bg: 'bg-amber-100',   text: 'text-amber-800'  },
  design_in_progress:     { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  design_confirmed:       { bg: 'bg-indigo-200',  text: 'text-indigo-900' },
  detailed_proposal_sent: { bg: 'bg-violet-100',  text: 'text-violet-800' },
  proposal_sent:          { bg: 'bg-violet-50',   text: 'text-violet-600' },
  negotiation:            { bg: 'bg-orange-100',  text: 'text-orange-800' },
  closure_soon:           { bg: 'bg-emerald-50',  text: 'text-emerald-800', ring: 'ring-1 ring-emerald-300' },
  won:                    { bg: 'bg-emerald-200', text: 'text-emerald-900' },
  lost:                   { bg: 'bg-rose-100',    text: 'text-rose-700'   },
  on_hold:                { bg: 'bg-zinc-200',    text: 'text-zinc-700'   },
  disqualified:           { bg: 'bg-rose-50',     text: 'text-rose-900'   },
  converted:              { bg: 'bg-zinc-100',    text: 'text-zinc-600'   },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const { bg, text, ring } = STATUS_CLASSES[status];
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-[11px] font-medium tabular-nums whitespace-nowrap',
        'max-w-[140px] truncate',
        bg, text, ring ?? '',
      ].join(' ')}
    >
      {STAGE_LABELS_SHORT[status]}
    </span>
  );
}
