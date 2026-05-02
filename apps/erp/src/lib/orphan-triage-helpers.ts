// apps/erp/src/lib/orphan-triage-helpers.ts
import Decimal from 'decimal.js';

const STOPWORDS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'shri', 'sri', 'sree', 'm', 's', 'mss',
  'pvt', 'private', 'ltd', 'limited', 'pl', 'plc', 'inc', 'co', 'company',
  'corp', 'corporation', 'and', 'enterprises', 'enterprise',
  'projects', 'project', 'group', 'holdings', 'holding', 'india', 'indian',
  'p', 'the', 'of', 'kw', 'kwp',
]);

export function isMeaningfulToken(t: string): boolean {
  if (!t) return false;
  if (t.length < 2) return false;
  if (STOPWORDS.has(t.toLowerCase())) return false;
  return true;
}

export function normalizeZohoName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Format a Decimal as Indian-style number string with 2 decimal places. */
function formatIndian(d: Decimal): string {
  const [intPart, decPart] = d.toFixed(2).split('.');
  // Indian grouping: last 3 digits, then groups of 2
  const intStr = intPart.replace(/\B(?=(\d{2})+(?!\d)(\d{3})$)|(?<=\d)(?=(\d{3})$)/g, ',');
  // Use Intl for correctness
  const num = parseFloat(d.toFixed(2));
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted;
}

export function summarizeLinkedPayments(payments: Array<{ amount: string | number }>): string {
  if (payments.length === 0) return 'No linked payments';
  const total = payments.reduce(
    (acc, p) => acc.plus(new Decimal(p.amount ?? 0)),
    new Decimal(0),
  );
  const formatted = formatIndian(total);
  return `${payments.length} payment${payments.length === 1 ? '' : 's'} · ₹${formatted}`;
}
