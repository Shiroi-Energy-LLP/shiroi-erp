/**
 * import-manivel-boi-2026-07-21.ts
 *
 * Imports Manivel's live "Bill of Items" Google Sheet
 * (spreadsheet 1CsAYamXivIpqPJkKzum0vdkyfoKWBNUrv1C62wmktt8) into the DEV
 * Supabase DB. Backs the /purchase (BOI-Manager parity) flow.
 *
 * Source of truth for the row data is a committed snapshot extracted from the
 * sheet via the Drive MCP on 2026-07-21:
 *   scripts/data/boi-sheet-snapshot-2026-07-21.json
 * (The importer never calls Drive — the snapshot is reproducible + reviewable.)
 *
 * DEV ONLY. A hard guard aborts if NEXT_PUBLIC_SUPABASE_URL is not the dev ref.
 *
 * ---------------------------------------------------------------------------
 * MATCHING RULES (per the task brief + spec §13/§14):
 * ---------------------------------------------------------------------------
 * Projects  — sheet Project Name → existing `projects` by NORMALIZED display
 *   name (lower / trim / collapse-spaces) where display = COALESCE(
 *   NULLIF(project_name,''), customer_name). Matched → reuse id (never mutate
 *   the existing row). Unmatched → create a minimal project via the SAME
 *   convention as quickCreateProject in purchase-flow-actions.ts
 *   (generate_doc_number('PROJ'), customer_phone 'NA', status 'order_received',
 *   the mig-104 trigger fills project_manager_id). Sheet Priority maps to
 *   projects.procurement_priority: High→high, Medium→medium, Low/blank→null
 *   (the mig-041 CHECK has no 'low'). Sheet Status is NOT forced into the
 *   projects lifecycle enum. Created rows tagged notes '[boi-import-2026-07-21]'.
 *   BOI/Expense rows referencing a project name absent from the Projects tab
 *   also resolve through this same create-on-demand path (spec §2 name union).
 *
 * Price Book — dedup by NORMALIZED (item_description + brand + vendor) against
 *   BOTH existing price_book rows and rows already inserted this run; insert
 *   only genuinely new keys. Category→item_categories master value (fallback
 *   'others'), Rate→base_price, Gst→gst_rate, Vendor→vendor_name, Unit→unit,
 *   gst_type 'supply'. (No column to tag — reversal is via the manifest.)
 *
 * Bill of Items → project_boq_items — one row per line, linked to the resolved
 *   project_id. Category/Item(description)/Make(brand)/Qty/Units(unit)/Rate
 *   (unit_price)/Gst(gst_rate)/Vendor(vendor_name). total_price is GST-INCLUSIVE
 *   = round(qty × unit_price × (1 + gst/100), 2) (project-bom-actions convention;
 *   decimal.js). Status → procurement_status ladder (Order Placed→order_placed,
 *   Received→received, Delivered→delivered). Each row tagged
 *   notes 'boi-import:<sheetBoiId>' → idempotent + reversible.
 *
 * Expenses → expenses — sheet Category (Transport / Laboure) → expense_categories
 *   master (create 'transport' / 'labour' if absent — the master ships neither,
 *   and folding both into 'miscellaneous' would defeat the parity this import
 *   exists to give). Status Verified→verified, Pending→submitted. submitted_by
 *   is required by the voucher-number BEFORE INSERT trigger — resolve engineer
 *   name → employee, else fall back to Manivel (sheet owner); the real engineer
 *   name is preserved in the description. voucher_no ← sheet Voucher No;
 *   voucher_number is trigger-generated. source stays 'erp' (the source CHECK
 *   only allows erp/zoho_import — no column tag possible; idempotency is by
 *   content-match + manifest).
 *
 * Users + Purchase Orders sheets are NOT imported (ERP owns auth; POs are
 * generated fresh by the /purchase flow).
 *
 * Usage:
 *   pnpm tsx scripts/import-manivel-boi-2026-07-21.ts            # dry run
 *   pnpm tsx scripts/import-manivel-boi-2026-07-21.ts --apply    # writes to DEV
 *
 * Re-running with --apply is safe: projects match by name, price-book dedups,
 * BOQ skips already-tagged sheet ids, expenses skip content-matched rows.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const DEV_REF = 'actqtzoxjilqnldnacqz';
const APPLY = process.argv.includes('--apply');
const SNAPSHOT_PATH = path.resolve(__dirname, 'data/boi-sheet-snapshot-2026-07-21.json');
const MANIFEST_PATH = path.resolve(__dirname, 'data/boi-import-2026-07-21-manifest.json');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SECRET_KEY ?? '';
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}
if (!url.includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: NEXT_PUBLIC_SUPABASE_URL (${url}) is not the dev project (${DEV_REF}). This importer is dev-only.`);
  process.exit(1);
}

const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Snapshot types (verbatim sheet columns)
// ---------------------------------------------------------------------------
interface Snapshot {
  projects: Record<string, string>[];
  expenses: Record<string, string>[];
  priceBook: Record<string, string>[];
  billOfItems: Record<string, string>[];
}
const snapshot: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normName(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/**
 * Project-name match key. Folds punctuation drift that is otherwise a pure
 * formatting difference between Manivel's sheet and the ERP's project names
 * ("Dr Sivabalan" = "Dr. Sivabalan", "DRA Urbania" = "DRA - Urbania",
 * "M/S Ramya" = "M/s. Ramya"), WITHOUT stripping digits (so "…Block 5" stays
 * distinct from "…Block 4") or honorifics (so "Mr X" stays distinct from a
 * bare "X" — auto-merging those would risk linking money to the wrong
 * project; a false duplicate is taggable/reversible, a false merge is not).
 */
