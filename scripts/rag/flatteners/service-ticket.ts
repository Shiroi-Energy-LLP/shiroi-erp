/**
 * flatteners/service-ticket.ts — Flatten an om_service_tickets row into a RAG text chunk.
 *
 * Usage:
 *   import { flattenServiceTicket } from './flatteners/service-ticket';
 *   const text = flattenServiceTicket(ticketRow, { project, tags });
 */

// ── Input types ───────────────────────────────────────────────────────────────

export interface ServiceTicketRow {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  issue_type: string;
  severity: string;
  status: string;
  sla_hours: number | null;
  sla_breached: boolean;
  resolved_at: string | null;
  resolution_notes: string | null;
  parts_used: boolean;
  parts_cost: number | string;
  is_warranty_claim: boolean;
  recurring_fault: boolean;
  created_at: string;
}

export interface ProjectForTicket {
  project_number: string;
  customer_name: string;
  segment: string;
  system_size_kwp?: number | string | null;
}

export interface TicketRelated {
  project: ProjectForTicket;
  /** Optional: resolved technician name */
  resolvedByName?: string;
  /** Optional: inferred tags from issue_type + keywords */
  tags?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatINR(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n) || n === 0) return '₹0';
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function deriveTags(row: ServiceTicketRow, extraTags: string[]): string {
  const derived = [row.issue_type.replace(/_/g, ' ')];
  if (row.is_warranty_claim) derived.push('warranty');
  if (row.sla_breached) derived.push('sla-breach');
  if (row.recurring_fault) derived.push('recurring');
  if (row.parts_used) derived.push('parts-replaced');
  return [...derived, ...extraTags].join(', ');
}

// ── Main flattener ────────────────────────────────────────────────────────────

/**
 * flattenServiceTicket — convert an om_service_tickets row into readable text.
 *
 * Output format:
 *   Ticket {number} ({status}, resolved {date})
 *   Project: {project_number} ({customer} — {segment}, {kWp} kWp)
 *   Severity: {severity} | SLA: {sla_hours}h {breached?}
 *   Issue: {title}
 *   Description: {description}
 *   Resolution: {resolution_notes}
 *   Parts used: {parts_used} (₹{parts_cost})
 *   Tags: {tags}
 */
export function flattenServiceTicket(row: ServiceTicketRow, related: TicketRelated): string {
  const { project } = related;

  // Header
  const resolvedPart = row.resolved_at ? `, resolved ${formatDate(row.resolved_at)}` : '';
  const header = `Ticket ${row.ticket_number} (${row.status}${resolvedPart})`;

  // Project
  const kwpStr = project.system_size_kwp
    ? `, ${parseFloat(String(project.system_size_kwp))} kWp`
    : '';
  const projectLine = `Project: ${project.project_number} (${project.customer_name} — ${project.segment}${kwpStr})`;

  // Severity + SLA
  const slaBreachStr = row.sla_breached ? ' *** SLA BREACHED ***' : '';
  const slaHrsStr = row.sla_hours ? `${row.sla_hours}h` : 'N/A';
  const slaMeta = `Severity: ${row.severity} | SLA: ${slaHrsStr}${slaBreachStr}`;

  // Issue summary
  const issueLine = `Issue: ${row.title}`;
  const descLine = `Description: ${row.description.trim()}`;

  // Resolution
  const resolutionLine = row.resolution_notes
    ? `Resolution: ${row.resolution_notes.trim()}`
    : (row.status === 'resolved' ? 'Resolution: (no notes recorded)' : '');

  // Parts
  const partsCost = parseFloat(String(row.parts_cost));
  const partsLine = row.parts_used
    ? `Parts used: yes (${formatINR(partsCost)})${row.is_warranty_claim ? ' — warranty claim' : ''}`
    : 'Parts used: no';

  // Tags
  const tagsStr = deriveTags(row, related.tags ?? []);
  const tagsLine = `Tags: ${tagsStr}`;

  return [
    header,
    projectLine,
    slaMeta,
    issueLine,
    descLine,
    resolutionLine,
    partsLine,
    tagsLine,
  ]
    .filter(Boolean)
    .join('\n');
}
