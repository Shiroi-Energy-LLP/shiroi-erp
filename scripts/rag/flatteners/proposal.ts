/**
 * flatteners/proposal.ts — Flatten a proposals row into a RAG-ingestable text chunk.
 *
 * Usage:
 *   import { flattenProposal } from './flatteners/proposal';
 *   const text = flattenProposal(proposalRow, { lead, bomLines });
 */

// ── Input types (minimal — only the fields we use) ───────────────────────────

export interface ProposalRow {
  id: string;
  proposal_number: string;
  status: string;
  sent_at: string | null;
  accepted_at: string | null;
  system_size_kwp: number | string;
  system_type: string;
  structure_type: string | null;
  total_after_discount: number | string;
  discount_amount: number | string;
  gross_margin_pct: number | string;
  notes: string | null;
}

export interface LeadForProposal {
  customer_name: string;
  segment: string;
  city: string;
  state: string;
}

export interface BomLineForProposal {
  quantity: number | string;
  brand: string | null;
  model: string | null;
  unit: string;
  unit_price: number | string;
  item_description: string;
  scope_owner: string;
}

export interface ProposalRelated {
  lead: LeadForProposal;
  bomLines: BomLineForProposal[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '₹0';
  // Indian lakh/crore formatting
  const absN = Math.abs(n);
  if (absN >= 10_000_000) {
    return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  }
  if (absN >= 100_000) {
    return `₹${(n / 100_000).toFixed(2)}L`;
  }
  // Full number with Indian comma placement
  const parts = Math.abs(n).toFixed(0).split('');
  const result: string[] = [];
  parts.reverse().forEach((d, i) => {
    if (i === 3 || (i > 3 && (i - 3) % 2 === 0)) result.push(',');
    result.push(d);
  });
  return (n < 0 ? '-₹' : '₹') + result.reverse().join('');
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatBomLine(line: BomLineForProposal): string {
  const qty = parseFloat(String(line.quantity));
  const price = parseFloat(String(line.unit_price));
  const brand = line.brand ? `${line.brand} ` : '';
  const model = line.model ? `${line.model}` : line.item_description;
  const pricePart = isNaN(price) ? '' : ` @ ${formatINR(price)}/${line.unit}`;
  return `  - ${isNaN(qty) ? '' : qty + '× '}${brand}${model}${pricePart}`;
}

// ── Main flattener ────────────────────────────────────────────────────────────

/**
 * flattenProposal — convert a proposals row + related data into a
 * human-readable text suitable for RAG embedding.
 *
 * Output format matches the spec example:
 *   Proposal {number} ({status}, sent {date}, accepted {date})
 *   Customer: {name} ({segment})
 *   Location: {city}, {state}
 *   System: {kWp} kWp {system_type} {mounting}
 *   Total: ₹{total} (after ₹{discount} discount)
 *   BOM line items:
 *     - {qty}× {brand} {model} @ ₹{rate}
 *   Margin: {pct}%
 *   Notes: {notes}
 */
export function flattenProposal(row: ProposalRow, related: ProposalRelated): string {
  const { lead, bomLines } = related;

  // Header line
  const statusPart = row.status;
  const sentPart = row.sent_at ? `, sent ${formatDate(row.sent_at)}` : '';
  const acceptedPart = row.accepted_at ? `, accepted ${formatDate(row.accepted_at)}` : '';
  const header = `Proposal ${row.proposal_number} (${statusPart}${sentPart}${acceptedPart})`;

  // Customer
  const customerLine = `Customer: ${lead.customer_name} (${lead.segment})`;

  // Location
  const locationLine = `Location: ${lead.city}, ${lead.state}`;

  // System
  const kwp = parseFloat(String(row.system_size_kwp));
  const systemDesc = [
    !isNaN(kwp) ? `${kwp} kWp` : '',
    row.system_type.replace('_', '-'),
    row.structure_type ?? '',
  ].filter(Boolean).join(' ');
  const systemLine = `System: ${systemDesc}`;

  // Financial
  const total = formatINR(row.total_after_discount);
  const discount = parseFloat(String(row.discount_amount));
  const discountPart = !isNaN(discount) && discount > 0
    ? ` (after ${formatINR(discount)} discount)`
    : '';
  const totalLine = `Total: ${total}${discountPart}`;

  // BOM
  const shiroiBomLines = bomLines
    .filter((l) => l.scope_owner === 'shiroi')
    .map(formatBomLine);
  const clientBomLines = bomLines
    .filter((l) => l.scope_owner !== 'shiroi')
    .map((l) => formatBomLine(l) + ` [${l.scope_owner} scope]`);
  const allBomLines = [...shiroiBomLines, ...clientBomLines];

  const bomSection = allBomLines.length > 0
    ? `BOM line items:\n${allBomLines.join('\n')}`
    : 'BOM line items: (none recorded)';

  // Margin
  const marginPct = parseFloat(String(row.gross_margin_pct));
  const marginLine = !isNaN(marginPct) ? `Margin: ${marginPct.toFixed(1)}%` : '';

  // Notes
  const notesLine = row.notes && row.notes.trim() ? `Notes: ${row.notes.trim()}` : '';

  return [
    header,
    customerLine,
    locationLine,
    systemLine,
    totalLine,
    bomSection,
    marginLine,
    notesLine,
  ]
    .filter(Boolean)
    .join('\n');
}
