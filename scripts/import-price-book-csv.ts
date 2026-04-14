/**
 * Import Manivel's 217-item price book from a local CSV export of the Google Sheet.
 *
 * The source sheet at
 *   https://docs.google.com/spreadsheets/d/1cUOOWQmM5DIeAyM9POv3KCXiTiB7VtUbwEoG33OwKNs/
 * is private (requires Google login), so this script reads a CSV file exported
 * locally by the founder. Download the sheet as CSV and pass its path as the
 * first argument.
 *
 * Expected CSV columns (header row required, case-insensitive match):
 *   Category | Items | Make | Qty | Units | Rate/Unit | Vendor
 *
 * Usage:
 *   npx tsx scripts/import-price-book-csv.ts path/to/price-book.csv
 *   npx tsx scripts/import-price-book-csv.ts path/to/price-book.csv --dry-run
 *
 * Items with empty or zero Rate/Unit are inserted with base_price = 0 and will
 * display a "Rate pending" badge on /price-book.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const csvPath = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');

if (!csvPath || csvPath.startsWith('--')) {
  console.error('Usage: npx tsx scripts/import-price-book-csv.ts <csv-file> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`CSV file not found: ${csvPath}`);
  process.exit(1);
}

// Category display label → DB enum value
// Matches the 22-category CHECK constraint from migration 046.
const CATEGORY_MAP: Record<string, string> = {
  panel: 'solar_panel',
  'solar panel': 'solar_panel',
  inverter: 'inverter',
  battery: 'battery',
  structure: 'mounting_structure',
  'mounting structure': 'mounting_structure',
  'dc cable': 'dc_cable',
  'dc & access': 'dc_access',
  'dc access': 'dc_access',
  'ac cable': 'ac_cable',
  dcdb: 'dcdb',
  acdb: 'acdb',
  'lt panel': 'lt_panel',
  conduit: 'conduit',
  earthing: 'earthing',
  'earth & access': 'earth_access',
  'earth access': 'earth_access',
  'net meter': 'net_meter',
  'civil work': 'civil_work',
  'installation labour': 'installation_labour',
  'installation & labour': 'installation_labour',
  labour: 'installation_labour',
  transport: 'transport',
  miscellaneous: 'miscellaneous',
  misc: 'miscellaneous',
  walkway: 'walkway',
  'gi cable tray': 'gi_cable_tray',
  'cable tray': 'gi_cable_tray',
  handrail: 'handrail',
  other: 'other',
};

function mapCategory(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CATEGORY_MAP[key] ?? 'other';
}

/**
 * Minimal CSV parser — handles quoted fields with embedded commas and
 * escaped double quotes (""). No RFC 4180 edge cases beyond that.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      cur.push(field);
      field = '';
      if (cur.length > 1 || (cur.length === 1 && cur[0]!.length > 0)) rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

function parseNumber(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[₹,\s]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

interface PriceBookRow {
  item_category: string;
  item_description: string;
  brand: string | null;
  unit: string;
  base_price: number;
  gst_rate: number;
  gst_type: 'supply' | 'service' | 'inclusive' | 'exclusive';
  vendor_name: string | null;
  default_qty: number;
  is_active: boolean;
  effective_from: string;
}

async function main() {
  console.log(`[import-price-book] Reading ${csvPath}`);
  const text = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(text);

  if (rows.length < 2) {
    console.error('CSV has no data rows');
    process.exit(1);
  }

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const colIdx = {
    category: header.findIndex((h) => h === 'category'),
    item: header.findIndex((h) => h === 'items' || h === 'item'),
    make: header.findIndex((h) => h === 'make' || h === 'brand'),
    qty: header.findIndex((h) => h === 'qty' || h === 'quantity'),
    unit: header.findIndex((h) => h === 'units' || h === 'unit'),
    rate: header.findIndex((h) => h === 'rate/unit' || h === 'rate' || h === 'price'),
    vendor: header.findIndex((h) => h === 'vendor' || h === 'vendor_name'),
  };

  if (colIdx.category === -1 || colIdx.item === -1) {
    console.error('CSV missing required columns: Category and Items');
    console.error('Detected header:', header);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const records: PriceBookRow[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cat = (row[colIdx.category] ?? '').trim();
    const item = (row[colIdx.item] ?? '').trim();
    if (!cat || !item) {
      skipped++;
      continue;
    }

    records.push({
      item_category: mapCategory(cat),
      item_description: item,
      brand: colIdx.make >= 0 ? (row[colIdx.make] ?? '').trim() || null : null,
      unit: (colIdx.unit >= 0 ? (row[colIdx.unit] ?? '').trim() : '') || 'Nos',
      base_price: colIdx.rate >= 0 ? parseNumber(row[colIdx.rate] ?? '') : 0,
      gst_rate: 18,
      gst_type: 'supply',
      vendor_name: colIdx.vendor >= 0 ? (row[colIdx.vendor] ?? '').trim() || null : null,
      default_qty: colIdx.qty >= 0 ? parseNumber(row[colIdx.qty] ?? '') || 1 : 1,
      is_active: true,
      effective_from: today,
    });
  }

  console.log(`[import-price-book] Parsed ${records.length} records (${skipped} empty rows skipped)`);

  // Summary by category
  const byCategory: Record<string, number> = {};
  for (const rec of records) byCategory[rec.item_category] = (byCategory[rec.item_category] ?? 0) + 1;
  console.log('[import-price-book] Records by category:');
  for (const [cat, n] of Object.entries(byCategory).sort()) {
    console.log(`  ${cat.padEnd(22)} ${n}`);
  }

  const withRate = records.filter((r) => r.base_price > 0).length;
  console.log(`[import-price-book] ${withRate} with rate, ${records.length - withRate} rate-pending`);

  if (isDryRun) {
    console.log('[import-price-book] --dry-run: no database writes performed');
    console.log('[import-price-book] First 3 records:');
    console.log(JSON.stringify(records.slice(0, 3), null, 2));
    return;
  }

  // Insert in batches of 100
  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from('price_book').insert(batch);
    if (error) {
      console.error(`[import-price-book] Batch ${i / batchSize + 1} failed:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`[import-price-book] Inserted ${inserted}/${records.length}`);
  }

  console.log(`[import-price-book] Done — ${inserted} items inserted`);
}

main().catch((err) => {
  console.error('[import-price-book] Failed:', err);
  process.exit(1);
});
