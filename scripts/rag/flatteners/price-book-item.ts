/**
 * flatteners/price-book-item.ts — Flatten a price_book row into a RAG text chunk.
 *
 * Usage:
 *   import { flattenPriceBookItem } from './flatteners/price-book-item';
 *   const text = flattenPriceBookItem(priceBookRow);
 *
 * Only active items should be passed (callers filter is_active = true).
 */

// ── Input types ───────────────────────────────────────────────────────────────

export interface PriceBookItemRow {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  specification: string | null;
  unit: string;
  base_price: number | string;
  last_purchase_price: number | string | null;
  price_variance_pct: number | string | null;
  gst_type: string;
  gst_rate: number | string;
  hsn_code: string | null;
  effective_from: string;
  effective_until: string | null;
  update_recommended: boolean;
  is_active: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '₹0';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Main flattener ────────────────────────────────────────────────────────────

/**
 * flattenPriceBookItem — convert a price_book row into readable text.
 *
 * Output format:
 *   Price book item: {category} — {brand} {model}
 *   Description: {item_description}
 *   Specification: {specification}
 *   Unit: {unit} | Base price: ₹{base_price}/{unit} (excl. GST)
 *   GST: {gst_type} @ {gst_rate}% (HSN {hsn_code})
 *   Last purchase price: ₹{last_purchase_price} ({variance}% vs book)
 *   Effective: {from} to {until}
 *   Note: Price update recommended
 */
export function flattenPriceBookItem(row: PriceBookItemRow): string {
  // Header — category + brand/model
  const brandModel = [row.brand, row.model].filter(Boolean).join(' ');
  const categoryLabel = row.item_category.replace(/_/g, ' ');
  const header = `Price book item: ${categoryLabel} — ${brandModel || row.item_description}`;

  // Description
  const descLine = `Description: ${row.item_description}`;

  // Specification
  const specLine = row.specification ? `Specification: ${row.specification}` : '';

  // Pricing
  const basePrice = formatINR(row.base_price);
  const pricingLine = `Unit: ${row.unit} | Base price: ${basePrice}/${row.unit} (excl. GST)`;

  // GST
  const gstRate = parseFloat(String(row.gst_rate));
  const hsnPart = row.hsn_code ? ` (HSN ${row.hsn_code})` : '';
  const gstLine = `GST: ${row.gst_type.replace('_', ' ')} @ ${isNaN(gstRate) ? row.gst_rate : gstRate.toFixed(0)}%${hsnPart}`;

  // Last purchase + variance
  let lastPurchaseLine = '';
  if (row.last_purchase_price !== null && row.last_purchase_price !== undefined) {
    const lastPrice = formatINR(row.last_purchase_price);
    const variancePct = row.price_variance_pct !== null && row.price_variance_pct !== undefined
      ? parseFloat(String(row.price_variance_pct))
      : null;
    const variancePart = variancePct !== null && !isNaN(variancePct)
      ? ` (${variancePct > 0 ? '+' : ''}${variancePct.toFixed(1)}% vs book)`
      : '';
    lastPurchaseLine = `Last purchase price: ${lastPrice}${variancePart}`;
  }

  // Effective dates
  const effectiveFrom = formatDate(row.effective_from);
  const effectiveUntil = row.effective_until ? formatDate(row.effective_until) : 'ongoing';
  const effectiveLine = `Effective: ${effectiveFrom} to ${effectiveUntil}`;

  // Update warning
  const updateLine = row.update_recommended
    ? 'Note: Price update recommended (actual purchases consistently exceed book price)'
    : '';

  return [
    header,
    descLine,
    specLine,
    pricingLine,
    gstLine,
    lastPurchaseLine,
    effectiveLine,
    updateLine,
  ]
    .filter(Boolean)
    .join('\n');
}
