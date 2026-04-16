/**
 * Import Manivel's 217-item Price Book DIRECTLY from Google Sheets.
 *
 * Reuses the existing `shiroi-migaration` service account key that the earlier
 * Google Drive sync scripts already use. No CSV export required.
 *
 * Usage:
 *   npx tsx scripts/import-price-book-from-gdrive.ts            # dry-run (default, no DB writes)
 *   npx tsx scripts/import-price-book-from-gdrive.ts --commit   # actually insert
 *
 * Source sheet:
 *   https://docs.google.com/spreadsheets/d/1cUOOWQmM5DIeAyM9POv3KCXiTiB7VtUbwEoG33OwKNs/
 *   Owner: manivel@shiroienergy.com
 *   Parent folder: "Shiroi Energy LLP - Projects"
 *
 * Expected headers (row 1), case + whitespace insensitive:
 *   S.NO | Category | Items | Make | Qty | Units | Rate / Units | Vendor
 *
 * Items with blank / zero rate are inserted with base_price = 0 and will
 * render the amber "Rate pending" badge on /price-book.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const SHEET_ID = '1cUOOWQmM5DIeAyM9POv3KCXiTiB7VtUbwEoG33OwKNs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const COMMIT = process.argv.includes('--commit');

// Manivel's sheet header labels → Manivel 15 vocabulary.
// Keeps the quirky spellings (e.g. "Misscellaneous") that exist in the master sheet.
const CATEGORY_MAP: Record<string, string> = {
  'panel': 'solar_panels',
  'solar panel': 'solar_panels',
  'solar panels': 'solar_panels', // Manivel's current sheet wording
  'inverter': 'inverter',
  'battery': 'battery',
  'structure': 'mms',
  'mounting structure': 'mms',
  'mms': 'mms',
  'dc cable': 'dc_accessories',
  'dc & access': 'dc_accessories',
  'dc access': 'dc_accessories',
  'dc & accessories': 'dc_accessories', // Manivel's current sheet wording
  'dc accessories': 'dc_accessories',
  'dcdb': 'dc_accessories',
  'ac cable': 'ac_accessories',
  'ac & access': 'ac_accessories',
  'ac access': 'ac_accessories',
  'ac & accessories': 'ac_accessories', // Manivel's current sheet wording
  'ac accessories': 'ac_accessories',
  'acdb': 'ac_accessories',
  'lt panel': 'ac_accessories',
  'conduit': 'conduits',
  'conduits': 'conduits',
  'gi cable tray': 'conduits',
  'cable tray': 'conduits',
  'earthing': 'earthing_accessories',
  'earth & access': 'earthing_accessories',
  'earth access': 'earthing_accessories',
  'earthing & accessories': 'earthing_accessories', // Manivel's current sheet wording
  'earthing accessories': 'earthing_accessories',
  'safety': 'safety_accessories',
  'safety & access': 'safety_accessories',
  'safety access': 'safety_accessories',
  'safety & accessories': 'safety_accessories', // Manivel's current sheet wording
  'safety accessories': 'safety_accessories',
  'walkway': 'safety_accessories',
  'handrail': 'safety_accessories',
  'net meter': 'generation_meter',
  'generation meter': 'generation_meter',
  'civil work': 'transport_civil',
  'transport': 'transport_civil',
  'transport & civil': 'transport_civil',
  'transport / civil': 'transport_civil',
  'installation labour': 'ic',
  'installation & labour': 'ic',
  'installation & commissioning': 'ic',
  'installation and commissioning': 'ic',
  'i & c': 'ic',
  'ic': 'ic',
  'labour': 'ic',
  'statutory': 'statutory_approvals',
  'statutory approval': 'statutory_approvals',
  'statutory approvals': 'statutory_approvals',
  'approval': 'statutory_approvals',
  'approvals': 'statutory_approvals',
  'miscellaneous': 'miscellaneous',
  'misscellaneous': 'miscellaneous', // Manivel's spelling in the master sheet
  'misc': 'miscellaneous',
  'other': 'others',
  'others': 'others',
};

function mapCategory(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CATEGORY_MAP[key] ?? 'others';
}

function parseNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(/[₹,\s]/g, '').trim();
  if (!s || s === '-') return 0;
  const n = parseFloat(s);
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
  const op = '[import-price-book-from-gdrive]';
  console.log(`${op} Mode: ${COMMIT ? 'COMMIT (will insert)' : 'DRY-RUN (no DB writes)'}`);
  console.log(`${op} Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}/`);

  // 1) Google Sheets auth
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 2) Read first tab (flexible range)
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const firstTabTitle = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${firstTabTitle}!A1:J1000`,
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) {
    console.error(`${op} Sheet has no data rows`);
    process.exit(1);
  }
  console.log(`${op} Read ${rows.length} raw rows from tab "${firstTabTitle}"`);

  // 3) Locate columns by flexible header matching
  const headerRow = (rows[0] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
  const findCol = (...candidates: string[]): number => {
    for (const cand of candidates) {
      const idx = headerRow.findIndex((h) => h === cand);
      if (idx !== -1) return idx;
    }
    // loose contains fallback
    for (const cand of candidates) {
      const idx = headerRow.findIndex((h) => h.includes(cand));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const colIdx = {
    category: findCol('category'),
    item: findCol('items', 'item', 'description'),
    make: findCol('make', 'brand'),
    qty: findCol('qty', 'quantity'),
    unit: findCol('units', 'unit'),
    rate: findCol('rate / units', 'rate/unit', 'rate / unit', 'rate', 'price'),
    vendor: findCol('vendor', 'vendor_name', 'vendor name'),
  };
  console.log(`${op} Detected columns:`, colIdx);
  if (colIdx.category === -1 || colIdx.item === -1) {
    console.error(`${op} Missing required columns. Header row was:`, headerRow);
    process.exit(1);
  }

  // 4) Parse data rows
  const today = new Date().toISOString().slice(0, 10);
  const records: PriceBookRow[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cat = String(row[colIdx.category] ?? '').trim();
    const item = String(row[colIdx.item] ?? '').trim();
    if (!cat || !item) {
      skipped++;
      continue;
    }
    records.push({
      item_category: mapCategory(cat),
      item_description: item,
      brand: colIdx.make >= 0 ? String(row[colIdx.make] ?? '').trim() || null : null,
      unit: (colIdx.unit >= 0 ? String(row[colIdx.unit] ?? '').trim() : '') || 'Nos',
      base_price: colIdx.rate >= 0 ? parseNumber(row[colIdx.rate]) : 0,
      gst_rate: 18,
      gst_type: 'supply',
      vendor_name: colIdx.vendor >= 0 ? String(row[colIdx.vendor] ?? '').trim() || null : null,
      default_qty: colIdx.qty >= 0 ? parseNumber(row[colIdx.qty]) || 1 : 1,
      is_active: true,
      effective_from: today,
    });
  }
  console.log(`${op} Parsed ${records.length} records (${skipped} blank rows skipped)`);

  // 5) Summary
  const byCategory: Record<string, number> = {};
  for (const rec of records) {
    byCategory[rec.item_category] = (byCategory[rec.item_category] ?? 0) + 1;
  }
  console.log(`${op} Records by DB category:`);
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(24)} ${n}`);
  }
  const withRate = records.filter((r) => r.base_price > 0).length;
  console.log(`${op} ${withRate} with rate, ${records.length - withRate} rate-pending`);

  // Diagnostic: show which raw category strings mapped to each DB category
  const rawToMapped: Record<string, Set<string>> = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawCat = String(row[colIdx.category] ?? '').trim();
    const item = String(row[colIdx.item] ?? '').trim();
    if (!rawCat || !item) continue;
    const mapped = mapCategory(rawCat);
    (rawToMapped[mapped] ??= new Set()).add(rawCat);
  }
  console.log(`${op} Raw → DB category mapping:`);
  for (const [mapped, rawSet] of Object.entries(rawToMapped).sort()) {
    console.log(`  ${mapped}: ${Array.from(rawSet).join(' | ')}`);
  }

  // Show a few sample records
  console.log(`${op} Sample records (first 3):`);
  console.log(JSON.stringify(records.slice(0, 3), null, 2));

  if (!COMMIT) {
    console.log(`\n${op} DRY-RUN complete. No DB writes performed.`);
    console.log(`${op} Re-run with --commit to insert into price_book.`);
    return;
  }

  // 6) Commit — read-then-partition upsert.
  //
  // Migration 057 originally created a 2-col unique index on
  // (item_description, item_category). Migration 058 corrected the domain
  // model: Price Book identity is actually a 4-tuple
  // (item_description, item_category, brand, vendor_name) because Manivel
  // stocks the same spec from multiple vendors at different rates. So 058
  // dropped the 2-col index and built a 4-col *partial* index
  // (... WHERE deleted_at IS NULL).
  //
  // Postgres ON CONFLICT against a partial unique index requires re-stating
  // the index's WHERE predicate in the INSERT statement, which supabase-js
  // does not expose through its `upsert(..., { onConflict })` API. Workaround:
  // fetch the active rows once, build a map keyed on the 4-tuple, then
  // partition sheet records into UPDATE-by-id and INSERT. supabase.upsert()
  // with only the id set uses the primary key as the conflict target, which
  // is a plain (non-partial) unique constraint — no predicate needed.
  //
  // rate_updated_by = null distinguishes bulk imports from manual UI edits
  // in the audit trail.
  console.log(`\n${op} Fetching existing active price_book rows...`);
  type ExistingRow = {
    id: string;
    item_description: string;
    item_category: string;
    brand: string | null;
    vendor_name: string | null;
  };
  const { data: existing, error: fetchErr } = await supabase
    .from('price_book')
    .select('id, item_description, item_category, brand, vendor_name')
    .is('deleted_at', null)
    .returns<ExistingRow[]>();
  if (fetchErr) {
    console.error(`${op} Failed to fetch existing rows:`, fetchErr.message);
    process.exit(1);
  }
  console.log(`${op} Found ${existing?.length ?? 0} active rows.`);

  const identityKey = (
    desc: string,
    cat: string,
    brand: string | null,
    vendor: string | null,
  ): string =>
    `${desc.trim()}||${cat}||${(brand ?? '').trim()}||${(vendor ?? '').trim()}`;

  const existingMap = new Map<string, string>();
  for (const row of existing ?? []) {
    existingMap.set(
      identityKey(row.item_description, row.item_category, row.brand, row.vendor_name),
      row.id,
    );
  }

  type UpdateRow = PriceBookRow & { id: string };
  const toUpdate: UpdateRow[] = [];
  const toInsert: PriceBookRow[] = [];
  for (const r of records) {
    const id = existingMap.get(identityKey(r.item_description, r.item_category, r.brand, r.vendor_name));
    if (id) toUpdate.push({ ...r, id });
    else toInsert.push(r);
  }
  console.log(`${op} ${toUpdate.length} to update, ${toInsert.length} to insert.`);

  const nowIso = new Date().toISOString();
  const batchSize = 100;

  // Updates — upsert by id (primary key, always unique, no partial-index issue)
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = toUpdate.slice(i, i + batchSize).map((r) => ({
      ...r,
      rate_updated_at: nowIso,
      rate_updated_by: null,
    }));
    const { error } = await supabase.from('price_book').upsert(batch as never);
    if (error) {
      console.error(`${op} Update batch ${i / batchSize + 1} failed:`, error.message);
      process.exit(1);
    }
    updated += batch.length;
    console.log(`${op} Updated ${updated}/${toUpdate.length}`);
  }

  // Inserts — plain batched insert
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize).map((r) => ({
      ...r,
      rate_updated_at: nowIso,
      rate_updated_by: null,
    }));
    const { error } = await supabase.from('price_book').insert(batch as never);
    if (error) {
      console.error(`${op} Insert batch ${i / batchSize + 1} failed:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`${op} Inserted ${inserted}/${toInsert.length}`);
  }

  console.log(`${op} Done — ${updated} updated, ${inserted} inserted.`);
}

main().catch((err) => {
  console.error('[import-price-book-from-gdrive] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
