/**
 * import-price-list-2026-27.ts
 *
 * Imports Vivek's "Price List - 26-27.xlsx" into `price_book`.
 *
 * The sheet is the FY26-27 vendor rate card: 214 rows of
 * (Category, Item, Make, Unit, Rate, Gst, Vendor). It is the authoritative
 * rate source going forward; the existing 235 live price_book rows were
 * imported in April 2026 from an older sheet and carry inconsistent wording
 * (e.g. "3.5C, 95 sq mm Aluminium Aromoured Cable" vs
 * "3.5C,95 Sq.mm Aluminium Armoured Cable" — both live, same item).
 *
 * Matching strategy: normalize (item_category, item_description, brand) and
 * join. Normalization folds the known spelling/spacing variants so the April
 * rows line up with the new sheet instead of producing 214 duplicates.
 *
 * Usage:
 *   pnpm tsx scripts/import-price-list-2026-27.ts            # dry run, writes report
 *   pnpm tsx scripts/import-price-list-2026-27.ts --apply    # writes to DEV db
 *
 * Dev only. Never point this at prod.
 */

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SHEET_PATH = 'C:/Users/vivek/OneDrive/Desktop/Price List - 26-27.xlsx';
const REPORT_PATH = path.resolve(__dirname, 'data/price-list-2026-27-diff.md');
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } }
);

// ---------------------------------------------------------------------------
// Category mapping: sheet label → item_categories.value
// ---------------------------------------------------------------------------
const CATEGORY_MAP: Record<string, string> = {
  'solar panel': 'solar_panels',
  inverter: 'inverter',
  'dc & accessories': 'dc_accessories',
  'ac & accessories': 'ac_accessories',
  conduits: 'conduits',
  'earth & accessories': 'earthing_accessories',
  'earth & access': 'earthing_accessories',
  'safety & accessories': 'safety_accessories',
  miscellaneous: 'miscellaneous',
  walkway: 'miscellaneous',
  handrail: 'miscellaneous',
};

// ---------------------------------------------------------------------------
// Description normalization — folds the wording drift between the April import
// and this sheet so the same physical item matches.
// ---------------------------------------------------------------------------
function normDesc(raw: string): string {
  let s = (raw ?? '').toLowerCase();
  s = s.replace(/[\u2018\u2019\u201c\u201d]/g, '"');
  // unit spellings
  s = s.replace(/sq\s*\.?\s*mm/g, 'sqmm');
  s = s.replace(/\bsq\b/g, 'sqmm');
  // common misspellings in the legacy rows
  s = s.replace(/aromoured|armoured|armored/g, 'armoured');
  s = s.replace(/aluminum|aluminium|alluminium/g, 'aluminium');
  s = s.replace(/\bcu\b/g, 'copper');
  s = s.replace(/\bal\b/g, 'aluminium');
  s = s.replace(/\bwp\b/g, 'wp');
  s = s.replace(/\bkw\b/g, 'kw');
  s = s.replace(/\bnon[\s-]*dcr\b/g, 'ndcr');
  s = s.replace(/\bmono\s*perc\b/g, 'monoperc');
  s = s.replace(/\btopcon\b/g, 'topcon');
  s = s.replace(/\bdcdb\b/g, 'dcdb');
  s = s.replace(/\bspd\b/g, 'spd');
  // strip everything non-alphanumeric, collapse
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}

function normBrand(raw: string | null): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

// ---------------------------------------------------------------------------
// Fuzzy pairing — the April rows and this sheet describe the same items with
// different word order ("4C, 25 Sq.mm Copper Flexible Cable" vs
// "4C, 25 sq mm Copper Cable flexible"). Exact-key matching misses those.
//
// Gate: the numeric tokens of one description must be a sub-multiset of the
// other's. This is what stops "4 In 4 Out ... 1000V" pairing with
// "6 in 6 out ... 1000V" while still allowing "1 In 1 Out with MC4 and 600V"
// to pair with "1 in 1 out DCDB ... 600V" (the extra 4 comes from "MC4").
// Ranked by Dice coefficient over word tokens.
// ---------------------------------------------------------------------------
// Read numbers off the RAW description, not the normalized one — normalization
// strips the decimal point, which would make 1.5" and 1" look identical.
function numTokens(raw: string): string[] {
  return (raw.toLowerCase().match(/\d+(?:\.\d+)?/g) ?? [])
    .map((t) => String(Number.parseFloat(t)))
    .sort();
}

