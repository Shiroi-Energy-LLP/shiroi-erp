// scripts/zoho-import/normalize.ts
// Canonicalize names for fuzzy matching.
const SUFFIXES = [
  'pvt ltd', 'pvt. ltd', 'private limited', 'private ltd',
  'p ltd', 'p. ltd', 'llp', 'ltd', 'inc', 'co',
];

export function normalizeName(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[.,()\/\-_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const sfx of SUFFIXES) {
    s = s.replace(new RegExp(`\\b${sfx}\\b`, 'g'), '');
  }
  // Strip sizing suffixes like "- 10kW", "10 kWp", "10kw"
  s = s.replace(/[-\s]+\d+(\.\d+)?\s*k\s*w\s*p?\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function tokens(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(t => t.length >= 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter(t => b.has(t)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

export function extractKwp(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*k\s*w\s*p?\b/i);
  return m ? Number(m[1]) : null;
}

/** Days between two YYYY-MM-DD dates (b - a). Null input → null. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

/** Map Zoho payment Mode → ERP payment_method enum. Falls back to 'bank_transfer'. */
export function mapPaymentMode(mode: unknown): 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd' {
  const m = String(mode ?? '').toLowerCase().trim();
  if (!m) return 'bank_transfer';
  if (m.includes('upi') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) return 'upi';
  if (m.includes('cheque') || m.includes('check')) return 'cheque';
  if (m.includes('cash')) return 'cash';
  if (m === 'dd' || m.includes('demand draft')) return 'dd';
  // NEFT, RTGS, Wire, Bank Transfer, IMPS, etc.
  return 'bank_transfer';
}
