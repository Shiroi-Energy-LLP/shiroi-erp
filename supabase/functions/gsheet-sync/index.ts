/**
 * gsheet-sync Edge Function
 *
 * Manivel's Google Sheets → ERP live sync. Phase 1 mirrors + diffs; phase 2 (mig 225)
 * makes the master sheet WIN: gsheet_apply_projects() overwrites linked ERP projects
 * and creates missing ones, then the ERP project number is written into the sheet's
 * far-right "ERP ID" column (the only write to the sheet).
 * Spec: docs/superpowers/specs/2026-10-21-manivel-sheet-live-sync-design.md · mig 224.
 *
 *   For every enabled row in gsheet_sources: read all configured tabs with the
 *   Google service account, normalise each row, build a deterministic row_key
 *   (spec §4), and hand the tab's FULL contents to gsheet_apply_snapshot(),
 *   which diffs it in SQL into gsheet_rows / gsheet_changes / gsheet_project_links.
 *
 * Trigger: pg_cron 'gsheet-sync' (*\/10) → gsheet_sync_tick() → POST here with
 * header x-gsheet-sync-secret. Manual invocation:
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/gsheet-sync \
 *     -H "x-gsheet-sync-secret: $GSHEET_SYNC_SECRET" \
 *     -H "Content-Type: application/json" -d '{"source":"manivel_dashboard"}'
 *
 * Replies 202 immediately; the work runs via EdgeRuntime.waitUntil.
 * Body {"wait":true} runs inline and returns the per-tab results (manual debugging).
 *
 * Environment variables required:
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (platform-injected)
 *   - GSHEET_SYNC_SECRET                         (shared with Vault 'gsheet_sync_secret')
 *   - GOOGLE_SERVICE_ACCOUNT_JSON                (full service-account key JSON)
 *
 * Secrets in the sheet: Plant Monitoring Username/Password are dropped here and
 * never reach the database — the mirror keeps only has_credentials.
 *
 * NOTE: This file is DENO, not Node. Self-contained by convention (no
 * workspace imports) — same as inverter-poll / zoho-sync.
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Phase 2 writes the ERP ID column back into the master sheet (mig 225).
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
// Far-right column in the master Projects tab carrying the ERP project number.
const ERP_ID_HEADER = 'ERP ID';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Row identity per tab (spec §4). A non-blank `ID` column always wins.
const KEY_COLUMNS: Record<string, string[]> = {
  'Projects': ['Project Name'],
  'Budgets': ['Project Name'],
  'Project details': ['Project Name'],
  'Tasks': ['Project Name', 'Task Name', 'Assigned to'],
  'Services': ['Project Name', 'Task Name', 'Assigned date', 'Assigned to'],
  'Activities': ['Date', 'Project Name', 'Stage', 'Done By'],
  'Plant Monitoring': ['Project', 'Brand'],
  'Bill of Items': ['Project Name', 'Item', 'Make'],
  'Expenses': ['Project Name', 'Date', 'Description', 'Amount'],
  'Price Book': ['Item', 'Make'],
};
const PROJECT_COLUMNS = ['Project Name', 'Project'];
// Columns whose value is free text / identity-insensitive in keys are normalised; these stay raw.
const RAW_KEY_COLUMNS = new Set(['Date', 'Assigned date', 'Amount']);
// Row-position counters renumber on every insert — mirroring them would log noise updates.
const IGNORED_COLUMNS = new Set(['S.No', 'No', 'Sl.No', 'S No', ERP_ID_HEADER]);
const SECRET_COLUMNS = new Set(['username', 'password', 'user name', 'pass word']);

type Json = Record<string, unknown>;
interface SourceRow { id: string; spreadsheet_id: string; tabs: string[]; apply_projects: boolean }
interface SnapshotRow {
  row_key: string; project_key: string | null; sheet_row: number; data: Record<string, string>; erp_ref: string | null;
}
interface TabResult { tab: string; ok: boolean; result?: Json; error?: string }

// Mirrors norm() in scripts/reconcile-manivel.ts and gsheet_norm() in mig 224.
const HON = /\b(mr|mrs|ms|dr|prof|messrs|sri|smt|thiru)\b/g;
function norm(s: unknown): string {
  return (s ?? '').toString().toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[._,/\\()\[\]'"`-]/g, ' ')
    .replace(HON, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Google auth (service-account JWT → OAuth access token) ─────────────────

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken(saJson: string): Promise<string> {
  const op = '[getGoogleAccessToken]';
  const sa = JSON.parse(saJson) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SHEETS_SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));

  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  const body = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`${op} token exchange failed: ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  }
  return body.access_token;
}

async function sheetsGet(token: string, url: string, init?: { method: string; body: unknown }): Promise<Json> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init ? { 'Content-Type': 'application/json' } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json() as Json;
  if (!res.ok) {
    const err = (body.error as { code?: number; message?: string } | undefined);
    throw new Error(`Sheets API ${res.status}: ${err?.message ?? 'unknown error'}`);
  }
  return body;
}

// ─── Row shaping ────────────────────────────────────────────────────────────

function shapeTab(tab: string, values: string[][]): SnapshotRow[] {
  if (!values.length) return [];
  const rawHeaders = values[0].map((h) => (h ?? '').toString().trim());
  // Disambiguate duplicate header names so no column silently overwrites another.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    if (!h) return '';
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });

  const keyCols = KEY_COLUMNS[tab] ?? [headers.find((h) => h) ?? ''];
  const projectCol = PROJECT_COLUMNS.find((c) => headers.includes(c)) ?? null;
  const hasId = headers.includes('ID');
  const erpCol = headers.indexOf(ERP_ID_HEADER);
  const dupCount = new Map<string, number>();
  const out: SnapshotRow[] = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const data: Record<string, string> = {};
    let secretPresent = false;
    let anyValue = false;

    headers.forEach((h, c) => {
      if (!h || IGNORED_COLUMNS.has(h)) return;
      const v = (row[c] ?? '').toString().trim();
      if (SECRET_COLUMNS.has(h.toLowerCase())) {
        if (v) secretPresent = true;
        return;
      }
      if (v) anyValue = true;
      data[h] = v;
    });
    if (!anyValue) continue;
    if (headers.some((h) => SECRET_COLUMNS.has(h.toLowerCase()))) data.has_credentials = secretPresent ? 'true' : 'false';

    let baseKey = hasId && data['ID'] ? `id:${data['ID']}` : keyCols
      .map((c) => (RAW_KEY_COLUMNS.has(c) ? (data[c] ?? '') : norm(data[c])))
      .join('·');
    if (!baseKey.replace(/·/g, '')) continue; // no identity at all → cannot be tracked
    const n = (dupCount.get(baseKey) ?? 0) + 1;
    dupCount.set(baseKey, n);
    if (n > 1) baseKey = `${baseKey}#${n}`;

    out.push({
      row_key: baseKey,
      project_key: projectCol && data[projectCol] ? norm(data[projectCol]) : null,
      sheet_row: r + 1,
      data,
      erp_ref: erpCol >= 0 ? ((row[erpCol] ?? '').toString().trim() || null) : null,
    });
  }
  return out;
}

// ─── ERP ID write-back ──────────────────────────────────────────────────────

function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Writes each linked project's ERP number into the Projects tab's "ERP ID" column
 * (created after the last header if missing). Re-reads the tab right before writing
 * and only writes a cell when that row still holds the same Project Name, so a row
 * Manivel inserted or moved seconds earlier is never stamped with the wrong number.
 */