function wordTokens(norm: string): Set<string> {
  return new Set(norm.split(' ').filter(Boolean));
}

function isSubMultiset(a: string[], b: string[]): boolean {
  const counts = new Map<string, number>();
  for (const t of b) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of a) {
    const c = counts.get(t) ?? 0;
    if (c === 0) return false;
    counts.set(t, c - 1);
  }
  return true;
}

function dice(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/**
 * Material / spec words that identify a DIFFERENT product rather than a
 * re-wording. Raw word overlap isn't enough on its own: "4.8 mm thick, 400 mm
 * length SS Cable tie" (₹450, steel) scores higher against
 * "400 mm Length * 4.8 mm Thick UV Rated PVC Cable tie" (₹225) than the actual
 * match "400 * 4.8 UV rated cable tie" (₹220) does — the steel tie just happens
 * to share more filler words. Each token present on one side only costs the
 * pair some score.
 */
const DISCRIMINATING = new Set([
  'ss', 'uv', 'pvc', 'copper', 'aluminium', 'gi', 'rcc',
  'dcr', 'ndcr', 'bifacial', 'monofacial', 'topcon', 'monoperc',
  'spike', 'chemical', 'elevated',
]);
const DISCRIMINATING_PENALTY = 0.12;

function scorePair(a: Set<string>, b: Set<string>): number {
  let penalty = 0;
  for (const t of DISCRIMINATING) {
    if (a.has(t) !== b.has(t)) penalty += DISCRIMINATING_PENALTY;
  }
  return dice(a, b) - penalty;
}

const FUZZY_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Parse the sheet
// ---------------------------------------------------------------------------
type SheetRow = {
  sno: number;
  rowNum: number;
  sheetCategory: string;
  category: string;
  description: string;
  brand: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  vendor: string | null;
  key: string;
};

function cellNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in (v as object)) {
    return cellNumber((v as { result: unknown }).result);
  }
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'result' in (v as object)) {
    return cellText((v as { result: unknown }).result);
  }
  if (typeof v === 'object' && v !== null && 'richText' in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return String(v).trim();
}

