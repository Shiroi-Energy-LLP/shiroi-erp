/**
 * zoho-sync Edge Function
 *
 * Zoho Books live API sync — spec: docs/superpowers/specs/2026-07-16-zoho-live-api-sync-design.md
 *
 *   PULL (Zoho → ERP): all 12 finance entities, incremental via per-entity
 *     last_modified_time watermark in zoho_sync_state (page_cursor resumes
 *     bounded cold full-scans). Upserts keyed on the zoho_*_id columns,
 *     stamped source='zoho_import' on insert. Zoho is the source of truth
 *     for finance entries.
 *
 *   PUSH (ERP → Zoho): approved site-expense VOUCHERS only, via the
 *     claim_zoho_voucher_batch RPC (mig 203) over zoho_sync_queue.
 *     POST /books/v3/expenses (create) / PUT /books/v3/expenses/{id} (update).
 *
 * Trigger: n8n cron workflow (63-zoho-sync-cron.json) POSTs every 15 min with
 * body {"mode":"both"} (push first, then pull). Manual invocation:
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/zoho-sync \
 *     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"mode":"pull","entity":"invoices"}'
 *
 * The function replies 202 immediately and does the work via
 * EdgeRuntime.waitUntil so the n8n HTTP node never times out.
 *
 * Environment variables required:
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (platform-injected)
 *   - ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN
 *   - ZOHO_BOOKS_ORG_ID
 *   - ZOHO_DC                              (optional; default 'in')
 *   - ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID      (voucher push fallback account)
 *   - ZOHO_PAID_THROUGH_ACCOUNT_ID         (voucher push paid-through account)
 *   - ZOHO_PULL_SINCE                      (optional 'YYYY-MM-DD'; on a COLD
 *       full scan (NULL watermark) skip customerpayments / vendorpayments /
 *       expenses rows dated before this. Guards against re-importing history
 *       the XLS backfill already loaded under a DIFFERENT id space — the XLS
 *       keyed payments on per-ALLOCATION ids (InvoicePayment ID / PIPayment
 *       ID) while the API list is per-PARENT payment_id, so the zoho-id
 *       conflict key alone cannot dedupe those. Set this to the backfill
 *       export date before the first cold pull.)
 *
 * v1 scope notes (deliberate):
 *   - LIST endpoints only. `zoho_invoice_line_items` is NOT populated by this
 *     function: the /invoices list endpoint does not return line items, and
 *     one detail call per invoice would blow the rate budget. Same for
 *     `vendor_bill_items`. Line-item detail remains XLS-backfill-only.
 *   - The single exception is credit notes: invoice_credit_notes.invoice_id
 *     is NOT NULL and the linkage only exists in the detail response — new
 *     credit notes are so rare (~15 ever) that one detail call each is fine.
 *   - Invoice/bill list rows carry only `total` + `balance` (no tax split),
 *     so inserted invoices get subtotal_supply=total / gst_supply_amount=0
 *     (total_amount — the column all cash math uses — stays exact).
 *
 * Money: amounts are passed through Zoho JSON → NUMERIC as-is. The ONLY
 * derivation is amount_paid = total − balance, computed in integer paise
 * (see subMoney) — never float arithmetic on money.
 *
 * NOTE: This file is DENO, not Node. Self-contained by convention (no
 * workspace imports) — same as inverter-poll.
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Budgets ────────────────────────────────────────────────────────────────

// Zoho Books rate limit is ~100 req/min (plan-dependent daily cap). We keep a
// flat inter-call delay + a per-entity page budget so a cold start converges
// over several 15-min cycles instead of one giant run (spec §3).
const ZOHO_CALL_DELAY_MS = 250;
const MAX_PAGES_PER_ENTITY = 20;
const PER_PAGE = 200;
const PUSH_BATCH_LIMIT = 25;
// Wall-clock budget for the background task. Supabase Edge Functions allow
// ~400 s wall clock; stop starting new work well before that and mark the
// run 'partial' — watermarks/page cursors make the next cycle resume cleanly.
const RUN_BUDGET_MS = 300_000;
const FETCH_TIMEOUT_MS = 20_000;
const DB_PAGE = 1000; // PostgREST default row cap — page every unbounded read

// FK-safe pull order (spec §4). Must match the zoho_sync_state seed (mig 203).
const ENTITY_ORDER = [
  'chartofaccounts',
  'taxes',
  'items',
  'contacts',
  'vendors',
  'purchaseorders',
  'invoices',
  'customerpayments',
  'bills',
  'vendorpayments',
  'expenses',
  'creditnotes',
] as const;

type EntityName = (typeof ENTITY_ORDER)[number];

// ─── Small helpers ──────────────────────────────────────────────────────────

function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === 'string' && m.length > 0) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  // @ts-expect-error — AbortSignal.timeout is available in the Deno runtime
  return await fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Pass-through numeric parse for money — NO arithmetic, just JSON → JSON. */
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * amount_paid = total − balance, in integer paise so no float error reaches a
 * NUMERIC(14,2) column. This is the only money derivation in the file.
 */
function subMoney(total: unknown, balance: unknown): number {
  const t = Number(total);
  const b = Number(balance);
  if (!Number.isFinite(t) || !Number.isFinite(b)) return 0;
  const paise = Math.round(t * 100) - Math.round(b * 100);
  return Math.max(0, paise) / 100;
}