// deno-lint-ignore no-explicit-any
async function writeErpIds(supabase: any, token: string, source: SourceRow): Promise<number> {
  const op = '[writeErpIds]';
  const { data: targets, error } = await supabase
    .from('gsheet_erp_id_targets').select('sheet_row, project_name, project_number').eq('source_id', source.id);
  if (error) throw new Error(`${op} targets: ${error.message}`);
  if (!targets) throw new Error(`${op} targets returned no data`);

  const fresh = await sheetsGet(token, `${SHEETS_API}/${source.spreadsheet_id}/values/${encodeURIComponent("'Projects'")}?valueRenderOption=FORMATTED_VALUE`);
  const values = (fresh.values as string[][] | undefined) ?? [];
  if (!values.length) return 0;

  const headers = values[0].map((h) => (h ?? '').toString().trim());
  const nameCol = headers.indexOf('Project Name');
  if (nameCol < 0) throw new Error(`${op} Projects tab has no "Project Name" header`);
  let erpCol = headers.indexOf(ERP_ID_HEADER);
  const updates: { range: string; values: string[][] }[] = [];
  if (erpCol < 0) {
    erpCol = headers.reduce((last, h, i) => (h ? i : last), -1) + 1;
    updates.push({ range: `'Projects'!${colLetter(erpCol)}1`, values: [[ERP_ID_HEADER]] });
  }

  for (const t of targets as { sheet_row: number; project_name: string | null; project_number: string }[]) {
    const row = values[t.sheet_row - 1];
    if (!row) continue;
    if ((row[nameCol] ?? '').toString().trim() !== (t.project_name ?? '').trim()) continue;
    if ((row[erpCol] ?? '').toString().trim() === t.project_number) continue;
    updates.push({ range: `'Projects'!${colLetter(erpCol)}${t.sheet_row}`, values: [[t.project_number]] });
  }
  if (!updates.length) return 0;

  await sheetsGet(token, `${SHEETS_API}/${source.spreadsheet_id}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data: updates },
  });
  return updates.length;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function syncSource(supabase: any, token: string, source: SourceRow): Promise<TabResult[]> {
  const op = '[syncSource]';
  const { data: run, error: runErr } = await supabase
    .from('gsheet_sync_runs').insert({ source_id: source.id }).select('id').single();
  if (runErr || !run) throw new Error(`${op} could not open run row: ${runErr?.message ?? 'no data'}`);

  const results: TabResult[] = [];
  let status: 'ok' | 'partial' | 'error' = 'ok';
  let fatal: string | null = null;
  const totals = { rows_seen: 0, inserts: 0, updates: 0, removes: 0 };

  try {
    const meta = await sheetsGet(token, `${SHEETS_API}/${source.spreadsheet_id}?fields=sheets.properties.title`);
    const present = new Set(((meta.sheets as { properties: { title: string } }[]) ?? []).map((s) => s.properties.title));
    const tabs = source.tabs.filter((t) => present.has(t));
    for (const t of source.tabs.filter((t) => !present.has(t))) {
      results.push({ tab: t, ok: false, error: 'tab not found in spreadsheet' });
      status = 'partial';
    }

    if (tabs.length) {
      const qs = tabs.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&');
      const batch = await sheetsGet(token, `${SHEETS_API}/${source.spreadsheet_id}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`);
      const ranges = (batch.valueRanges as { values?: string[][] }[]) ?? [];

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        try {
          const rows = shapeTab(tab, ranges[i]?.values ?? []);
          const { data, error } = await supabase.rpc('gsheet_apply_snapshot', {
            p_source: source.id, p_tab: tab, p_rows: rows, p_run_id: run.id,
          });
          if (error) throw new Error(error.message);
          if (!data) throw new Error('gsheet_apply_snapshot returned no data');
          const r = data as { rows: number; inserts: number; updates: number; removes: number };
          totals.rows_seen += r.rows; totals.inserts += r.inserts; totals.updates += r.updates; totals.removes += r.removes;
          results.push({ tab, ok: true, result: data as Json });
        } catch (e) {
          status = 'partial';
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`${op} tab failed`, { source: source.id, tab, error: msg, timestamp: new Date().toISOString() });
          results.push({ tab, ok: false, error: msg });
        }
      }

      // Master source: the sheet wins — apply to ERP projects, then stamp ERP IDs back into the sheet.
      const okTabs = new Set(results.filter((r) => r.ok).map((r) => r.tab));
      if (source.apply_projects && okTabs.has('Projects') && okTabs.has('Budgets')) {
        try {
          const { data, error } = await supabase.rpc('gsheet_apply_projects', {
            p_source: source.id, p_run_id: run.id, p_dry_run: false,
          });
          if (error) throw new Error(error.message);
          if (!data) throw new Error('gsheet_apply_projects returned no data');
          results.push({ tab: '→ ERP projects', ok: true, result: data as Json });

          const written = await writeErpIds(supabase, token, source);
          results.push({ tab: '→ sheet ERP ID', ok: true, result: { cells_written: written } });
        } catch (e) {
          status = 'partial';
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`${op} apply/write-back failed`, { source: source.id, error: msg, timestamp: new Date().toISOString() });
          results.push({ tab: '→ ERP projects', ok: false, error: msg });
        }
      }
    }
  } catch (e) {
    status = 'error';
    fatal = e instanceof Error ? e.message : String(e);
    console.error(`${op} source failed`, { source: source.id, error: fatal, timestamp: new Date().toISOString() });
  }

  if (status === 'partial' && results.every((r) => !r.ok)) status = 'error';
  const errText = fatal ?? (results.filter((r) => !r.ok).map((r) => `${r.tab}: ${r.error}`).join('; ') || null);
  const finishedAt = new Date().toISOString();

  const { error: upRunErr } = await supabase.from('gsheet_sync_runs')
    .update({ ...totals, status, error: errText, finished_at: finishedAt }).eq('id', run.id);
  if (upRunErr) console.error(`${op} run update failed`, { source: source.id, error: upRunErr.message });
  const { error: upSrcErr } = await supabase.from('gsheet_sources')
    .update({ last_run_at: finishedAt, last_status: status, last_error: errText }).eq('id', source.id);
  if (upSrcErr) console.error(`${op} source update failed`, { source: source.id, error: upSrcErr.message });

  console.log(`${op} done`, { source: source.id, status, ...totals });
  return results;
}

async function runSync(onlySource: string | null): Promise<Record<string, TabResult[] | string>> {
  const op = '[runSync]';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const saJson = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '').trim();
  if (!saJson) throw new Error(`${op} GOOGLE_SERVICE_ACCOUNT_JSON not set`);

  let q = supabase.from('gsheet_sources').select('id, spreadsheet_id, tabs, apply_projects').eq('enabled', true);
  if (onlySource) q = q.eq('id', onlySource);
  const { data: sources, error } = await q;
  if (error) throw new Error(`${op} load sources: ${error.message}`);
  if (!sources) throw new Error(`${op} load sources returned no data`);

  const token = await getGoogleAccessToken(saJson);
  const out: Record<string, TabResult[] | string> = {};
  for (const s of sources as SourceRow[]) {
    try {
      out[s.id] = await syncSource(supabase, token, s);
    } catch (e) {
      out[s.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const op = '[gsheet-sync]';
  const secret = (Deno.env.get('GSHEET_SYNC_SECRET') ?? '').trim();
  if (!secret || req.headers.get('x-gsheet-sync-secret') !== secret) {
    console.warn(`${op} unauthorized call`);
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  let body: { source?: string; wait?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body from cron is fine */ }
  const only = typeof body.source === 'string' && body.source ? body.source : null;

  if (body.wait) {
    try {
      const result = await runSync(only);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${op} failed`, { error: msg, timestamp: new Date().toISOString() });
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }
  }

  // @ts-expect-error — EdgeRuntime is a Supabase runtime global
  EdgeRuntime.waitUntil(runSync(only).catch((e) => {
    console.error(`${op} background run failed`, { error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
  }));
  return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
