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

export function summarizeLinkedPayments(payments: Array<{ amount: string | number }>): string {
  if (payments.length === 0) return 'No linked payments';
  const total = payments.reduce(
    (acc, p) => acc.plus(new Decimal(p.amount ?? 0)),
    new Decimal(0),
  );
  // Indian comma grouping (en-IN locale: lakhs/crores).
  const formatted = parseFloat(total.toFixed(2)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${payments.length} payment${payments.length === 1 ? '' : 's'} · ₹${formatted}`;
}