/** 'YYYY-MM-DD' guard — Zoho list `date` fields are already in this shape. */
function toDateOnly(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** Anchor created_at to the business date at 12:00 IST — same as mig 086 / the XLS import. */
function anchorTs(dateOnly: string): string {
  return `${dateOnly}T12:00:00+05:30`;
}

/**
 * Zoho search-param timestamp: yyyy-MM-ddTHH:mm:ss+0530 (IST, no colon in
 * offset). We subtract 1 s from the stored watermark so a same-second
 * modification is never skipped (re-upserting a row is harmless).
 */
function toZohoTimestamp(isoUtc: string): string {
  const t = new Date(isoUtc).getTime() - 1000;
  const ist = new Date(t + 5.5 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}` +
    `T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}+0530`
  );
}

// ─── Name normalization (SYNC WITH scripts/zoho-import/normalize.ts) ────────

const NAME_SUFFIXES = [
  'pvt ltd', 'pvt. ltd', 'private limited', 'private ltd',
  'p ltd', 'p. ltd', 'llp', 'ltd', 'inc', 'co',
];

function normalizeName(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[.,()\/\-_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const sfx of NAME_SUFFIXES) {
    s = s.replace(new RegExp(`\\b${sfx}\\b`, 'g'), '');
  }
  s = s.replace(/[-\s]+\d+(\.\d+)?\s*k\s*w\s*p?\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function nameTokens(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length >= 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter((t) => b.has(t)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

/** Map Zoho payment_mode → ERP payment_method enum (SYNC WITH scripts/zoho-import/normalize.ts). */
function mapPaymentMode(mode: unknown): 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd' {
  const m = String(mode ?? '').toLowerCase().trim();
  if (!m) return 'bank_transfer';
  if (m.includes('upi') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) return 'upi';
  if (m.includes('cheque') || m.includes('check')) return 'cheque';
  if (m.includes('cash')) return 'cash';
  if (m === 'dd' || m.includes('demand draft')) return 'dd';
  return 'bank_transfer';
}

// ─── Status mappers (SYNC WITH scripts/zoho-import/phase-07/08/10) ──────────

function mapPOStatus(s: unknown): string {
  const v = String(s ?? '').toLowerCase().replace(/_/g, ' ').trim();
  if (v === 'billed' || v === 'received' || v === 'closed') return 'fully_delivered';
  if (v === 'cancelled') return 'cancelled';
  if (v === 'draft') return 'draft';
  if (v === 'issued' || v === 'sent' || v === 'open') return 'sent';
  return 'approved';
}

function mapInvoiceStatus(s: unknown): string {
  const v = String(s ?? '').toLowerCase().replace(/_/g, ' ').trim();
  if (v === 'paid') return 'paid';
  if (v === 'partially paid') return 'partially_paid';
  if (v === 'overdue') return 'overdue';
  if (v === 'draft') return 'draft';
  if (v === 'sent' || v === 'viewed' || v === 'unpaid') return 'sent';
  if (v === 'void') return 'cancelled';
  return 'sent';
}

function mapBillStatus(s: unknown): string {
  const v = String(s ?? '').toLowerCase().replace(/_/g, ' ').trim();
  if (v === 'paid') return 'paid';
  if (v === 'partially paid') return 'partially_paid';
  if (v === 'void' || v === 'cancelled') return 'cancelled';
  if (v === 'draft') return 'draft';
  return 'pending';
}

// ─── Zoho API client ────────────────────────────────────────────────────────

class ZohoRateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ZohoRateLimitError';
  }
}

interface ZohoListEnvelope {
  code?: number;
  message?: string;
  page_context?: { page?: number; per_page?: number; has_more_page?: boolean };
  [key: string]: unknown;
}

interface ZohoClientEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: string;
}

class ZohoClient {
  private env: ZohoClientEnv;
  private accessToken: string | null = null; // in-memory only, never persisted
  private lastCallAt = 0;

  constructor(env: ZohoClientEnv) {
    this.env = env;
  }

  private get apiBase(): string {
    return `https://www.zohoapis.${this.env.dc}/books/v3`;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + ZOHO_CALL_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async ensureToken(): Promise<string> {
    const op = '[zohoAuth]';
    if (this.accessToken) return this.accessToken;
    const url =
      `https://accounts.zoho.${this.env.dc}/oauth/v2/token` +
      `?refresh_token=${encodeURIComponent(this.env.refreshToken)}` +
      `&client_id=${encodeURIComponent(this.env.clientId)}` +
      `&client_secret=${encodeURIComponent(this.env.clientSecret)}` +
      `&grant_type=refresh_token`;
    await this.throttle();
    const res = await fetchWithTimeout(url, { method: 'POST' });
    const body = (await res.json()) as { access_token?: string; error?: string };
    if (!res.ok || !body.access_token) {
      console.error(`${op} token refresh failed`, {
        status: res.status,
        error: body.error ?? null,
        timestamp: new Date().toISOString(),
      });
      throw new Error(`Zoho token refresh failed: HTTP ${res.status} ${body.error ?? ''}`.trim());
    }
    this.accessToken = body.access_token;
    return this.accessToken;
  }

  private async request(method: string, path: string, params: Record<string, string>, jsonBody?: unknown): Promise<ZohoListEnvelope> {
    const op = '[zohoRequest]';
    const token = await this.ensureToken();
    const qs = new URLSearchParams({ organization_id: this.env.orgId, ...params });
    const url = `${this.apiBase}${path}?${qs.toString()}`;
    await this.throttle();
    const res = await fetchWithTimeout(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
    });
    if (res.status === 429) {
      // Zoho rate limit — stop the run gracefully; the caller marks it 'partial'.
      throw new ZohoRateLimitError(`Zoho rate limit (HTTP 429) on ${method} ${path}`);
    }
    const text = await res.text();
    let body: ZohoListEnvelope;
    try {
      body = text ? (JSON.parse(text) as ZohoListEnvelope) : {};
    } catch {
      throw new Error(`${op.slice(1, -1)}: non-JSON response HTTP ${res.status} on ${method} ${path}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`Zoho HTTP ${res.status} on ${method} ${path}: code=${body.code ?? '?'} ${body.message ?? text.slice(0, 200)}`);
    }
    // Zoho wraps everything in {code, message}; code 0 = success.
    if (typeof body.code === 'number' && body.code !== 0) {
      throw new Error(`Zoho API error on ${method} ${path}: code=${body.code} ${body.message ?? ''}`.trim());
    }
    return body;
  }

  async get(path: string, params: Record<string, string>): Promise<ZohoListEnvelope> {
    return await this.request('GET', path, params);
  }

  async post(path: string, jsonBody: unknown): Promise<ZohoListEnvelope> {
    return await this.request('POST', path, {}, jsonBody);
  }

  async put(path: string, jsonBody: unknown): Promise<ZohoListEnvelope> {
    return await this.request('PUT', path, {}, jsonBody);
  }
}

// ─── Supabase plumbing ──────────────────────────────────────────────────────

// The jsr supabase-js client here is untyped (no generated Database generic —
// same convention as inverter-poll; this directory is outside the pnpm/tsc
// workspaces). Row shapes are asserted locally per query.
// deno-lint-ignore no-explicit-any
type Sb = any;

interface PgErr {
  message: string;
  code?: string;
}

/** Page through an unbounded read — PostgREST caps un-ranged selects at 1000 rows. */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PgErr | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await build(from, from + DB_PAGE - 1);
    if (error) throw new Error(error.message);
    if (data === null) break;
    out.push(...data);
    if (data.length < DB_PAGE) break;
  }
  return out;
}

/**
 * Batch-insert with per-row fallback: try the whole chunk; if the chunk
 * errors, retry row-by-row so one bad row (e.g. unique-violation on a
 * secondary constraint like receipt_number) doesn't sink its 99 neighbours.
 * 23505 (duplicate) counts as skipped, not failed.
 */
async function insertBatch(
  sb: Sb,
  op: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; skipped: number; failed: number }> {
  const res = { inserted: 0, skipped: 0, failed: 0 };
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).insert(chunk);
    if (error === null) {
      res.inserted += chunk.length;
      continue;
    }
    // Chunk failed — retry individually.
    for (const row of chunk) {
      const { error: rowErr } = await sb.from(table).insert(row);
      if (rowErr === null) {
        res.inserted++;
      } else if ((rowErr as PgErr).code === '23505') {
        res.skipped++;
      } else {
        res.failed++;
        console.error(`${op} ${table} insert failed:`, {
          error: (rowErr as PgErr).message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  return res;
}

let _systemEmployeeId: string | null = null;
/** Migration System employee — used for NOT NULL *_by columns on Zoho-sourced rows (SYNC WITH scripts/zoho-import/supabase.ts). */
async function getSystemEmployeeId(sb: Sb): Promise<string> {
  const op = '[getSystemEmployeeId]';
  if (_systemEmployeeId) return _systemEmployeeId;
  const { data, error } = await sb
    .from('employees')
    .select('id')
    .ilike('full_name', '%migration%')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`${op.slice(1, -1)}: ${error.message}`);
  if (data?.id) {
    _systemEmployeeId = data.id as string;
    return _systemEmployeeId;
  }
  const { data: fallback, error: fbErr } = await sb
    .from('employees')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (fbErr) throw new Error(`${op.slice(1, -1)} fallback: ${fbErr.message}`);
  if (!fallback?.id) throw new Error('No employee rows found for system attribution');
  _systemEmployeeId = fallback.id as string;
  return _systemEmployeeId;
}

// ─── Run context ────────────────────────────────────────────────────────────

interface SyncCtx {
  sb: Sb;
  zoho: ZohoClient;
  startedAt: number;
  pullSince: string | null; // ZOHO_PULL_SINCE cold-scan guard
}

function deadlineExceeded(ctx: SyncCtx): boolean {
  return Date.now() - ctx.startedAt > RUN_BUDGET_MS;
}

interface SyncStateRow {
  entity: string;
  watermark: string | null;
  page_cursor: number;
  total_rows_synced: number;
}

type ZohoRow = Record<string, unknown>;

interface PageResult {
  upserted: number;
}

interface EntityConfig {
  entity: EntityName;
  path: string;
  listKey: string;
  params?: Record<string, string>;
  /** Zoho list endpoint supports the last_modified_time search param. */
  supportsLastModified: boolean;
  /** Apply the ZOHO_PULL_SINCE cold-scan duplicate guard (see header). */
  coldScanGuard?: boolean;
  prepare: (ctx: SyncCtx) => Promise<unknown>;
  upsertPage: (ctx: SyncCtx, prep: unknown, rows: ZohoRow[]) => Promise<PageResult>;
}

// ─── Entity handlers ────────────────────────────────────────────────────────
// Column semantics mirror the XLS backfill (scripts/zoho-import/phase-*.ts).
// HARD RULES (spec §4): conflict-updates touch ONLY Zoho-owned columns —
// never project_id, attribution_status, excluded_from_cash, workflow status
// columns, erp_created, erp_recorded, or *_by/*_at audit columns.
// customer_payments are INSERT-ONLY. Expenses updates skip source='erp' rows
// (echo guard). New rows land with project_id NULL → /cash orphan triage.

// 1. Chart of Accounts → zoho_account_codes (PK account_id).
//    erp_expense_category is ERP-owned (voucher mapping) — never in the payload.
const chartOfAccountsCfg: EntityConfig = {
  entity: 'chartofaccounts',
  path: '/chartofaccounts',
  listKey: 'chartofaccounts',
  supportsLastModified: false,
  prepare: async () => null,
  upsertPage: async (ctx, _prep, rows) => {
    const op = '[pullChartOfAccounts]';
    const batch = rows
      .filter((r) => toStr(r.account_id))
      .map((r) => ({
        account_id: String(r.account_id),
        account_name: toStr(r.account_name) ?? 'Unknown',
        account_code: toStr(r.account_code),
        account_type: toStr(r.account_type) ?? 'Other',
        parent_account: toStr(r.parent_account_name),
        is_active: r.is_active !== false,
      }));
    if (batch.length === 0) return { upserted: 0 };
    const { error } = await ctx.sb.from('zoho_account_codes').upsert(batch, { onConflict: 'account_id' });
    if (error) throw new Error(`${op.slice(1, -1)}: ${error.message}`);
    return { upserted: batch.length };
  },
};

// 2. Taxes → zoho_tax_codes. The XLS backfill keyed tax_id = Tax NAME
//    (Tax.xls had no id column) and zoho_items FKs reference those name keys —
//    so the API pull keeps the same key semantics: tax_id := tax_name.
function deriveTaxType(specificType: string | null, name: string): string {
  const st = (specificType ?? '').toLowerCase();
  if (st === 'cgst') return 'CGST';
  if (st === 'sgst') return 'SGST';
  if (st === 'igst') return 'IGST';
  if (st === 'cess') return 'CESS';
  const u = name.toUpperCase();
  if (u.includes('CGST')) return 'CGST';
  if (u.includes('SGST')) return 'SGST';
  if (u.includes('IGST')) return 'IGST';
  if (u.includes('CESS')) return 'CESS';
  return 'OTHER';
}

const taxesCfg: EntityConfig = {
  entity: 'taxes',
  path: '/settings/taxes',
  listKey: 'taxes',
  supportsLastModified: false,
  prepare: async () => null,
  upsertPage: async (ctx, _prep, rows) => {
    const op = '[pullTaxes]';
    const batch = rows
      .filter((r) => toStr(r.tax_name))
      .map((r) => {
        const name = toStr(r.tax_name) as string;
        return {
          tax_id: name, // name-keyed — see comment above
          tax_name: name,
          tax_percentage: toNum(r.tax_percentage) ?? 0,
          tax_type: deriveTaxType(toStr(r.tax_specific_type), name),
          is_active: true,
        };
      });
    if (batch.length === 0) return { upserted: 0 };
    const { error } = await ctx.sb.from('zoho_tax_codes').upsert(batch, { onConflict: 'tax_id' });
    if (error) throw new Error(`${op.slice(1, -1)}: ${error.message}`);
    return { upserted: batch.length };
  },
};

// 3. Items → zoho_items (PK zoho_item_id). intra/inter_state_tax_id are left
//    untouched — the API returns numeric tax ids that would not match the
//    name-keyed zoho_tax_codes FK.
const itemsCfg: EntityConfig = {
  entity: 'items',
  path: '/items',
  listKey: 'items',
  supportsLastModified: false,
  prepare: async () => null,
  upsertPage: async (ctx, _prep, rows) => {
    const op = '[pullItems]';
    const batch = rows
      .filter((r) => toStr(r.item_id))
      .map((r) => ({
        zoho_item_id: String(r.item_id),
        item_name: toStr(r.name) ?? 'Unknown',
        sku: toStr(r.sku),
        hsn_code: toStr(r.hsn_or_sac),
        rate: toNum(r.rate),
        purchase_rate: toNum(r.purchase_rate),
        sales_account: toStr(r.account_name),
        purchase_account: toStr(r.purchase_account_name),
        is_active: String(r.status ?? 'active').toLowerCase() !== 'inactive',
      }));
    if (batch.length === 0) return { upserted: 0 };
    const { error } = await ctx.sb.from('zoho_items').upsert(batch, { onConflict: 'zoho_item_id' });
    if (error) throw new Error(`${op.slice(1, -1)}: ${error.message}`);
    return { upserted: batch.length };
  },
};

// 4. Contacts (customers) → contacts: LINK-ONLY, same as phase-04. ERP
//    contacts come from the lead/proposal flow — we never create or edit
//    them from Zoho, only stamp zoho_contact_id on a confident name match.
interface ContactsPrep {
  erpContacts: Array<{ id: string; name: string | null; zoho_contact_id: string | null }>;
  linkedIds: Set<string>;
}

const contactsCfg: EntityConfig = {
  entity: 'contacts',
  path: '/contacts',
  listKey: 'contacts',
  params: { contact_type: 'customer' },
  supportsLastModified: true,
  prepare: async (ctx): Promise<ContactsPrep> => {
    const erpContacts = await fetchAllRows<{ id: string; name: string | null; zoho_contact_id: string | null }>(
      (from, to) => ctx.sb.from('contacts').select('id, name, zoho_contact_id').order('id').range(from, to),
    );
    const linkedIds = new Set<string>();
    for (const c of erpContacts) if (c.zoho_contact_id) linkedIds.add(c.zoho_contact_id);
    return { erpContacts, linkedIds };
  },
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullContacts]';
    const prep = prepRaw as ContactsPrep;
    let upserted = 0;
    for (const r of rows) {
      const zohoId = toStr(r.contact_id);
      if (!zohoId || prep.linkedIds.has(zohoId)) continue;
      const zohoName = toStr(r.contact_name) ?? toStr(r.company_name) ?? '';
      if (!zohoName) continue;
      const zTok = nameTokens(normalizeName(zohoName));
      let bestScore = 0;
      let bestId: string | null = null;
      for (const c of prep.erpContacts) {
        if (c.zoho_contact_id) continue;
        const score = jaccard(zTok, nameTokens(normalizeName(c.name ?? '')));
        if (score > bestScore) {
          bestScore = score;
          bestId = c.id;
        }
      }
      if (bestScore < 0.8 || !bestId) continue;
      const { error } = await ctx.sb
        .from('contacts')
        .update({ zoho_contact_id: zohoId })
        .eq('id', bestId)
        .is('zoho_contact_id', null);
      if (error) {
        console.error(`${op} link failed for "${zohoName}":`, { error: error.message, timestamp: new Date().toISOString() });
        continue;
      }
      upserted++;
      prep.linkedIds.add(zohoId);
      const c = prep.erpContacts.find((x) => x.id === bestId);
      if (c) c.zoho_contact_id = zohoId;
    }
    return { upserted };
  },
};

// 5. Contacts (vendors) → vendors: GSTIN match → link; fuzzy name → link;
//    no match → create (vendor_code ZHI-V-nnnn), same as phase-05. Rows
//    already linked are left untouched (vendors has no `source` column, so
//    an update could clobber ERP-curated fields).
interface VendorsPrep {
  erpVendors: Array<{ id: string; company_name: string; gstin: string | null; zoho_vendor_id: string | null }>;
  linkedIds: Set<string>;
  nextCode: number;
}

const vendorsCfg: EntityConfig = {
  entity: 'vendors',
  path: '/contacts',
  listKey: 'contacts',
  params: { contact_type: 'vendor' },
  supportsLastModified: true,
  prepare: async (ctx): Promise<VendorsPrep> => {
    const erpVendors = await fetchAllRows<{
      id: string;
      company_name: string;
      gstin: string | null;
      zoho_vendor_id: string | null;
      vendor_code: string;
    }>((from, to) => ctx.sb.from('vendors').select('id, company_name, gstin, zoho_vendor_id, vendor_code').order('id').range(from, to));
    const linkedIds = new Set<string>();
    let maxSuffix = 0;
    for (const v of erpVendors) {
      if (v.zoho_vendor_id) linkedIds.add(v.zoho_vendor_id);
      const m = /^ZHI-V-(\d+)$/.exec(v.vendor_code ?? '');
      if (m) maxSuffix = Math.max(maxSuffix, Number(m[1]));
    }
    return { erpVendors, linkedIds, nextCode: Math.max(maxSuffix, erpVendors.length) + 1 };
  },
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullVendors]';
    const prep = prepRaw as VendorsPrep;
    let upserted = 0;
    for (const r of rows) {
      const zohoId = toStr(r.contact_id);
      if (!zohoId || prep.linkedIds.has(zohoId)) continue;
      const zohoName = toStr(r.contact_name) ?? toStr(r.company_name) ?? '';
      const zohoGstin = toStr(r.gst_no);

      let matchId: string | null = null;
      if (zohoGstin) {
        const g = prep.erpVendors.find(
          (v) => v.gstin && v.gstin.trim().toUpperCase() === zohoGstin.trim().toUpperCase(),
        );
        if (g) matchId = g.id;
      }
      if (!matchId && zohoName) {
        const zTok = nameTokens(normalizeName(zohoName));
        let bestScore = 0;
        let bestId: string | null = null;
        for (const v of prep.erpVendors) {
          const score = jaccard(zTok, nameTokens(normalizeName(v.company_name)));
          if (score > bestScore) {
            bestScore = score;
            bestId = v.id;
          }
        }
        if (bestScore >= 0.8 && bestId) matchId = bestId;
      }

      if (matchId) {
        const { error } = await ctx.sb
          .from('vendors')
          .update({ zoho_vendor_id: zohoId })
          .eq('id', matchId)
          .is('zoho_vendor_id', null);
        if (error) {
          console.error(`${op} link failed for "${zohoName}":`, { error: error.message, timestamp: new Date().toISOString() });
          continue;
        }
        upserted++;
        prep.linkedIds.add(zohoId);
        const v = prep.erpVendors.find((x) => x.id === matchId);
        if (v) v.zoho_vendor_id = zohoId;
        continue;
      }

      // Create a new vendor from Zoho data (list-endpoint fields only).
      const vendorCode = `ZHI-V-${String(prep.nextCode).padStart(4, '0')}`;
      prep.nextCode++;
      const newVendor = {
        vendor_code: vendorCode,
        company_name: zohoName || `Zoho Vendor ${zohoId}`,
        gstin: zohoGstin,
        phone: toStr(r.mobile) ?? toStr(r.phone),
        email: toStr(r.email),
        vendor_type: 'other',
        is_msme: false,
        is_preferred: false,
        is_blacklisted: false,
        payment_terms_days: toNum(r.payment_terms) ?? 0,
        is_active: String(r.status ?? 'active').toLowerCase() === 'active',
        zoho_vendor_id: zohoId,
        notes: 'Created from Zoho live sync',
      };
      const { data: inserted, error: insErr } = await ctx.sb
        .from('vendors')
        .insert(newVendor)
        .select('id, company_name, gstin, zoho_vendor_id, vendor_code')
        .maybeSingle();
      if (insErr) {
        console.error(`${op} create failed for "${zohoName}":`, { error: insErr.message, timestamp: new Date().toISOString() });
        continue;
      }
      if (inserted === null) {
        console.error(`${op} create returned no row for "${zohoName}"`, { timestamp: new Date().toISOString() });
        continue;
      }
      upserted++;
      prep.linkedIds.add(zohoId);
      prep.erpVendors.push(inserted);
    }
    return { upserted };
  },
};

// Shared vendor lookup for POs / bills / vendor payments.
async function loadVendorByZohoId(ctx: SyncCtx): Promise<Map<string, string>> {
  const rows = await fetchAllRows<{ id: string; zoho_vendor_id: string | null }>((from, to) =>
    ctx.sb.from('vendors').select('id, zoho_vendor_id').not('zoho_vendor_id', 'is', null).order('id').range(from, to),
  );
  const map = new Map<string, string>();
  for (const v of rows) if (v.zoho_vendor_id) map.set(v.zoho_vendor_id, v.id);
  return map;
}

async function loadExistingZohoIds(ctx: SyncCtx, table: string, col: string): Promise<Set<string>> {
  const rows = await fetchAllRows<Record<string, string | null>>((from, to) =>
    ctx.sb.from(table).select(col).not(col, 'is', null).order(col).range(from, to),
  );
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[col];
    if (v) set.add(v);
  }
  return set;
}

async function loadProjectsByCustomerName(ctx: SyncCtx): Promise<Map<string, string>> {
  const rows = await fetchAllRows<{ id: string; customer_name: string | null }>((from, to) =>
    ctx.sb.from('projects').select('id, customer_name').order('id').range(from, to),
  );
  const map = new Map<string, string>();
  for (const p of rows) {
    if (p.customer_name) map.set(p.customer_name.toLowerCase().trim(), p.id);
  }
  return map;
}

// 6. Purchase Orders → purchase_orders (key zoho_po_id). The PO list endpoint
//    carries no balance/subtotal split — inserts get subtotal=total, gst 0,
//    amount_paid 0 / outstanding = total; conflict-updates touch only status,
//    dates and total_amount.
interface POPrep {
  existing: Set<string>;
  vendorByZohoId: Map<string, string>;
  systemId: string;
}

const purchaseOrdersCfg: EntityConfig = {
  entity: 'purchaseorders',
  path: '/purchaseorders',
  listKey: 'purchaseorders',
  supportsLastModified: true,
  prepare: async (ctx): Promise<POPrep> => ({
    existing: await loadExistingZohoIds(ctx, 'purchase_orders', 'zoho_po_id'),
    vendorByZohoId: await loadVendorByZohoId(ctx),
    systemId: await getSystemEmployeeId(ctx.sb),
  }),
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullPurchaseOrders]';
    const prep = prepRaw as POPrep;
    const inserts: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of rows) {
      const zohoId = toStr(r.purchaseorder_id);
      if (!zohoId) continue;
      const poDate = toDateOnly(r.date) ?? '2023-01-01';
      if (prep.existing.has(zohoId)) {
        const { error } = await ctx.sb
          .from('purchase_orders')
          .update({
            status: mapPOStatus(r.status),
            total_amount: toNum(r.total) ?? 0,
            po_date: poDate,
            expected_delivery_date: toDateOnly(r.delivery_date),
          })
          .eq('zoho_po_id', zohoId);
        if (error) {
          console.error(`${op} update failed for ${zohoId}:`, { error: error.message, timestamp: new Date().toISOString() });
        } else {
          updated++;
        }
        continue;
      }
      const vendorId = r.vendor_id != null ? prep.vendorByZohoId.get(String(r.vendor_id)) : undefined;
      if (!vendorId) {
        console.warn(`${op} vendor unresolved for PO ${toStr(r.purchaseorder_number) ?? zohoId} (zoho vendor ${toStr(r.vendor_id)}); skipping`);
        continue;
      }
      const total = toNum(r.total) ?? 0;
      inserts.push({
        project_id: null, // list endpoint has no project — orphan triage
        vendor_id: vendorId,
        prepared_by: prep.systemId,
        po_number: `ZHI/${toStr(r.purchaseorder_number) ?? zohoId}`,
        status: mapPOStatus(r.status),
        po_date: poDate,
        expected_delivery_date: toDateOnly(r.delivery_date),
        payment_terms_days: 0,
        subtotal: total, // no tax split on the list endpoint
        gst_amount: 0,
        total_amount: total,
        amount_paid: 0, // no balance on the list endpoint
        amount_outstanding: total,
        loi_issued: false,
        advance_block_overridden: false,
        requires_approval: false,
        approval_status: 'approved',
        sent_via_channels: [],
        source: 'zoho_import',
        zoho_po_id: zohoId,
        created_at: anchorTs(poDate),
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'purchase_orders', inserts);
    return { upserted: ins.inserted + updated };
  },
};

// 7. Invoices → invoices (key zoho_invoice_id). Line items NOT pulled — see
//    file header; zoho_invoice_line_items stays backfill-only in v1.
interface InvoicesPrep {
  existing: Set<string>;
  projByCust: Map<string, string>;
  systemId: string;
}

const invoicesCfg: EntityConfig = {
  entity: 'invoices',
  path: '/invoices',
  listKey: 'invoices',
  supportsLastModified: true,
  prepare: async (ctx): Promise<InvoicesPrep> => ({
    existing: await loadExistingZohoIds(ctx, 'invoices', 'zoho_invoice_id'),
    projByCust: await loadProjectsByCustomerName(ctx),
    systemId: await getSystemEmployeeId(ctx.sb),
  }),
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullInvoices]';
    const prep = prepRaw as InvoicesPrep;
    const inserts: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of rows) {
      const zohoId = toStr(r.invoice_id);
      if (!zohoId) continue;
      const total = toNum(r.total) ?? 0;
      const balance = toNum(r.balance) ?? 0;
      const invoiceDate = toDateOnly(r.date) ?? '2023-01-01';
      const dueDate = toDateOnly(r.due_date) ?? invoiceDate;
      if (prep.existing.has(zohoId)) {
        // Zoho-owned columns only — project_id / attribution / notes untouched.
        const { error } = await ctx.sb
          .from('invoices')
          .update({
            status: mapInvoiceStatus(r.status),
            total_amount: total,
            amount_paid: subMoney(total, balance),
            amount_outstanding: balance,
            due_date: dueDate,
          })
          .eq('zoho_invoice_id', zohoId);
        if (error) {
          console.error(`${op} update failed for ${zohoId}:`, { error: error.message, timestamp: new Date().toISOString() });
        } else {
          updated++;
        }
        continue;
      }
      const customerName = (toStr(r.customer_name) ?? '').toLowerCase().trim();
      inserts.push({
        project_id: customerName ? (prep.projByCust.get(customerName) ?? null) : null,
        raised_by: prep.systemId,
        invoice_number: `ZHI/${toStr(r.invoice_number) ?? zohoId}`,
        invoice_type: 'tax_invoice',
        // List endpoint has no tax split — keep total_amount exact.
        subtotal_supply: total,
        subtotal_works: 0,
        gst_supply_amount: 0,
        gst_works_amount: 0,
        total_amount: total,
        amount_paid: subMoney(total, balance),
        amount_outstanding: balance,
        invoice_date: invoiceDate,
        due_date: dueDate,
        status: mapInvoiceStatus(r.status),
        escalation_level: 0,
        legal_flagged: false,
        source: 'zoho_import',
        zoho_invoice_id: zohoId,
        zoho_customer_id: toStr(r.customer_id),
        zoho_customer_name: toStr(r.customer_name),
        created_at: anchorTs(invoiceDate),
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'invoices', inserts);
    return { upserted: ins.inserted + updated };
  },
};

// 8. Customer Payments → customer_payments: INSERT-ONLY (Tier-3 immutable —
//    spec §4; the consultant-payout trigger firing on insert is correct
//    business behaviour). Grain note: the API list is one row per PARENT
//    payment (payment_id), while the XLS backfill was per-allocation
//    (InvoicePayment ID) — the parentNumbers guard below skips payments the
//    backfill already imported under their allocation ids.
interface CustPayPrep {
  existing: Set<string>;
  backfilledParentNumbers: Set<string>;
  invoiceByNumber: Map<string, { id: string; project_id: string | null }>;
  projByCust: Map<string, string>;
  systemId: string;
}

const customerPaymentsCfg: EntityConfig = {
  entity: 'customerpayments',
  path: '/customerpayments',
  listKey: 'customerpayments',
  supportsLastModified: true,
  coldScanGuard: true,
  prepare: async (ctx): Promise<CustPayPrep> => {
    const receipts = await fetchAllRows<{ receipt_number: string }>((from, to) =>
      ctx.sb.from('customer_payments').select('receipt_number').like('receipt_number', 'ZHI/%').order('receipt_number').range(from, to),
    );
    // Backfill receipts are 'ZHI/<Payment Number>/<InvoicePayment ID>' — the
    // middle segment is the parent payment number the API list will re-offer.
    const backfilledParentNumbers = new Set<string>();
    for (const r of receipts) {
      const parts = r.receipt_number.split('/');
      if (parts.length >= 3 && parts[1]) backfilledParentNumbers.add(parts[1]);
    }
    const invoices = await fetchAllRows<{ id: string; project_id: string | null; invoice_number: string }>((from, to) =>
      ctx.sb.from('invoices').select('id, project_id, invoice_number').like('invoice_number', 'ZHI/%').order('id').range(from, to),
    );
    const invoiceByNumber = new Map<string, { id: string; project_id: string | null }>();
    for (const inv of invoices) invoiceByNumber.set(inv.invoice_number, { id: inv.id, project_id: inv.project_id });
    return {
      existing: await loadExistingZohoIds(ctx, 'customer_payments', 'zoho_customer_payment_id'),
      backfilledParentNumbers,
      invoiceByNumber,
      projByCust: await loadProjectsByCustomerName(ctx),
      systemId: await getSystemEmployeeId(ctx.sb),
    };
  },
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullCustomerPayments]';
    const prep = prepRaw as CustPayPrep;
    const inserts: Record<string, unknown>[] = [];
    for (const r of rows) {
      const zohoId = toStr(r.payment_id);
      if (!zohoId || prep.existing.has(zohoId)) continue; // INSERT-ONLY
      const paymentNumber = toStr(r.payment_number);
      if (paymentNumber && prep.backfilledParentNumbers.has(paymentNumber)) continue; // XLS backfill dupe guard
      const amount = toNum(r.amount);
      if (amount === null || amount <= 0) continue;
      const paymentDate = toDateOnly(r.date) ?? '2023-01-01';

      // invoice_numbers is a comma-joined display string; only a single,
      // unambiguous number is linked. Multi-invoice payments stay unlinked.
      const invNums = (toStr(r.invoice_numbers) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      let invoiceId: string | null = null;
      let projectId: string | null = null;
      if (invNums.length === 1) {
        const inv = prep.invoiceByNumber.get(`ZHI/${invNums[0]}`);
        if (inv) {
          invoiceId = inv.id;
          projectId = inv.project_id;
        }
      }
      if (!projectId) {
        const custName = (toStr(r.customer_name) ?? '').toLowerCase().trim();
        if (custName) projectId = prep.projByCust.get(custName) ?? null;
      }

      inserts.push({
        project_id: projectId,
        invoice_id: invoiceId,
        recorded_by: prep.systemId,
        receipt_number: `ZHI/${paymentNumber ?? 'P'}/${zohoId}`,
        amount,
        payment_date: paymentDate,
        payment_method: mapPaymentMode(toStr(r.payment_mode)),
        payment_reference: toStr(r.reference_number),
        is_advance: !invoiceId,
        notes: toStr(r.description),
        source: 'zoho_import',
        zoho_customer_payment_id: zohoId,
        zoho_customer_id: toStr(r.customer_id),
        zoho_customer_name: toStr(r.customer_name),
        created_at: anchorTs(paymentDate),
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'customer_payments', inserts);
    return { upserted: ins.inserted };
  },
};

// 9. Bills → vendor_bills (key zoho_bill_id). Line items NOT pulled (list
//    endpoint has none) — vendor_bill_items stays backfill-only in v1, so
//    the recalc_vendor_bill_totals cascade never fires for these rows.
interface BillsPrep {
  existing: Set<string>;
  vendorByZohoId: Map<string, string>;
  systemId: string;
}

const billsCfg: EntityConfig = {
  entity: 'bills',
  path: '/bills',
  listKey: 'bills',
  supportsLastModified: true,
  prepare: async (ctx): Promise<BillsPrep> => ({
    existing: await loadExistingZohoIds(ctx, 'vendor_bills', 'zoho_bill_id'),
    vendorByZohoId: await loadVendorByZohoId(ctx),
    systemId: await getSystemEmployeeId(ctx.sb),
  }),
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullBills]';
    const prep = prepRaw as BillsPrep;
    const inserts: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of rows) {
      const zohoId = toStr(r.bill_id);
      if (!zohoId) continue;
      const total = toNum(r.total) ?? 0;
      const balance = toNum(r.balance) ?? 0;
      const billDate = toDateOnly(r.date) ?? '2023-01-01';
      if (prep.existing.has(zohoId)) {
        const { error } = await ctx.sb
          .from('vendor_bills')
          .update({
            status: mapBillStatus(r.status),
            total_amount: total,
            amount_paid: subMoney(total, balance),
            due_date: toDateOnly(r.due_date),
          })
          .eq('zoho_bill_id', zohoId);
        if (error) {
          console.error(`${op} update failed for ${zohoId}:`, { error: error.message, timestamp: new Date().toISOString() });
        } else {
          updated++;
        }
        continue;
      }
      const vendorId = r.vendor_id != null ? prep.vendorByZohoId.get(String(r.vendor_id)) : undefined;
      if (!vendorId) {
        console.warn(`${op} vendor unresolved for bill ${toStr(r.bill_number) ?? zohoId}; skipping`);
        continue;
      }
      inserts.push({
        bill_number: `ZHI/${toStr(r.bill_number) ?? zohoId}`,
        bill_date: billDate,
        due_date: toDateOnly(r.due_date),
        vendor_id: vendorId,
        project_id: null, // list endpoint has no project — orphan triage
        subtotal: total, // no tax split on the list endpoint
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        cess_amount: 0,
        round_off: 0,
        total_amount: total,
        amount_paid: subMoney(total, balance),
        status: mapBillStatus(r.status),
        source: 'zoho_import',
        zoho_bill_id: zohoId,
        created_by: prep.systemId,
        created_at: anchorTs(billDate),
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'vendor_bills', inserts);
    return { upserted: ins.inserted + updated };
  },
};

// 10. Vendor Payments → vendor_payments (key zoho_vendor_payment_id). Grain
//     note (like customer payments): API list is per-PARENT payment while the
//     XLS backfill was per-allocation (PIPayment ID) — the backfill stored no
//     parent identifier, so the only cold-scan protection is ZOHO_PULL_SINCE.
//     Bill allocation detail is not in the list — vendor_bill_id stays NULL.
interface VendorPayPrep {
  existing: Set<string>;
  vendorByZohoId: Map<string, string>;
  systemId: string;
}

const vendorPaymentsCfg: EntityConfig = {
  entity: 'vendorpayments',
  path: '/vendorpayments',
  listKey: 'vendorpayments',
  supportsLastModified: true,
  coldScanGuard: true,
  prepare: async (ctx): Promise<VendorPayPrep> => ({
    existing: await loadExistingZohoIds(ctx, 'vendor_payments', 'zoho_vendor_payment_id'),
    vendorByZohoId: await loadVendorByZohoId(ctx),
    systemId: await getSystemEmployeeId(ctx.sb),
  }),
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullVendorPayments]';
    const prep = prepRaw as VendorPayPrep;
    const inserts: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of rows) {
      const zohoId = toStr(r.payment_id);
      if (!zohoId) continue;
      const amount = toNum(r.amount);
      if (amount === null || amount <= 0) continue;
      const paymentDate = toDateOnly(r.date) ?? '2023-01-01';
      if (prep.existing.has(zohoId)) {
        const { error } = await ctx.sb
          .from('vendor_payments')
          .update({
            amount,
            payment_date: paymentDate,
            payment_reference: toStr(r.reference_number),
          })
          .eq('zoho_vendor_payment_id', zohoId);
        if (error) {
          console.error(`${op} update failed for ${zohoId}:`, { error: error.message, timestamp: new Date().toISOString() });
        } else {
          updated++;
        }
        continue;
      }
      const vendorId = r.vendor_id != null ? prep.vendorByZohoId.get(String(r.vendor_id)) : undefined;
      if (!vendorId) {
        console.warn(`${op} vendor unresolved for payment ${zohoId} ("${toStr(r.vendor_name)}"); skipping`);
        continue;
      }
      inserts.push({
        vendor_id: vendorId,
        project_id: null,
        recorded_by: prep.systemId,
        amount,
        payment_date: paymentDate,
        payment_method: mapPaymentMode(toStr(r.payment_mode)),
        payment_reference: toStr(r.reference_number),
        msme_compliant: true,
        vendor_bill_id: null,
        purchase_order_id: null,
        notes: toStr(r.description),
        source: 'zoho_import',
        zoho_vendor_payment_id: zohoId,
        created_at: anchorTs(paymentDate),
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'vendor_payments', inserts);
    return { upserted: ins.inserted + updated };
  },
};

// 11. Expenses → expenses (key zoho_expense_id) with the ECHO GUARD: a
//     voucher we pushed comes back with its zoho_expense_id stamped on a
//     source='erp' row — the update filter `.eq('source','zoho_import')`
//     makes that a no-op, so ERP-created vouchers stay ERP-owned (spec §4.3).
interface ExpensesPrep {
  existingBySource: Map<string, string>; // zoho_expense_id → source
  categoryByCode: Map<string, string>;
  miscCategoryId: string;
  systemId: string;
}

function matchExpenseCategory(accountName: string, prep: ExpensesPrep): string {
  const account = accountName.toLowerCase();
  if (account.includes('travel')) return prep.categoryByCode.get('travel') ?? prep.miscCategoryId;
  if (account.includes('food') || account.includes('meal')) return prep.categoryByCode.get('food') ?? prep.miscCategoryId;
  if (account.includes('lodg') || account.includes('hotel')) return prep.categoryByCode.get('lodging') ?? prep.miscCategoryId;
  return prep.miscCategoryId;
}

const expensesCfg: EntityConfig = {
  entity: 'expenses',
  path: '/expenses',
  listKey: 'expenses',
  supportsLastModified: true,
  coldScanGuard: true,
  prepare: async (ctx): Promise<ExpensesPrep> => {
    const existing = await fetchAllRows<{ zoho_expense_id: string | null; source: string }>((from, to) =>
      ctx.sb
        .from('expenses')
        .select('zoho_expense_id, source')
        .not('zoho_expense_id', 'is', null)
        .order('zoho_expense_id')
        .range(from, to),
    );
    const existingBySource = new Map<string, string>();
    for (const e of existing) if (e.zoho_expense_id) existingBySource.set(e.zoho_expense_id, e.source);
    const { data: categories, error: catErr } = await ctx.sb.from('expense_categories').select('id, code');
    if (catErr) throw new Error(`expense_categories: ${catErr.message}`);
    const categoryByCode = new Map<string, string>();
    for (const c of (categories ?? []) as Array<{ id: string; code: string }>) categoryByCode.set(c.code, c.id);
    const miscCategoryId = categoryByCode.get('miscellaneous') ?? [...categoryByCode.values()][0];
    if (!miscCategoryId) throw new Error('No expense categories found — cannot import Zoho expenses');
    return { existingBySource, categoryByCode, miscCategoryId, systemId: await getSystemEmployeeId(ctx.sb) };
  },
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullExpenses]';
    const prep = prepRaw as ExpensesPrep;
    const inserts: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of rows) {
      const zohoId = toStr(r.expense_id);
      if (!zohoId) continue;
      const amount = toNum(r.total);
      if (amount === null || amount <= 0) continue;
      const expenseDate = toDateOnly(r.date) ?? '2023-01-01';
      const existingSource = prep.existingBySource.get(zohoId);
      if (existingSource !== undefined) {
        if (existingSource !== 'zoho_import') continue; // echo guard — ERP voucher, do not touch
        const { error } = await ctx.sb
          .from('expenses')
          .update({
            amount,
            expense_date: expenseDate,
            description: toStr(r.description) ?? undefined,
          })
          .eq('zoho_expense_id', zohoId)
          .eq('source', 'zoho_import'); // echo guard, defence in depth
        if (error) {
          console.error(`${op} update failed for ${zohoId}:`, { error: error.message, timestamp: new Date().toISOString() });
        } else {
          updated++;
        }
        continue;
      }
      const historicalTs = anchorTs(expenseDate);
      inserts.push({
        project_id: null, // list has no project — orphan triage / zoho_project_mapping later
        description: toStr(r.description) ?? toStr(r.account_name) ?? 'Zoho expense',
        expense_date: expenseDate,
        amount,
        voucher_number: `ZHI/${zohoId}`,
        category_id: matchExpenseCategory(toStr(r.account_name) ?? '', prep),
        status: 'approved',
        submitted_by: prep.systemId,
        submitted_at: historicalTs,
        approved_by: prep.systemId,
        approved_at: historicalTs,
        created_at: historicalTs,
        source: 'zoho_import',
        zoho_expense_id: zohoId,
      });
      prep.existingBySource.set(zohoId, 'zoho_import');
    }
    const ins = await insertBatch(ctx.sb, op, 'expenses', inserts);
    return { upserted: ins.inserted + updated };
  },
};

// 12. Credit Notes → invoice_credit_notes (key zoho_credit_note_id).
//     INSERT-ONLY like the backfill. invoice_id + project_id are NOT NULL and
//     the invoice linkage only exists in the DETAIL response, so each NEW
//     credit note costs one extra API call — acceptable at ~15 CNs ever.
interface CreditNotesPrep {
  existing: Set<string>;
  invoiceByZohoId: Map<string, { id: string; project_id: string | null }>;
  systemId: string;
}

const creditNotesCfg: EntityConfig = {
  entity: 'creditnotes',
  path: '/creditnotes',
  listKey: 'creditnotes',
  supportsLastModified: true,
  prepare: async (ctx): Promise<CreditNotesPrep> => {
    const invoices = await fetchAllRows<{ id: string; project_id: string | null; zoho_invoice_id: string | null }>((from, to) =>
      ctx.sb
        .from('invoices')
        .select('id, project_id, zoho_invoice_id')
        .not('zoho_invoice_id', 'is', null)
        .order('id')
        .range(from, to),
    );
    const invoiceByZohoId = new Map<string, { id: string; project_id: string | null }>();
    for (const inv of invoices) {
      if (inv.zoho_invoice_id) invoiceByZohoId.set(inv.zoho_invoice_id, { id: inv.id, project_id: inv.project_id });
    }
    return {
      existing: await loadExistingZohoIds(ctx, 'invoice_credit_notes', 'zoho_credit_note_id'),
      invoiceByZohoId,
      systemId: await getSystemEmployeeId(ctx.sb),
    };
  },
  upsertPage: async (ctx, prepRaw, rows) => {
    const op = '[pullCreditNotes]';
    const prep = prepRaw as CreditNotesPrep;
    const inserts: Record<string, unknown>[] = [];
    for (const r of rows) {
      const zohoId = toStr(r.creditnote_id);
      if (!zohoId || prep.existing.has(zohoId)) continue; // insert-only
      // Detail call for the invoice linkage + sub_total (list has neither).
      const detail = await ctx.zoho.get(`/creditnotes/${encodeURIComponent(zohoId)}`, {});
      const cn = (detail.creditnote ?? {}) as ZohoRow;
      const credited = (Array.isArray(cn.invoices_credited) ? cn.invoices_credited : []) as ZohoRow[];
      let link: { id: string; project_id: string | null } | undefined;
      for (const c of credited) {
        const invZohoId = toStr(c.invoice_id);
        if (invZohoId && prep.invoiceByZohoId.has(invZohoId)) {
          link = prep.invoiceByZohoId.get(invZohoId);
          break;
        }
      }
      if (!link || !link.project_id) {
        // invoice_id + project_id are NOT NULL — same skip rule as phase-13.
        console.warn(`${op} credit note ${toStr(r.creditnote_number) ?? zohoId}: no linked ERP invoice with a project; skipping`);
        continue;
      }
      const total = toNum(cn.total) ?? toNum(r.total) ?? 0;
      const subTotal = toNum(cn.sub_total) ?? total;
      inserts.push({
        invoice_id: link.id,
        project_id: link.project_id,
        raised_by: prep.systemId,
        credit_note_number: `ZHI/${toStr(r.creditnote_number) ?? zohoId}`,
        reason: 'Zoho live sync — credit note',
        credit_amount: subTotal,
        gst_amount: subMoney(total, subTotal),
        total_credit: total,
        credit_note_date: toDateOnly(r.date) ?? '2023-01-01',
        source: 'zoho_import',
        zoho_credit_note_id: zohoId,
      });
      prep.existing.add(zohoId);
    }
    const ins = await insertBatch(ctx.sb, op, 'invoice_credit_notes', inserts);
    return { upserted: ins.inserted };
  },
};

const ENTITY_CONFIGS: Record<EntityName, EntityConfig> = {
  chartofaccounts: chartOfAccountsCfg,
  taxes: taxesCfg,
  items: itemsCfg,
  contacts: contactsCfg,
  vendors: vendorsCfg,
  purchaseorders: purchaseOrdersCfg,
  invoices: invoicesCfg,
  customerpayments: customerPaymentsCfg,
  bills: billsCfg,
  vendorpayments: vendorPaymentsCfg,
  expenses: expensesCfg,
  creditnotes: creditNotesCfg,
};

// ─── Pull driver ────────────────────────────────────────────────────────────

interface EntityOutcome {
  status: 'ok' | 'partial' | 'error';
  rateLimited: boolean;
}

async function pullEntity(ctx: SyncCtx, cfg: EntityConfig, state: SyncStateRow): Promise<EntityOutcome> {
  const op = '[zohoSyncPull]';
  const startedAtIso = new Date().toISOString();
  // Incremental (watermark) mode needs endpoint support AND a stored
  // watermark. Otherwise: bounded full scan resumable via page_cursor.
  const filtered = cfg.supportsLastModified && state.watermark !== null;
  let page = filtered ? 1 : Math.max(1, state.page_cursor);
  let fetched = 0;
  let upserted = 0;
  let maxLm: string | null = null;
  let status: 'ok' | 'partial' | 'error' = 'ok';
  let rateLimited = false;
  let errMsg: string | null = null;

  try {
    const prep = await cfg.prepare(ctx);
    let pagesThisRun = 0;
    for (;;) {
      if (pagesThisRun >= MAX_PAGES_PER_ENTITY) {
        console.warn(`${op} ${cfg.entity}: page budget (${MAX_PAGES_PER_ENTITY}) reached; deferring to next cycle`);
        status = 'partial';
        break;
      }
      if (deadlineExceeded(ctx)) {
        console.warn(`${op} ${cfg.entity}: run budget exceeded; deferring to next cycle`);
        status = 'partial';
        break;
      }
      const params: Record<string, string> = {
        ...(cfg.params ?? {}),
        page: String(page),
        per_page: String(PER_PAGE),
      };
      if (filtered && state.watermark) params.last_modified_time = toZohoTimestamp(state.watermark);
      const res = await ctx.zoho.get(cfg.path, params);
      let rows = (Array.isArray(res[cfg.listKey]) ? res[cfg.listKey] : []) as ZohoRow[];
      fetched += rows.length;
      // Cold-scan duplicate guard (see file header) for the parent/allocation
      // grain-mismatch modules.
      if (cfg.coldScanGuard && state.watermark === null && ctx.pullSince) {
        const since = ctx.pullSince;
        rows = rows.filter((r) => {
          const d = toDateOnly(r.date);
          return d === null || d >= since;
        });
      }
      const pageRes = await cfg.upsertPage(ctx, prep, rows);
      upserted += pageRes.upserted;
      // Only advance the watermark candidate over pages that upserted cleanly.
      for (const r of rows) {
        const lm = toStr(r.last_modified_time);
        if (lm && (maxLm === null || lm > maxLm)) maxLm = lm;
      }
      const hasMore = res.page_context?.has_more_page === true;
      page++;
      pagesThisRun++;
      if (!hasMore) break;
    }
  } catch (e) {
    if (e instanceof ZohoRateLimitError) {
      status = 'partial';
      rateLimited = true;
      errMsg = e.message;
      console.warn(`${op} ${cfg.entity}: ${e.message} — stopping run gracefully`);
    } else {
      status = 'error';
      errMsg = toErrorMessage(e);
      console.error(`${op} ${cfg.entity} failed:`, { error: errMsg, page, timestamp: new Date().toISOString() });
    }
  }

  // Persist zoho_sync_state. Watermark rules:
  //  - filtered mode: advance only after a CLEAN full pass (partial runs
  //    re-pull from the old watermark next cycle — upserts are idempotent).
  //  - full scan: keep watermark NULL until the scan completes so the next
  //    run resumes from page_cursor instead of flipping to filtered mode;
  //    on completion adopt maxLm (edge case: a row modified mid-scan on an
  //    already-scanned page can briefly be missed — self-heals on its next
  //    modification, acceptable at Shiroi volume).
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_run_at: nowIso,
    last_run_status: status,
    last_error: errMsg,
    total_rows_synced: state.total_rows_synced + upserted,
    updated_at: nowIso,
  };
  if (filtered) {
    patch.page_cursor = 1;
    if (status === 'ok' && maxLm !== null) patch.watermark = maxLm;
  } else if (status === 'ok') {
    patch.page_cursor = 1;
    if (cfg.supportsLastModified && maxLm !== null) patch.watermark = maxLm;
  } else {
    patch.page_cursor = page; // resume the full scan here next run
  }
  const { error: stateErr } = await ctx.sb.from('zoho_sync_state').update(patch).eq('entity', cfg.entity);
  if (stateErr) {
    console.error(`${op} ${cfg.entity}: zoho_sync_state update failed:`, {
      error: stateErr.message,
      timestamp: new Date().toISOString(),
    });
  }

  const { error: runErr } = await ctx.sb.from('zoho_sync_runs').insert({
    mode: 'pull',
    entity: cfg.entity,
    started_at: startedAtIso,
    finished_at: nowIso,
    status,
    rows_fetched: fetched,
    rows_upserted: upserted,
    error: errMsg,
  });
  if (runErr) {
    console.error(`${op} ${cfg.entity}: zoho_sync_runs insert failed:`, {
      error: runErr.message,
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`${op} ${cfg.entity} done`, { status, fetched, upserted, watermark: patch.watermark ?? state.watermark });
  return { status, rateLimited };
}

async function runPull(ctx: SyncCtx, onlyEntity?: EntityName): Promise<void> {
  const op = '[zohoSyncPull]';
  const { data: stateRows, error: stateErr } = await ctx.sb.from('zoho_sync_state').select('*');
  if (stateErr) {
    console.error(`${op} zoho_sync_state read failed:`, { error: stateErr.message, timestamp: new Date().toISOString() });
    return;
  }
  const stateByEntity = new Map<string, SyncStateRow>();
  for (const s of (stateRows ?? []) as SyncStateRow[]) stateByEntity.set(s.entity, s);

  const entities = onlyEntity ? [onlyEntity] : [...ENTITY_ORDER];
  for (const entity of entities) {
    const state = stateByEntity.get(entity);
    if (!state) {
      console.warn(`${op} no zoho_sync_state row for entity "${entity}"; skipping (run mig 203?)`);
      continue;
    }
    if (deadlineExceeded(ctx)) {
      console.warn(`${op} run budget exceeded before entity "${entity}"; remaining entities deferred to next cycle`);
      break;
    }
    const outcome = await pullEntity(ctx, ENTITY_CONFIGS[entity], state);
    if (outcome.rateLimited) {
      console.warn(`${op} rate-limited — remaining entities deferred to next cycle`);
      break;
    }
  }
}

// ─── Push driver (vouchers → Zoho expenses) ─────────────────────────────────

interface ClaimedVoucher {
  queue_id: string;
  expense_id: string;
  action: string;
  retry_count: number;
  voucher_number: string | null;
  amount: number; // NUMERIC via PostgREST — passed through, never computed on
  expense_date: string | null;
  description: string | null;
  category_code: string | null;
  zoho_expense_id: string | null;
  zoho_project_id: string | null;
}

async function releaseClaim(sb: Sb, queueId: string): Promise<void> {
  const op = '[zohoSyncPush]';
  const { error } = await sb
    .from('zoho_sync_queue')
    .update({ status: 'pending', claimed_at: null })
    .eq('id', queueId);
  if (error) {
    console.error(`${op} claim release failed for queue row ${queueId}:`, {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

async function runPush(ctx: SyncCtx): Promise<void> {
  const op = '[zohoSyncPush]';
  const startedAtIso = new Date().toISOString();
  let status: 'ok' | 'partial' | 'error' = 'ok';
  let errMsg: string | null = null;
  let claimedCount = 0;
  let synced = 0;

  // Both accounts are required for ANY push (paid-through always; the default
  // account whenever a category is unmapped) — fail loudly before claiming so
  // vouchers stay 'pending' untouched instead of burning attempts.
  // @ts-expect-error — Deno.env
  const defaultAccountId = (Deno.env.get('ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID') ?? '').trim();
  // @ts-expect-error — Deno.env
  const paidThroughId = (Deno.env.get('ZOHO_PAID_THROUGH_ACCOUNT_ID') ?? '').trim();
  if (!defaultAccountId || !paidThroughId) {
    errMsg =
      'Voucher push misconfigured: ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID and/or ZOHO_PAID_THROUGH_ACCOUNT_ID Edge secrets are missing';
    console.error(`${op} ${errMsg}`, { timestamp: new Date().toISOString() });
    const { error: runErr } = await ctx.sb.from('zoho_sync_runs').insert({
      mode: 'push',
      entity: null,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      status: 'error',
      rows_fetched: 0,
      rows_upserted: 0,
      error: errMsg,
    });
    if (runErr) console.error(`${op} zoho_sync_runs insert failed:`, { error: runErr.message, timestamp: new Date().toISOString() });
    return;
  }

  const { data: claimedRaw, error: claimErr } = await ctx.sb.rpc('claim_zoho_voucher_batch', { p_limit: PUSH_BATCH_LIMIT });
  if (claimErr) {
    errMsg = `claim_zoho_voucher_batch failed: ${claimErr.message}`;
    console.error(`${op} ${errMsg}`, { timestamp: new Date().toISOString() });
    status = 'error';
  }
  const claimed = (Array.isArray(claimedRaw) ? claimedRaw : []) as ClaimedVoucher[];
  claimedCount = claimed.length;

  if (status === 'ok' && claimed.length > 0) {
    // Resolve voucher category codes → Zoho expense accounts in one query.
    const codes = [...new Set(claimed.map((c) => c.category_code).filter((c): c is string => c !== null))];
    const accountByCategory = new Map<string, string>();
    if (codes.length > 0) {
      const { data: accounts, error: accErr } = await ctx.sb
        .from('zoho_account_codes')
        .select('account_id, erp_expense_category')
        .in('erp_expense_category', codes);
      if (accErr) {
        // Can't resolve accounts — release everything and fail the run.
        errMsg = `zoho_account_codes lookup failed: ${accErr.message}`;
        console.error(`${op} ${errMsg}`, { timestamp: new Date().toISOString() });
        status = 'error';
        for (const row of claimed) await releaseClaim(ctx.sb, row.queue_id);
      } else {
        for (const a of (accounts ?? []) as Array<{ account_id: string; erp_expense_category: string | null }>) {
          if (a.erp_expense_category) accountByCategory.set(a.erp_expense_category, a.account_id);
        }
      }
    }

    if (status === 'ok') {
      for (let i = 0; i < claimed.length; i++) {
        const row = claimed[i];
        if (deadlineExceeded(ctx)) {
          console.warn(`${op} run budget exceeded; releasing ${claimed.length - i} unprocessed claim(s)`);
          for (const rest of claimed.slice(i)) await releaseClaim(ctx.sb, rest.queue_id);
          status = 'partial';
          break;
        }
        try {
          if (row.action !== 'create' && row.action !== 'update') {
            throw new Error(`unsupported queue action "${row.action}" for voucher push`);
          }
          const payload: Record<string, unknown> = {
            account_id: (row.category_code ? accountByCategory.get(row.category_code) : undefined) ?? defaultAccountId,
            paid_through_account_id: paidThroughId,
            date: row.expense_date,
            amount: row.amount, // pass-through — no arithmetic on money
            reference_number: row.voucher_number,
            description: row.description ?? row.voucher_number ?? undefined,
          };
          if (row.zoho_project_id) payload.project_id = row.zoho_project_id;

          // 'update' without a stamped zoho_expense_id (edited before the
          // first successful push) degrades to a create.
          const isUpdate = row.action === 'update' && row.zoho_expense_id !== null;
          if (row.action === 'update' && row.zoho_expense_id === null) {
            console.warn(`${op} voucher ${row.voucher_number}: update action but no zoho_expense_id — creating instead`);
          }
          const res = isUpdate
            ? await ctx.zoho.put(`/expenses/${encodeURIComponent(row.zoho_expense_id as string)}`, payload)
            : await ctx.zoho.post('/expenses', payload);
          const zohoExpense = (res.expense ?? {}) as ZohoRow;
          const newZohoId = toStr(zohoExpense.expense_id);

          if (!isUpdate && newZohoId) {
            // Stamp the Zoho id back on the voucher (service-role update; the
            // mig-069 UPDATE guard tolerates it, and the pull echo guard keeps
            // the row ERP-owned).
            const { error: stampErr } = await ctx.sb
              .from('expenses')
              .update({ zoho_expense_id: newZohoId })
              .eq('id', row.expense_id);
            if (stampErr) {
              console.error(`${op} zoho_expense_id stamp failed for expense ${row.expense_id}:`, {
                error: stampErr.message,
                zoho_expense_id: newZohoId,
                timestamp: new Date().toISOString(),
              });
            }
          }

          const nowIso = new Date().toISOString();
          const { error: ackErr } = await ctx.sb
            .from('zoho_sync_queue')
            .update({
              status: 'synced',
              processed_at: nowIso,
              synced_at: nowIso,
              zoho_response: { expense_id: newZohoId, message: res.message ?? null },
              last_error: null,
            })
            .eq('id', row.queue_id);
          if (ackErr) {
            console.error(`${op} ack failed for queue row ${row.queue_id}:`, { error: ackErr.message, timestamp: new Date().toISOString() });
          }
          synced++;
          console.log(`${op} voucher ${row.voucher_number} → Zoho expense ${newZohoId} (${isUpdate ? 'update' : 'create'})`);
        } catch (e) {
          if (e instanceof ZohoRateLimitError) {
            console.warn(`${op} ${e.message} — releasing this and ${claimed.length - i - 1} remaining claim(s)`);
            for (const rest of claimed.slice(i)) await releaseClaim(ctx.sb, rest.queue_id);
            status = 'partial';
            errMsg = e.message;
            break;
          }
          const message = toErrorMessage(e);
          const newRetry = row.retry_count + 1;
          console.error(`${op} voucher ${row.voucher_number} push failed:`, {
            queue_id: row.queue_id,
            retry_count: newRetry,
            error: message,
            timestamp: new Date().toISOString(),
          });
          const { error: failErr } = await ctx.sb
            .from('zoho_sync_queue')
            .update({
              status: newRetry >= 5 ? 'failed' : 'pending',
              claimed_at: null,
              retry_count: newRetry,
              last_error: message.substring(0, 500),
            })
            .eq('id', row.queue_id);
          if (failErr) {
            console.error(`${op} failure bookkeeping failed for queue row ${row.queue_id}:`, {
              error: failErr.message,
              timestamp: new Date().toISOString(),
            });
          }
          if (status === 'ok') status = 'partial';
        }
      }
    }
  }

  const { error: runErr } = await ctx.sb.from('zoho_sync_runs').insert({
    mode: 'push',
    entity: null,
    started_at: startedAtIso,
    finished_at: new Date().toISOString(),
    status,
    rows_fetched: claimedCount,
    rows_upserted: synced,
    error: errMsg,
  });
  if (runErr) {
    console.error(`${op} zoho_sync_runs insert failed:`, { error: runErr.message, timestamp: new Date().toISOString() });
  }
  console.log(`${op} done`, { status, claimed: claimedCount, synced });
}

// ─── Orchestration ──────────────────────────────────────────────────────────

async function runSync(mode: 'pull' | 'push' | 'both', entity?: EntityName): Promise<void> {
  const op = '[zohoSync]';
  const startedAt = Date.now();
  // @ts-expect-error — Deno.env
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  // @ts-expect-error — Deno.env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // @ts-expect-error — Deno.env
  const clientId = (Deno.env.get('ZOHO_CLIENT_ID') ?? '').trim();
  // @ts-expect-error — Deno.env
  const clientSecret = (Deno.env.get('ZOHO_CLIENT_SECRET') ?? '').trim();
  // @ts-expect-error — Deno.env
  const refreshToken = (Deno.env.get('ZOHO_REFRESH_TOKEN') ?? '').trim();
  // @ts-expect-error — Deno.env
  const orgId = (Deno.env.get('ZOHO_BOOKS_ORG_ID') ?? '').trim();
  // @ts-expect-error — Deno.env
  const dc = (Deno.env.get('ZOHO_DC') ?? 'in').trim() || 'in';
  // @ts-expect-error — Deno.env
  const pullSinceRaw = (Deno.env.get('ZOHO_PULL_SINCE') ?? '').trim();
  const pullSince = /^\d{4}-\d{2}-\d{2}$/.test(pullSinceRaw) ? pullSinceRaw : null;

  if (!clientId || !clientSecret || !refreshToken || !orgId) {
    console.error(`${op} missing Zoho secrets (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_BOOKS_ORG_ID) — run scripts/set-zoho-edge-secrets.ts`, {
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ctx: SyncCtx = {
    sb,
    zoho: new ZohoClient({ clientId, clientSecret, refreshToken, orgId, dc }),
    startedAt,
    pullSince,
  };

  console.log(`${op} starting`, { mode, entity: entity ?? null, dc, pullSince });
  try {
    // Push first, then pull (spec §2) — the pull's echo guard then sees the
    // freshly stamped zoho_expense_id on the same cycle.
    if (mode === 'push' || mode === 'both') await runPush(ctx);
    if (mode === 'pull' || mode === 'both') await runPull(ctx, entity);
  } catch (e) {
    console.error(`${op} unhandled failure:`, { error: toErrorMessage(e), timestamp: new Date().toISOString() });
  }
  console.log(`${op} finished`, { mode, duration_ms: Date.now() - startedAt });
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

// @ts-expect-error — Deno global
Deno.serve(async (req: Request) => {
  const op = '[zohoSync]';
  // @ts-expect-error — Deno.env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Internal auth: deployed with verify_jwt=false (sb_secret_* keys are not
  // JWTs) — require the caller's Authorization header to match the service
  // role key directly. Same pattern as inverter-poll / process-document.
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${serviceKey}`) {
    console.warn(`${op} unauthorized call — Authorization header missing or mismatched`);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty/non-JSON body → defaults
  }
  const modeRaw = typeof body.mode === 'string' ? body.mode : 'both';
  if (modeRaw !== 'pull' && modeRaw !== 'push' && modeRaw !== 'both') {
    return new Response(JSON.stringify({ error: `invalid mode "${modeRaw}" — expected pull | push | both` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let entity: EntityName | undefined;
  if (body.entity !== undefined) {
    if (typeof body.entity !== 'string' || !(ENTITY_ORDER as readonly string[]).includes(body.entity)) {
      return new Response(
        JSON.stringify({ error: `invalid entity "${String(body.entity)}" — expected one of ${ENTITY_ORDER.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    entity = body.entity as EntityName;
  }

  // Respond 202 quickly; the sync runs in the background (spec §2).
  // @ts-expect-error — EdgeRuntime is provided by the Supabase Edge runtime
  EdgeRuntime.waitUntil(runSync(modeRaw, entity));

  return new Response(JSON.stringify({ accepted: true, mode: modeRaw, entity: entity ?? null }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
});