async function parseSheet(): Promise<SheetRow[]> {
  const op = '[parseSheet]';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET_PATH);
  const ws = wb.getWorksheet('Sheet1');
  if (!ws) throw new Error(`${op} Sheet1 not found`);

  const rows: SheetRow[] = [];
  // Header on row 3 (B..I): S. No | Category | Item | Make | Unit | Rate | Gst | Vendor
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sno = cellNumber(row.getCell(2).value);
    const sheetCategory = cellText(row.getCell(3).value);
    const description = cellText(row.getCell(4).value).replace(/\s+/g, ' ').trim();
    const brand = cellText(row.getCell(5).value).replace(/\s+/g, ' ').trim() || null;
    const unit = cellText(row.getCell(6).value).replace(/\s+/g, ' ').trim();
    const rate = cellNumber(row.getCell(7).value);
    const gstFraction = cellNumber(row.getCell(8).value);
    const vendor = cellText(row.getCell(9).value).replace(/\s+/g, ' ').trim() || null;

    if (!sheetCategory && !description) continue;

    const category = CATEGORY_MAP[sheetCategory.toLowerCase().trim()];
    if (!category) {
      console.warn(`${op} row ${r}: unmapped category "${sheetCategory}" — skipped`);
      continue;
    }

    rows.push({
      sno,
      rowNum: r,
      sheetCategory,
      category,
      description,
      brand,
      unit,
      rate,
      // sheet stores 0.05 / 0.18 → percent
      gstRate: Math.round(gstFraction * 10000) / 100,
      vendor,
      key: `${category}||${normDesc(description)}||${normBrand(brand)}`,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Load current live price_book
// ---------------------------------------------------------------------------
type DbRow = {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  unit: string;
  base_price: string;
  gst_rate: string;
  vendor_name: string | null;
  is_active: boolean;
  key: string;
};

async function loadPriceBook(): Promise<DbRow[]> {
  const op = '[loadPriceBook]';
  const { data, error } = await supabase
    .from('price_book')
    .select('id, item_category, item_description, brand, unit, base_price, gst_rate, vendor_name, is_active')
    .is('deleted_at', null)
    .order('item_category');

  if (error) {
    console.error(`${op} query failed`, { error, timestamp: new Date().toISOString() });
    process.exit(1);
  }
  if (!data) {
    console.error(`${op} no data returned`, { timestamp: new Date().toISOString() });
    process.exit(1);
  }

  return data.map((d) => ({
    ...d,
    key: `${d.item_category}||${normDesc(d.item_description)}||${normBrand(d.brand)}`,
  })) as DbRow[];
}

/**
 * How many BOM / BOQ / PO / accuracy rows point at each candidate id.
 * A duplicate that is already referenced must be the survivor.
 */
async function loadRefCounts(ids: string[]): Promise<Map<string, number>> {
  const op = '[loadRefCounts]';
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;

  const tables = [
    'proposal_bom_lines',
    'project_boq_items',
    'purchase_order_items',
    'price_book_accuracy',
  ] as const;

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('price_book_id')
      .in('price_book_id', ids);

    if (error) {
      console.error(`${op} ${table} lookup failed`, {
        table,
        error,
        timestamp: new Date().toISOString(),
      });
      process.exit(1);
    }
    if (!data) continue;

    for (const r of data as { price_book_id: string | null }[]) {
      if (!r.price_book_id) continue;
      counts.set(r.price_book_id, (counts.get(r.price_book_id) ?? 0) + 1);
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const sheet = await parseSheet();
  const db = await loadPriceBook();

  const dbByKey = new Map<string, DbRow[]>();
  for (const d of db) {
    const arr = dbByKey.get(d.key) ?? [];
    arr.push(d);
    dbByKey.set(d.key, arr);
  }

  const matchedIds = new Set<string>();
  const priceChanges: { s: SheetRow; d: DbRow; old: number; next: number }[] = [];
  const unchanged: { s: SheetRow; d: DbRow }[] = [];
  const ambiguous: { s: SheetRow; ds: DbRow[] }[] = [];
  const newItems: SheetRow[] = [];
  const zeroRate: SheetRow[] = [];

  for (const s of sheet) {
    if (s.rate === 0) zeroRate.push(s);
    const hits = dbByKey.get(s.key) ?? [];
    if (hits.length === 0) {
      newItems.push(s);
      continue;
    }
    if (hits.length > 1) ambiguous.push({ s, ds: hits });
    for (const d of hits) matchedIds.add(d.id);
    const d = hits[0]!;
    const old = Number.parseFloat(d.base_price);
    if (Math.abs(old - s.rate) >= 0.005) priceChanges.push({ s, d, old, next: s.rate });
    else unchanged.push({ s, d });
  }

  // ---- fuzzy second pass over the leftovers ------------------------------
  // Greedy global assignment: score every (sheet, db) candidate pair that
  // clears the numeric gate, then walk them best-first. A db row can only be
  // claimed once; a sheet row may claim several (that's how the April-import
  // duplicates get folded into one group). First claim wins = canonical.
  const leftoverDb = db.filter((d) => !matchedIds.has(d.id));
  const pairs: { s: SheetRow; d: DbRow; score: number }[] = [];

  for (const s of newItems) {
    const sWords = wordTokens(normDesc(s.description));
    const sNums = numTokens(s.description);
    for (const d of leftoverDb) {
      if (d.item_category !== s.category) continue;
      const dNums = numTokens(d.item_description);
      if (!isSubMultiset(sNums, dNums) && !isSubMultiset(dNums, sNums)) continue;
      const score = scorePair(sWords, wordTokens(normDesc(d.item_description)));
      if (score >= FUZZY_THRESHOLD) pairs.push({ s, d, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const fuzzy: { s: SheetRow; d: DbRow; score: number }[] = [];
  const fuzzyUsedDb = new Set<string>();
  const claimedSheet = new Set<number>();

  // Exactly one live row per sheet row here. Letting a sheet row claim several
  // at this stage collapsed genuinely distinct variants (the 2-in-2-out DCDB
  // at ₹4,875 and the 2-Nos-SPD version at ₹5,285 both resemble either sheet
  // row). Duplicates are folded in below by a stricter test.
  for (const p of pairs) {
    if (fuzzyUsedDb.has(p.d.id) || claimedSheet.has(p.s.sno)) continue;
    fuzzyUsedDb.add(p.d.id);
    claimedSheet.add(p.s.sno);
    fuzzy.push(p);
  }

  const stillNew = newItems.filter((s) => !claimedSheet.has(s.sno));
  let unclaimedDb = leftoverDb.filter((d) => !fuzzyUsedDb.has(d.id));

  // ---- build the write plan ----------------------------------------------
  // One group per sheet row: every live row that represents the same item.
  // Canonical row gets the new rate; the rest are retired (soft delete).
  const groups: { s: SheetRow; rows: DbRow[] }[] = [];
  for (const s of sheet) {
    const rows = [...(dbByKey.get(s.key) ?? [])];
    const f = fuzzy.find((x) => x.s.sno === s.sno);
    if (f) rows.push(f.d);
    if (rows.length) groups.push({ s, rows });
  }

  // Fold leftover live rows that duplicate a row already in a group. The test
  // is row-vs-row, not row-vs-sheet: same numeric tokens AND near-identical
  // wording. "3.5C, 95 sq mm Aluminium Aromoured Cable" vs
  // "3.5C,95 Sq.mm Aluminium Armoured Cable" passes; the two DCDB variants
  // above do not.
  const DUP_THRESHOLD = 0.85;
  const foldedDupIds = new Set<string>();
  for (const g of groups) {
    for (const d of unclaimedDb) {
      if (foldedDupIds.has(d.id)) continue;
      if (d.item_category !== g.s.category) continue;
      const dNums = numTokens(d.item_description);
      const dWords = wordTokens(normDesc(d.item_description));
      const isDup = g.rows.some(
        (r) =>
          JSON.stringify(numTokens(r.item_description)) === JSON.stringify(dNums) &&
          scorePair(wordTokens(normDesc(r.item_description)), dWords) >= DUP_THRESHOLD
      );
      if (isDup) {
        foldedDupIds.add(d.id);
        g.rows.push(d);
      }
    }
  }
  unclaimedDb = unclaimedDb.filter((d) => !foldedDupIds.has(d.id));
  const dbOnly = unclaimedDb;

  // Reference counts decide which duplicate survives — never retire the row
  // that BOMs / BOQs / POs already point at.
  const dupIds = groups.filter((g) => g.rows.length > 1).flatMap((g) => g.rows.map((r) => r.id));
  const refCounts = await loadRefCounts(dupIds);

  const toUpdate: { row: DbRow; s: SheetRow }[] = [];
  const toRetire: { row: DbRow; s: SheetRow; canonicalId: string }[] = [];

  for (const g of groups) {
    const ranked = [...g.rows].sort((a, b) => {
      const ra = refCounts.get(a.id) ?? 0;
      const rb = refCounts.get(b.id) ?? 0;
      if (ra !== rb) return rb - ra; // most-referenced wins
      const ba = a.brand ? 1 : 0;
      const bb = b.brand ? 1 : 0;
      if (ba !== bb) return bb - ba; // then the row that carries a brand
      return a.item_description.trim().length - b.item_description.trim().length;
    });
    const canonical = ranked[0]!;
    toUpdate.push({ row: canonical, s: g.s });
    for (const r of ranked.slice(1)) toRetire.push({ row: r, s: g.s, canonicalId: canonical.id });
  }

  // ---- report -------------------------------------------------------------
  const L: string[] = [];
  const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  L.push('# Price List 26-27 → price_book diff (dry run)');
  L.push('');
  L.push(`Source: \`Price List - 26-27.xlsx\` · generated ${new Date().toISOString().slice(0, 10)}`);
  L.push('');
  L.push('| Bucket | Count |');
  L.push('|---|---|');
  L.push(`| Sheet rows parsed | ${sheet.length} |`);
  L.push(`| Live price_book rows | ${db.length} |`);
  L.push(`| Matched → price CHANGED | ${priceChanges.length} |`);
  L.push(`| Matched → price same | ${unchanged.length} |`);
  L.push(`| Matched to >1 live row (dupes in DB) | ${ambiguous.length} |`);
  L.push(`| Fuzzy-paired (same item, re-worded) | ${fuzzy.length} |`);
  L.push(`| Rows to UPDATE | ${toUpdate.length} |`);
  L.push(`| Duplicate rows to RETIRE (soft delete) | ${toRetire.length} |`);
  L.push(`| Sheet-only → would INSERT | ${stillNew.length} |`);
  L.push(`| Live rows NOT in sheet (left untouched) | ${dbOnly.length} |`);
  L.push(`| Sheet rows with rate = 0 | ${zeroRate.length} |`);
  L.push('');

  L.push('## Price changes');
  L.push('');
  L.push('| Cat | Item | Make | Old | New | Δ% |');
  L.push('|---|---|---|---|---|---|');
  for (const p of priceChanges.sort((a, b) => a.s.category.localeCompare(b.s.category))) {
    const pct = p.old === 0 ? '—' : (((p.next - p.old) / p.old) * 100).toFixed(1) + '%';
    L.push(`| ${p.s.category} | ${p.s.description} | ${p.s.brand ?? ''} | ${money(p.old)} | ${money(p.next)} | ${pct} |`);
  }
  L.push('');

  L.push('## Fuzzy-paired — same item, re-worded (VERIFY THESE)');
  L.push('');
  L.push('| Cat | Sheet item | Live item | Old | New | Score |');
  L.push('|---|---|---|---|---|---|');
  for (const f of fuzzy.sort((a, b) => a.score - b.score)) {
    const old = Number.parseFloat(f.d.base_price);
    L.push(
      `| ${f.s.category} | ${f.s.description} | ${f.d.item_description.trim()} | ${money(old)} | ${money(f.s.rate)} | ${f.score.toFixed(2)} |`
    );
  }
  L.push('');

  L.push('## Sheet-only (would be inserted as new items)');
  L.push('');
  L.push('| Cat | Item | Make | Unit | Rate | GST | Vendor |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of stillNew) {
    L.push(`| ${s.category} | ${s.description} | ${s.brand ?? ''} | ${s.unit} | ${money(s.rate)} | ${s.gstRate} | ${s.vendor ?? ''} |`);
  }
  L.push('');

  L.push('## Live rows NOT present in the new sheet');
  L.push('');
  L.push('| Cat | Item | Make | Rate | Vendor |');
  L.push('|---|---|---|---|---|');
  for (const d of dbOnly) {
    L.push(`| ${d.item_category} | ${d.item_description} | ${d.brand ?? ''} | ${money(Number.parseFloat(d.base_price))} | ${d.vendor_name ?? ''} |`);
  }
  L.push('');

  L.push('## Sheet rows with rate = 0 (no vendor price yet)');
  L.push('');
  for (const s of zeroRate) L.push(`- ${s.category} · ${s.description} · ${s.brand ?? ''} · ${s.vendor ?? ''}`);
  L.push('');

  L.push('## Duplicates to retire (soft delete — canonical row keeps the rate)');
  L.push('');
  L.push('| Item | Retiring | Refs | Surviving row |');
  L.push('|---|---|---|---|');
  for (const t of toRetire) {
    const survivor = toUpdate.find((u) => u.row.id === t.canonicalId)?.row;
    L.push(
      `| ${t.s.description} | ${t.row.item_description.trim()} (₹${t.row.base_price}) | ${refCounts.get(t.row.id) ?? 0} | ${survivor?.item_description.trim() ?? '?'} |`
    );
  }
  L.push('');
  L.push(`_Exact-key groups with >1 live row: ${ambiguous.length}._`);
  L.push('');

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, L.join('\n'), 'utf8');

  console.log(`sheet rows      : ${sheet.length}`);
  console.log(`live price_book : ${db.length}`);
  console.log(`price changed   : ${priceChanges.length}`);
  console.log(`price same      : ${unchanged.length}`);
  console.log(`ambiguous       : ${ambiguous.length}`);
  console.log(`fuzzy-paired    : ${fuzzy.length}`);
  console.log(`to update       : ${toUpdate.length}`);
  console.log(`to retire (dup) : ${toRetire.length}`);
  console.log(`new (insert)    : ${stillNew.length}`);
  console.log(`db-only (kept)  : ${dbOnly.length}`);
  console.log(`zero rate       : ${zeroRate.length}`);
  console.log(`report          : ${REPORT_PATH}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply after reviewing the report.');
    return;
  }

  // ---- apply --------------------------------------------------------------
  const op = '[apply]';
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  let updated = 0;
  let retired = 0;

  for (const u of toUpdate) {
    const patch: Record<string, unknown> = {
      base_price: u.s.rate,
      gst_rate: u.s.gstRate,
      unit: u.s.unit || u.row.unit,
      vendor_name: u.s.vendor ?? u.row.vendor_name,
      rate_updated_at: nowIso,
      effective_from: today,
      is_active: true,
    };
    // Fill a missing brand from the sheet; never blank an existing one.
    if (!u.row.brand && u.s.brand) patch.brand = u.s.brand;

    const { error } = await supabase.from('price_book').update(patch).eq('id', u.row.id);
    if (error) {
      console.error(`${op} update failed`, {
        id: u.row.id,
        item: u.s.description,
        error,
        timestamp: new Date().toISOString(),
      });
      process.exit(1);
    }
    updated++;
  }

  for (const t of toRetire) {
    const { error } = await supabase
      .from('price_book')
      .update({ deleted_at: nowIso, is_active: false })
      .eq('id', t.row.id);
    if (error) {
      console.error(`${op} retire failed`, {
        id: t.row.id,
        item: t.row.item_description,
        error,
        timestamp: new Date().toISOString(),
      });
      process.exit(1);
    }
    retired++;
  }

  const inserts = stillNew.map((s) => ({
    id: crypto.randomUUID(),
    item_category: s.category,
    item_description: s.description,
    brand: s.brand,
    // One sheet row ("10 Sq.mm Single Core Aluminium Flexible Cable") has an
    // empty Unit cell. Its 25 Sq.mm sibling two rows up is sold by the Meter,
    // so cables/wires fall back to Meter rather than the generic Nos.
    unit: s.unit || (/\b(cable|wire)\b/i.test(s.description) ? 'Meter' : 'Nos'),
    base_price: s.rate,
    gst_type: 'supply' as const,
    gst_rate: s.gstRate,
    vendor_name: s.vendor,
    effective_from: today,
    rate_updated_at: nowIso,
    is_active: true,
  }));

  if (inserts.length) {
    const { error } = await supabase.from('price_book').insert(inserts);
    if (error) {
      console.error(`${op} insert failed`, {
        count: inserts.length,
        error,
        timestamp: new Date().toISOString(),
      });
      process.exit(1);
    }
  }

  console.log(`\nAPPLIED → updated ${updated} · retired ${retired} · inserted ${inserts.length}`);
}

main().catch((e) => {
  console.error('[import-price-list-2026-27] fatal', { error: e, timestamp: new Date().toISOString() });
  process.exit(1);
});
