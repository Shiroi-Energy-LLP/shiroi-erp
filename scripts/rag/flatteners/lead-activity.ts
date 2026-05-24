/**
 * flatteners/lead-activity.ts — Flatten a lead_activities row into a RAG text chunk.
 *
 * Usage:
 *   import { flattenLeadActivity } from './flatteners/lead-activity';
 *   const text = flattenLeadActivity(activityRow, { lead });
 *
 * Skip rows where the combined text is < 50 chars (caller's responsibility after calling this,
 * but we also enforce a minimum meaningful output).
 */

// ── Input types ───────────────────────────────────────────────────────────────

export interface LeadActivityRow {
  id: string;
  lead_id: string;
  activity_type: string;
  summary: string;
  outcome: string | null;
  activity_date: string;  // 'YYYY-MM-DD' TEXT
  duration_minutes: number | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
}

export interface LeadForActivity {
  customer_name: string;
  segment: string;
  city: string;
  status: string;
  estimated_size_kwp?: number | string | null;
  source?: string | null;
}

export interface LeadActivityRelated {
  lead: LeadForActivity;
  /** Name of the employee who performed the activity */
  performedByName?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatActivityDate(dateStr: string): string {
  // dateStr is 'YYYY-MM-DD' TEXT from DB
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Main flattener ────────────────────────────────────────────────────────────

/**
 * flattenLeadActivity — convert a lead_activities row into readable text.
 *
 * Output format:
 *   Lead activity ({type}) — {date}
 *   Customer: {name} ({segment}, {city}, ~{kWp} kWp)
 *   Lead status: {status} | Source: {source}
 *   Summary: {summary}
 *   Outcome: {outcome}
 *   Duration: {minutes} min
 *   Next action: {next_action} by {next_action_date}
 *
 * Returns '' for activities where combined text < 50 chars so callers can skip.
 */
export function flattenLeadActivity(row: LeadActivityRow, related: LeadActivityRelated): string {
  const { lead } = related;

  // Header
  const actType = row.activity_type.replace(/_/g, ' ');
  const header = `Lead activity (${actType}) — ${formatActivityDate(row.activity_date)}`;

  // Customer
  const kwpStr = lead.estimated_size_kwp
    ? `, ~${parseFloat(String(lead.estimated_size_kwp))} kWp`
    : '';
  const customerLine = `Customer: ${lead.customer_name} (${lead.segment}, ${lead.city}${kwpStr})`;

  // Lead status
  const sourcePart = lead.source ? ` | Source: ${lead.source.replace(/_/g, ' ')}` : '';
  const statusLine = `Lead status: ${lead.status.replace(/_/g, ' ')}${sourcePart}`;

  // Performed by
  const performedByLine = related.performedByName
    ? `Performed by: ${related.performedByName}`
    : '';

  // Content
  const summaryLine = row.summary.trim() ? `Summary: ${row.summary.trim()}` : '';
  const outcomeLine = row.outcome ? `Outcome: ${row.outcome.trim()}` : '';

  // Duration
  const durationLine = row.duration_minutes
    ? `Duration: ${row.duration_minutes} min`
    : '';

  // Next action
  const nextActionLine = row.next_action
    ? `Next action: ${row.next_action.trim()}${row.next_action_date ? ` by ${formatActivityDate(row.next_action_date)}` : ''}`
    : '';

  const parts = [
    header,
    customerLine,
    statusLine,
    performedByLine,
    summaryLine,
    outcomeLine,
    durationLine,
    nextActionLine,
  ].filter(Boolean);

  const result = parts.join('\n');

  // Enforce minimum signal — if the content portion is too short, signal skip
  const contentLength = [row.summary, row.outcome ?? ''].join(' ').trim().length;
  if (contentLength < 50) return '';

  return result;
}