function normProjectName(s: string): string {
  return (s ?? '').toLowerCase().replace(/[.,/\-'"()\[\]&]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}
/** Strip ₹, commas, spaces → number. */
function money(v: string | null | undefined): number {
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function gstPct(v: string | null | undefined): number {
  const n = money(v);
  // Sheet stores whole percents (5/18/0); guard the odd fraction just in case.
  return n > 0 && n < 1 ? Math.round(n * 10000) / 100 : n;
}
/** GST-inclusive line total, 2dp (decimal.js). */
function totalPrice(qty: number, rate: number, gst: number): number {
  return new Decimal(qty).mul(rate).mul(new Decimal(gst).div(100).plus(1)).toDecimalPlaces(2).toNumber();
}
function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length ? t : null;
}

// Category (Price Book + BOI) sheet label → item_categories.value.
const ITEM_CATEGORY_MAP: Record<string, string> = {
  'solar panel': 'solar_panels',
  'solar panels': 'solar_panels',
  inverter: 'inverter',
  'battery & accessories': 'battery',
  mms: 'mms',
  'dc & accessories': 'dc_accessories',
  'ac & accessories': 'ac_accessories',
  conduits: 'conduits',
  'earth & accessories': 'earthing_accessories',
  'earth & access': 'earthing_accessories',
  'safety & accessories': 'safety_accessories',
  'i&c': 'ic',
  'statutory approvals': 'statutory_approvals',
  'local expenses': 'miscellaneous',
  transport: 'transport_civil',
  miscellaneous: 'miscellaneous',
  misscellaneous: 'miscellaneous',
  walkway: 'miscellaneous',
  handrail: 'miscellaneous',
  others: 'others',
};
function mapItemCategory(sheet: string): string {
  return ITEM_CATEGORY_MAP[normName(sheet)] ?? 'others';
}

// BOI Status sheet label → procurement_status.
const BOI_STATUS_MAP: Record<string, string> = {
  'yet to finalize': 'yet_to_finalize',
  'yet to place': 'yet_to_place',
  'order placed': 'order_placed',
  received: 'received',
  delivered: 'delivered',
};
function mapBoiStatus(sheet: string): string {
  return BOI_STATUS_MAP[normName(sheet)] ?? 'yet_to_finalize';
}

// Sheet Priority → projects.procurement_priority (no 'low' in the CHECK).
function mapPriority(sheet: string): string | null {
  const p = normName(sheet);
  if (p === 'high') return 'high';
  if (p === 'medium') return 'medium';
  return null; // Low / blank
}

// Expense category sheet label → { code, label } for expense_categories master.
const EXPENSE_CATEGORY_MAP: Record<string, { code: string; label: string }> = {
  transport: { code: 'transport', label: 'Transport' },
  laboure: { code: 'labour', label: 'Labour' },
  labour: { code: 'labour', label: 'Labour' },
  'material purchase': { code: 'site_material', label: 'Site Material' },
  travel: { code: 'travel', label: 'Travel' },
  'food & accommodations': { code: 'food', label: 'Food' },
  others: { code: 'miscellaneous', label: 'Miscellaneous' },
};
function mapExpenseCategory(sheet: string): { code: string; label: string } {
  return EXPENSE_CATEGORY_MAP[normName(sheet)] ?? { code: 'miscellaneous', label: 'Miscellaneous' };
}

function fail(op: string, error: unknown): never {
  console.error(`${op} failed`, { error, timestamp: new Date().toISOString() });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Manifest (every id we create, per table → reversal record)
// ---------------------------------------------------------------------------
interface Manifest {
  ranAt: string;
  applied: boolean;
  devRef: string;
  created: {
    projects: string[];
    price_book: string[];
    project_boq_items: string[];
    expenses: string[];
    expense_categories: string[];
  };
  counts: Record<string, { created: number; matched: number; skipped: number }>;
}
const manifest: Manifest = {
  ranAt: new Date().toISOString(),
  applied: APPLY,
  devRef: DEV_REF,
  created: { projects: [], price_book: [], project_boq_items: [], expenses: [], expense_categories: [] },
  counts: {},
};

// ---------------------------------------------------------------------------
async function main() {
  // ---- Load existing state ------------------------------------------------
  const projects = await loadAll('projects', 'id, project_name, customer_name, deleted_at')
    .then((rows) => rows.filter((r) => r.deleted_at == null));
  const priceBook = await loadAll('price_book', 'id, item_description, brand, vendor_name, deleted_at')
    .then((rows) => rows.filter((r) => r.deleted_at == null));
  const expenseCats = await loadAll('expense_categories', 'id, code');
  const existingBoq = await loadAll('project_boq_items', 'id, notes');

  // Project resolver: normalized display name → id (existing + created this run).
  const projectByName = new Map<string, string>();
  for (const p of projects) {
    const display = clean(p.project_name as string) ?? (p.customer_name as string);
    // First existing row wins a given key (deterministic; existing-side
    // collisions are only pre-existing true dupes e.g. "Pacifica Aurum").
    const k = normProjectName(display);
    if (!projectByName.has(k)) projectByName.set(k, p.id as string);
  }

  // Price-book dedup keys already present.
  const pbKeys = new Set<string>();
  for (const r of priceBook) {
    pbKeys.add(`${normKey(r.item_description as string)}||${normKey(r.brand as string)}||${normKey(r.vendor_name as string)}`);
  }

  // BOQ sheet-ids already imported (idempotency).
  const importedBoiIds = new Set<string>();
  for (const b of existingBoq) {
    const m = /^boi-import:([0-9a-f-]+)/i.exec((b.notes as string) ?? '');
    if (m) importedBoiIds.add(m[1]!);
  }

  // Expense-category resolver.
  const expenseCatByCode = new Map<string, string>();
  for (const c of expenseCats) expenseCatByCode.set(c.code as string, c.id as string);

  // Fallback submitter = Manivel (PM / sheet owner).
  const { data: manivel, error: manivelErr } = await supabase
    .from('employees')
    .select('id')
    .ilike('full_name', '%manivel%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (manivelErr) fail('[load manivel]', manivelErr);
  if (!manivel) fail('[load manivel]', 'No active employee matching "Manivel" for the submitter fallback');
  const fallbackSubmitter = manivel.id as string;

  const counts = {
    projects: { created: 0, matched: 0, skipped: 0 },
    price_book: { created: 0, matched: 0, skipped: 0 },
    project_boq_items: { created: 0, matched: 0, skipped: 0 },
    expenses: { created: 0, matched: 0, skipped: 0 },
    expense_categories: { created: 0, matched: 0, skipped: 0 },
  };

  // -------------------------------------------------------------------------
  // Resolve-or-create a project by name. Priority applied only on creation.
  // -------------------------------------------------------------------------
  async function resolveProject(rawName: string, priority: string | null): Promise<string | null> {
    const name = (rawName ?? '').trim();
    if (!name) return null;
    const norm = normProjectName(name);
    const hit = projectByName.get(norm);
    if (hit) {
      counts.projects.matched++;
      return hit;
    }
    // Create minimal project (quickCreateProject convention).
    if (!APPLY) {
      const fakeId = `dry-${randomUUID()}`;
      projectByName.set(norm, fakeId);
      counts.projects.created++;
      return fakeId;
    }
    const { data: docNum, error: docErr } = await supabase.rpc('generate_doc_number', { doc_type: 'PROJ' });
    if (docErr || !docNum) fail('[project doc number]', docErr ?? 'null doc number');
    const id = randomUUID();
    const insert: Record<string, unknown> = {
      id,
      project_number: docNum,
      project_name: name,
      customer_name: name,
      customer_phone: 'NA',
      site_address_line1: 'Pending',
      site_city: 'Chennai',
      site_state: 'Tamil Nadu',
      system_type: 'on_grid',
      system_size_kwp: 0,
      panel_count: 0,
      contracted_value: 0,
      advance_amount: 0,
      advance_received_at: new Date().toISOString().slice(0, 10),
      status: 'order_received',
      notes: '[boi-import-2026-07-21]',
    };
    if (priority) insert.procurement_priority = priority;
    const { error } = await supabase.from('projects').insert(insert);
    if (error) fail('[project insert]', { name, error });
    projectByName.set(norm, id);
    manifest.created.projects.push(id);
    counts.projects.created++;
    return id;
  }

  // -------------------------------------------------------------------------
  // 1) PROJECTS (Projects tab first — this is where Priority lives)
  // -------------------------------------------------------------------------
  for (const p of snapshot.projects) {
    await resolveProject(p['Project Name'], mapPriority(p['Priority']));
  }

  // -------------------------------------------------------------------------
  // 2) PRICE BOOK
  // -------------------------------------------------------------------------
  const pbInserts: Record<string, unknown>[] = [];
  for (const r of snapshot.priceBook) {
    const desc = (r['Item'] ?? '').trim();
    if (!desc) { counts.price_book.skipped++; continue; }
    const brand = clean(r['Make']);
    const vendor = clean(r['Vendor']);
    const dedupKey = `${normKey(desc)}||${normKey(brand)}||${normKey(vendor)}`;
    if (pbKeys.has(dedupKey)) { counts.price_book.matched++; continue; }
    pbKeys.add(dedupKey);
    const id = randomUUID();
    pbInserts.push({
      id,
      item_category: mapItemCategory(r['Category']),
      item_description: desc,
      brand,
      unit: clean(r['Unit']) ?? 'Nos',
      base_price: money(r['Rate']),
      gst_rate: gstPct(r['Gst']),
      gst_type: 'supply',
      vendor_name: vendor,
      is_active: true,
    });
    counts.price_book.created++;
  }
  if (APPLY && pbInserts.length) {
    const { error } = await supabase.from('price_book').insert(pbInserts);
    if (error) fail('[price_book insert]', error);
    for (const r of pbInserts) manifest.created.price_book.push(r.id as string);
  }

  // -------------------------------------------------------------------------
  // 3) BILL OF ITEMS → project_boq_items
  // -------------------------------------------------------------------------
  const boqInserts: Record<string, unknown>[] = [];
  for (const b of snapshot.billOfItems) {
    const sheetId = (b['ID'] ?? '').trim();
    if (sheetId && importedBoiIds.has(sheetId)) { counts.project_boq_items.skipped++; continue; }
    const projectId = await resolveProject(b['Project Name'], null);
    if (!projectId) { counts.project_boq_items.skipped++; continue; }
    const desc = (b['Item'] ?? '').trim();
    if (!desc) { counts.project_boq_items.skipped++; continue; }
    const qty = money(b['Qty']) || 1;
    const rate = money(b['Rate']);
    const gst = gstPct(b['Gst']);
    boqInserts.push({
      id: randomUUID(),
      project_id: projectId.startsWith('dry-') ? null : projectId,
      _dryProject: projectId, // internal only; stripped before insert
      item_category: mapItemCategory(b['Category']),
      item_description: desc,
      brand: clean(b['Make']),
      quantity: qty,
      unit: clean(b['Units']) ?? 'Nos',
      procurement_status: mapBoiStatus(b['Status']),
      unit_price: rate,
      gst_rate: gst,
      gst_type: 'supply',
      total_price: totalPrice(qty, rate, gst),
      vendor_name: clean(b['Vendor']),
      notes: sheetId ? `boi-import:${sheetId}` : 'boi-import',
    });
    counts.project_boq_items.created++;
  }
  if (APPLY && boqInserts.length) {
    const clean_ = boqInserts.map(({ _dryProject, ...rest }) => rest);
    const { error } = await supabase.from('project_boq_items').insert(clean_);
    if (error) fail('[project_boq_items insert]', error);
    for (const r of clean_) manifest.created.project_boq_items.push(r.id as string);
  }

  // -------------------------------------------------------------------------
  // 4) EXPENSES
  // -------------------------------------------------------------------------
  // Ensure the mapped expense categories exist (create missing ones).
  const neededCats = new Map<string, string>(); // code → label
  for (const e of snapshot.expenses) {
    const { code, label } = mapExpenseCategory(e['Category']);
    if (!expenseCatByCode.has(code)) neededCats.set(code, label);
  }
  for (const [code, label] of neededCats) {
    if (!APPLY) { expenseCatByCode.set(code, `dry-${code}`); counts.expense_categories.created++; continue; }
    const id = randomUUID();
    const { error } = await supabase.from('expense_categories').insert({ id, code, label, is_active: true });
    if (error) fail('[expense_categories insert]', { code, error });
    expenseCatByCode.set(code, id);
    manifest.created.expense_categories.push(id);
    counts.expense_categories.created++;
  }

  // Content-match idempotency: load existing candidate expenses once.
  const existingExpenses = await loadAll('expenses', 'id, project_id, amount, description, voucher_no');
  const expKey = (projectId: string | null, amount: number, voucherNo: string | null, description: string) =>
    `${projectId ?? ''}||${amount}||${normKey(voucherNo)}||${normKey(description)}`;
  const existingExpKeys = new Set(
    existingExpenses.map((e) =>
      expKey(e.project_id as string | null, Number(e.amount), e.voucher_no as string | null, (e.description as string) ?? '')),
  );

  for (const e of snapshot.expenses) {
    const projectId = await resolveProject(e['Project Name'], null);
    const realProjectId = projectId && !projectId.startsWith('dry-') ? projectId : null;
    const amount = money(e['Amount']);
    if (!(amount > 0)) { counts.expenses.skipped++; continue; }
    const engineer = clean(e['Engineer Name']);
    const desc = [engineer ? `Engineer: ${engineer}` : null, clean(e['Description'])].filter(Boolean).join(' — ')
      || 'Imported expense';
    const voucherNo = clean(e['Voucher No']);
    const key = expKey(realProjectId, amount, voucherNo, desc);
    if (existingExpKeys.has(key)) { counts.expenses.matched++; continue; }
    existingExpKeys.add(key);
    const { code } = mapExpenseCategory(e['Category']);
    const categoryId = expenseCatByCode.get(code);
    if (!categoryId) fail('[expense category resolve]', { code });
    const status = normName(e['Status']) === 'verified' ? 'verified' : 'submitted';

    if (!APPLY) { counts.expenses.created++; continue; }
    const id = randomUUID();
    const insert: Record<string, unknown> = {
      id,
      project_id: realProjectId,
      category_id: categoryId,
      description: desc,
      amount,
      status,
      source: 'erp',
      submitted_by: fallbackSubmitter, // engineer name preserved in description
      submitted_at: new Date().toISOString(),
      voucher_no: voucherNo,
      voucher_number: '', // trigger generates
    };
    const { error } = await supabase.from('expenses').insert(insert);
    if (error) fail('[expenses insert]', { project: e['Project Name'], error });
    manifest.created.expenses.push(id);
    counts.expenses.created++;
  }

  // ---- Manifest + report --------------------------------------------------
  // MERGE with any prior manifest so an idempotent re-run (which inserts
  // nothing) can never CLOBBER the insert-time ids that make rollback possible
  // — price_book rows carry no tag column, so their ids exist ONLY here.
  manifest.counts = counts;
  if (APPLY) {
    if (fs.existsSync(MANIFEST_PATH)) {
      try {
        const prior = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
        for (const k of Object.keys(manifest.created) as (keyof Manifest['created'])[]) {
          manifest.created[k] = [...new Set([...(prior.created?.[k] ?? []), ...manifest.created[k]])];
        }
      } catch (e) {
        console.warn('[manifest] could not merge prior manifest — writing this run only', e);
      }
    }
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }

  const line = (t: string, c: { created: number; matched: number; skipped: number }) =>
    console.log(`  ${t.padEnd(20)} created ${String(c.created).padStart(4)} · matched ${String(c.matched).padStart(4)} · skipped ${String(c.skipped).padStart(4)}`);
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — Manivel BOI import (dev ${DEV_REF})`);
  line('projects', counts.projects);
  line('price_book', counts.price_book);
  line('project_boq_items', counts.project_boq_items);
  line('expense_categories', counts.expense_categories);
  line('expenses', counts.expenses);
  if (APPLY) console.log(`\nmanifest → ${MANIFEST_PATH}`);
  else console.log('\nDRY RUN — nothing written. Re-run with --apply.');
}

/** Page through a table with service role (bypasses the implicit 1000-row cap). */
async function loadAll(table: string, select: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (error) fail(`[loadAll ${table}]`, error);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }
  return out;
}

main().catch((e) => {
  console.error('[import-manivel-boi-2026-07-21] fatal', { error: e, timestamp: new Date().toISOString() });
  process.exit(1);
});
