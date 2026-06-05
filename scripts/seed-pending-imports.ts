/**
 * seed-pending-imports.ts
 *
 * Reads the same XLSX masters that consolidate-master-projects.ts ingests,
 * runs the same consolidation, then INSERTs each unique plant into
 * pending_project_imports via the seed_pending_project_import RPC.
 *
 * Multi-inverter clusters get split into a parent row + N child rows
 * via parent_import_id. The reviewer sees the parent in the UI; on
 * Approve the cascade creates 1 project + N inverter rows.
 *
 * Encryption: portal/local/jio passwords are sent to the RPC as plaintext;
 * the RPC encrypts them via the Vault key before INSERT. Plaintext only
 * exists in transit (TLS-encrypted Supabase API call); not persisted
 * anywhere on disk.
 *
 * Usage:
 *   pnpm tsx scripts/seed-pending-imports.ts --dry-run    # preview, no writes
 *   pnpm tsx scripts/seed-pending-imports.ts              # execute
 *
 * Idempotent: re-running upserts on normalized_name; only pending/approved
 * rows are matched (imported/rejected/error rows are preserved as-is).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve('.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error('.env.local missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ─────────────────────────────────────────────────────────────────────────
// XLSX paths
// ─────────────────────────────────────────────────────────────────────────
const MD_PATH = 'scripts/data/master-data-sheet-2026-06-05.xlsx';
const SE_PATH = 'scripts/data/se-master-file-2026-06-05.xlsx';
const SI_PATH = 'scripts/data/shiroienergy-2026-06-05.xlsx';

function readSheet(path: string, sheetName: string, headerRowIdx: number): {
  header: string[]; rows: (string | number | null)[][];
} {
  const wb = XLSX.read(readFileSync(resolve(path)), { type: 'buffer' });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet '${sheetName}' not found in ${path}`);
  const all = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1, blankrows: false, defval: null, raw: true,
  });
  const header = (all[headerRowIdx] ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
  const rows = all.slice(headerRowIdx + 1).filter((r) => Array.isArray(r) && r.some((c) => c !== null && c !== ''));
  return { header, rows };
}

function xlSerialToISO(serial: number | string | null): string | null {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof serial !== 'number') return null;
  if (serial < 30_000 || serial > 100_000) return null;
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
function clean(s: string | number | null | undefined): string | null {
  if (s == null) return null;
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
}
function normName(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s).toLowerCase()
    .replace(/\bmr\.?\b|\bmrs\.?\b|\bm\/s\b|\bdr\.?\b|\bms\.?\b/gi, '')
    .replace(/_\d+(\.\d+)?\s*kwp?\b/gi, '')
    .replace(/\(\d+(\.\d+)?\s*kw[ph]?\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tokenize(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length >= 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-inverter cluster detection
//
// Returns {clusterKey, isCluster, suffix} for a project name. Same clusterKey
// across multiple rows = they form a cluster; one becomes parent.
// ─────────────────────────────────────────────────────────────────────────
function detectCluster(rawName: string): { clusterKey: string; isCluster: boolean; suffix: string | null } {
  const name = rawName.trim();

  // Pattern: "Mrinal_mills_507Kwp_Inverter_1(125Kwp)"
  const m1 = name.match(/^(.+?)_Inverter_\d+\([^)]*\)$/i);
  if (m1) return { clusterKey: normName(m1[1]!), isCluster: true, suffix: name.slice(m1[1]!.length) };

  // Pattern: "Metal forms-Redhills-110Kw-Inv-1(330Kw)"
  const m2 = name.match(/^(.+?)-Inv-\d+\([^)]*\)$/i);
  if (m2) return { clusterKey: normName(m2[1]!.replace(/-\d+(\.\d+)?Kw$/i, '')), isCluster: true, suffix: name.slice(m2[1]!.length) };

  // Pattern: "SVA syntex pvt.ltd-126.5Kw-Inv-1"
  const m3 = name.match(/^(.+?)-\d+(?:\.\d+)?Kw-Inv-\d+$/i);
  if (m3) return { clusterKey: normName(m3[1]!), isCluster: true, suffix: name.slice(m3[1]!.length) };

  // Pattern: "RKM-17Kw-(32KW)-Inv-1"
  const m4 = name.match(/^(.+?)-\d+(?:\.\d+)?Kw-\(\d+(?:\.\d+)?KW\)-Inv-\d+$/i);
  if (m4) return { clusterKey: normName(m4[1]!), isCluster: true, suffix: name.slice(m4[1]!.length) };

  // Pattern: "Chemfab Alkalis SS_110 KWp" / "DP_11.5 KWp" / "RO_23 KWp"
  const m5 = name.match(/^(.+?Chemfab Alkalis(?: Limited)?(?: Phase II)?)(?:\s+(?:SS|DP|SP|RO))_\d+(?:\.\d+)?\s*KWp?\b/i);
  if (m5) return { clusterKey: normName(m5[1]!), isCluster: true, suffix: name.slice(m5[1]!.length) };

  // Pattern: "Chemfab Sricity _110 KWp" + "Chemfab Sricity _115 KWp"
  const m6 = name.match(/^(Chemfab\s+(?:Sricity|sricity))\s*_\d+(?:\.\d+)?\s*KWp?$/i);
  if (m6) return { clusterKey: normName(m6[1]!), isCluster: true, suffix: name.slice(m6[1]!.length) };

  // Pattern: "Mountmeru _108KWp" + "Mountmeru _87 KWp"
  const m7 = name.match(/^(Mountmeru)\s*_\d+(?:\.\d+)?\s*KWp?$/i);
  if (m7) return { clusterKey: normName(m7[1]!), isCluster: true, suffix: name.slice(m7[1]!.length) };

  // Pattern: "Schangalaya_50 KWp" + "Schangalaya_25 KWp"
  const m8 = name.match(/^(Schangalaya|Schakaralaya|Schakralaya)_\d+(?:\.\d+)?\s*KWp?$/i);
  if (m8) return { clusterKey: normName(m8[1]!), isCluster: true, suffix: name.slice(m8[1]!.length) };

  // Pattern: "RKM1_20 KWp" / "RKM2_20 KWp" / "RKM3_5 KWp"
  const m9 = name.match(/^(RKM)\d+_\d+(?:\.\d+)?\s*KWp?$/i);
  if (m9) return { clusterKey: normName('RKM_legacy'), isCluster: true, suffix: name.slice(m9[1]!.length) };

  // Pattern: "Chemin Enviro System_45KWp" + "_2KWp"
  const m10 = name.match(/^(Chemin Enviro System)_\d+(?:\.\d+)?\s*KWp?$/i);
  if (m10) return { clusterKey: normName(m10[1]!), isCluster: true, suffix: name.slice(m10[1]!.length) };

  return { clusterKey: normName(name), isCluster: false, suffix: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Brand normalization (URL takes precedence over brand column)
// ─────────────────────────────────────────────────────────────────────────
function classifyBrand(url: string | null, brand: string | null): string {
  const u = (url ?? '').toLowerCase();
  if (u) {
    if (u.includes('solarmanpv') || u.includes('solarman')) return 'deye';
    if (u.includes('isolarcloud')) return 'sungrow';
    if (u.includes('growatt')) return 'growatt';
    if (u.includes('auroravision')) return 'fimer';
    if (u.includes('polycabmonitoring')) return 'polycab';
    if (u.includes('power-datacenter')) return 'flin_energy';
    if (u.includes('solarweb') || u.includes('fronius')) return 'fronius';
    if (u.includes('havells')) return 'havells';
    if (u.includes('semsportal')) return 'goodwe';
  }
  const b = (brand ?? '').toLowerCase().trim();
  if (b === 'sungrow') return 'sungrow';
  if (b === 'growatt') return 'growatt';
  if (b === 'deye' || b === 'solarman' || b === 'solar power mobile app') return 'deye';
  if (b === 'goodwe' || b === 'goodwee') return 'goodwe';
  if (b === 'fimer' || b === 'abb' || b === 'auroravision') return 'fimer';
  if (b === 'polycab') return 'polycab';
  if (b === 'havells') return 'havells';
  if (b === 'flin energy' || b === 'flin_energy') return 'flin_energy';
  if (b === 'fronius' || b === 'fronious' || b === 'fronius solar web' || b === 'fronious solar web') return 'fronius';
  if (b === 'sma') return 'sma';
  if (b === 'huawei') return 'huawei';
  if (b === 'solis') return 'solis';
  return 'other';
}

function normalizeSystemType(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.toLowerCase().trim();
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('off')) return 'off_grid';
  if (v.includes('on')) return 'on_grid';
  return null;
}
function normalizeCategory(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.toLowerCase().trim();
  if (v.includes('industrial')) return 'industrial';
  if (v.includes('commercial')) return 'commercial';
  if (v.includes('residential') || v.includes('residence')) return 'residential';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Parse all sheets (same as the consolidator)
// ─────────────────────────────────────────────────────────────────────────

interface RawPlant {
  primary_name: string;
  normalized: string;
  cluster_key: string;
  cluster_suffix: string | null;
  is_cluster_member: boolean;
  source_sheets: { sheet: string; raw: string }[];
  // facts
  source_status?: string | null;
  source_year?: number | null;
  system_size_kwp?: number | null;
  system_type?: string | null;
  net_meter?: string | null;
  rooftop_sqft?: number | null;
  industry?: string | null;
  category?: string | null;
  mounting_type?: string | null;
  cable_make?: string | null;
  la_scope?: string | null;
  lifetime_kwh?: number | null;
  project_cost?: number | null;
  actual_cost?: number | null;
  profit_inr?: number | null;
  panel_make?: string | null;
  panel_model?: string | null;
  panel_wattage?: number | null;
  panel_qty?: number | null;
  inverter_make?: string | null;
  inverter_model?: string | null;
  inverter_capacity_kw?: number | null;
  inverter_qty?: number | null;
  inverter_serial_number?: string | null;
  inverter_power_module_sn?: string | null;
  acdb_sn?: string | null;
  dcdb_sn?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  google_maps_url?: string | null;
  folder_link?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  commissioning_date?: string | null;
  portal_brand?: string | null;
  portal_url?: string | null;
  portal_username?: string | null;
  portal_password?: string | null;
  local_login_ip?: string | null;
  local_admin_user?: string | null;
  local_admin_password?: string | null;
  local_user?: string | null;
  local_user_password?: string | null;
  internet_type?: string | null;
  jio_password?: string | null;
  jio_primary_sim?: string | null;
  jio_backup_sim?: string | null;
  datalogger_mac?: string | null;
  datalogger_pk?: string | null;
  amc_type?: string | null;
  amc_visits?: Array<{ scheduled: string | null; completed: string | null }>;
  remarks?: string | null;
}

const plants = new Map<string, RawPlant>();
const clusterMembers: { clusterKey: string; member: RawPlant }[] = [];

function ensure(rawName: string, sheet: string): RawPlant {
  const cleaned = clean(rawName) ?? rawName;
  const { clusterKey, isCluster, suffix } = detectCluster(cleaned);
  const norm = normName(cleaned);

  if (isCluster) {
    // Cluster members get tracked separately; cluster parent uses clusterKey
    let parent = plants.get(clusterKey);
    if (!parent) {
      parent = {
        primary_name: cleaned.replace(/\s*[_-]+(SS|DP|SP|RO)?_?\d.*$/i, '').trim() || cleaned,
        normalized: clusterKey,
        cluster_key: clusterKey,
        cluster_suffix: null,
        is_cluster_member: false,
        source_sheets: [],
      };
      plants.set(clusterKey, parent);
    }
    if (!parent.source_sheets.find((s) => s.sheet === sheet && s.raw === cleaned)) {
      parent.source_sheets.push({ sheet, raw: cleaned });
    }
    // Each row creates a cluster member (for inverter sub-records)
    const member: RawPlant = {
      primary_name: cleaned,
      normalized: norm,
      cluster_key: clusterKey,
      cluster_suffix: suffix,
      is_cluster_member: true,
      source_sheets: [{ sheet, raw: cleaned }],
    };
    clusterMembers.push({ clusterKey, member });
    return member;
  }

  let p = plants.get(norm);
  if (!p) {
    p = {
      primary_name: cleaned,
      normalized: norm,
      cluster_key: norm,
      cluster_suffix: null,
      is_cluster_member: false,
      source_sheets: [],
    };
    plants.set(norm, p);
  }
  if (!p.source_sheets.find((s) => s.sheet === sheet && s.raw === cleaned)) {
    p.source_sheets.push({ sheet, raw: cleaned });
  }
  return p;
}

function setIfEmpty<K extends keyof RawPlant>(p: RawPlant, k: K, v: RawPlant[K]) {
  if (v == null || v === '') return;
  if (p[k] == null || p[k] === '') p[k] = v;
}

// ── shiroienergy.Projects (canonical: status + year + location) ──
const siProj = readSheet(SI_PATH, 'Projects', 0);
for (const r of siProj.rows) {
  const name = clean(r[1] as string); if (!name || /^\d+$/.test(name)) continue;
  const p = ensure(name, 'shiroienergy.Projects');
  setIfEmpty(p, 'system_size_kwp', typeof r[2] === 'number' ? r[2] : null);
  setIfEmpty(p, 'source_status', clean(r[3] as string));
  setIfEmpty(p, 'city', clean(r[4] as string));
  setIfEmpty(p, 'folder_link', clean(r[5] as string));
  setIfEmpty(p, 'source_year', typeof r[6] === 'number' ? r[6] : null);
  setIfEmpty(p, 'remarks', clean(r[7] as string));
}

// ── shiroienergy.Budgets ──
const siBudg = readSheet(SI_PATH, 'Budgets', 0);
for (const r of siBudg.rows) {
  const name = clean(r[1] as string); if (!name) continue;
  const p = ensure(name, 'shiroienergy.Budgets');
  setIfEmpty(p, 'system_size_kwp', typeof r[2] === 'number' ? r[2] : null);
  setIfEmpty(p, 'source_status', clean(r[3] as string));
  setIfEmpty(p, 'project_cost', typeof r[4] === 'number' ? r[4] : null);
  setIfEmpty(p, 'actual_cost', typeof r[5] === 'number' ? r[5] : null);
  setIfEmpty(p, 'source_year', typeof r[8] === 'number' ? r[8] : null);
  setIfEmpty(p, 'profit_inr', typeof r[9] === 'number' ? r[9] : null);
}

// ── shiroienergy.Project details (rich contact + hardware) ──
const siDet = readSheet(SI_PATH, 'Project details', 0);
for (const r of siDet.rows) {
  const name = clean(r[0] as string); if (!name) continue;
  const p = ensure(name, 'shiroienergy.Project details');
  setIfEmpty(p, 'contact_phone', r[2] == null ? null : String(r[2]));
  setIfEmpty(p, 'contact_email', clean(r[3] as string));
  setIfEmpty(p, 'address_line1', clean(r[4] as string));
  setIfEmpty(p, 'google_maps_url', clean(r[6] as string));
  setIfEmpty(p, 'category', normalizeCategory(clean(r[8] as string)));
  setIfEmpty(p, 'mounting_type', clean(r[9] as string));
  setIfEmpty(p, 'system_type', normalizeSystemType(clean(r[10] as string)));
  setIfEmpty(p, 'panel_make', clean(r[11] as string));
  setIfEmpty(p, 'inverter_make', clean(r[12] as string));
  setIfEmpty(p, 'cable_make', clean(r[13] as string));
  setIfEmpty(p, 'la_scope', clean(r[14] as string));
}

// ── shiroienergy.Plant Monitoring (creds) ──
const siPm = readSheet(SI_PATH, 'Plant Monitoring', 0);
for (const r of siPm.rows) {
  const name = clean(r[0] as string); if (!name) continue;
  const p = ensure(name, 'shiroienergy.Plant Monitoring');
  setIfEmpty(p, 'portal_brand', clean(r[1] as string));
  setIfEmpty(p, 'portal_username', r[2] == null ? null : String(r[2]).trim());
  setIfEmpty(p, 'portal_password', r[3] == null ? null : String(r[3]).trim());
  setIfEmpty(p, 'portal_url', clean(r[4] as string));
}

// ── Master Data Sheet / Sheet2 (hardware enrichment) ──
const sheet2 = readSheet(MD_PATH, 'Sheet2', 0);
for (const r of sheet2.rows) {
  const name = clean(r[1] as string); if (!name || /^\d+$/.test(name)) continue;
  const p = ensure(name, 'Sheet2');
  setIfEmpty(p, 'system_size_kwp', typeof r[2] === 'number' ? r[2] : null);
  setIfEmpty(p, 'system_type', normalizeSystemType(clean(r[3] as string)));
  setIfEmpty(p, 'net_meter', clean(r[4] as string));
  setIfEmpty(p, 'source_status', clean(r[5] as string));
  setIfEmpty(p, 'panel_make', clean(r[6] as string));
  setIfEmpty(p, 'panel_wattage', typeof r[7] === 'number' ? r[7] : null);
  setIfEmpty(p, 'panel_qty', typeof r[8] === 'number' ? r[8] : null);
  setIfEmpty(p, 'inverter_make', clean(r[9] as string));
  setIfEmpty(p, 'inverter_qty', typeof r[10] === 'number' ? r[10] : null);
  setIfEmpty(p, 'inverter_capacity_kw', typeof r[11] === 'number' ? r[11] : null);
  setIfEmpty(p, 'address_line1', clean(r[12] as string));
  setIfEmpty(p, 'google_maps_url', clean(r[13] as string));
  setIfEmpty(p, 'contact_phone', r[14] == null ? null : String(r[14]));
  setIfEmpty(p, 'contact_name', clean(r[15] as string));
  setIfEmpty(p, 'commissioning_date', xlSerialToISO(r[16] ?? null));
  setIfEmpty(p, 'contact_email', clean(r[17] as string));
  setIfEmpty(p, 'inverter_serial_number', clean(r[18] as string));
}

// ── Master Data Sheet / LIST OF PROJECTS-DM ──
const dm = readSheet(MD_PATH, 'LIST OF PROJECTS- DM', 0);
for (const r of dm.rows) {
  const name = clean(r[1] as string); if (!name || name === 'Client Name') continue;
  const p = ensure(name, 'LIST OF PROJECTS-DM');
  setIfEmpty(p, 'rooftop_sqft', typeof r[5] === 'number' ? r[5] : null);
  setIfEmpty(p, 'industry', clean(r[6] as string));
  setIfEmpty(p, 'category', normalizeCategory(clean(r[7] as string)));
  setIfEmpty(p, 'commissioning_date', r[8] == null ? null : (typeof r[8] === 'number' ? xlSerialToISO(r[8]) : clean(String(r[8]))));
  setIfEmpty(p, 'lifetime_kwh', typeof r[9] === 'number' ? r[9] : null);
}

// ── SE Master / Project Report ──
const pr = readSheet(SE_PATH, 'Project Report', 0);
for (const r of pr.rows) {
  const name = clean(r[1] as string); if (!name) continue;
  const p = ensure(name, 'Project Report');
  setIfEmpty(p, 'system_size_kwp', typeof r[2] === 'number' ? r[2] : null);
  setIfEmpty(p, 'source_status', clean(r[3] as string));
  setIfEmpty(p, 'city', clean(r[4] as string));
}

// ── SE Master / Project details (AMC tracker) ──
const pd = readSheet(SE_PATH, 'Project details', 0);
for (const r of pd.rows) {
  const name = clean(r[1] as string); if (!name) continue;
  const p = ensure(name, 'Project details');
  setIfEmpty(p, 'system_size_kwp', typeof r[2] === 'number' ? r[2] : null);
  setIfEmpty(p, 'city', clean(r[3] as string));
  setIfEmpty(p, 'amc_type', clean(r[8] as string));
  const amcs: Array<{ scheduled: string | null; completed: string | null }> = [];
  const visitPairs: Array<[number, number]> = [[9, 10], [11, 12], [13, 14], [15, 16]];
  for (const [sIdx, cIdx] of visitPairs) {
    const sched = r[sIdx] == null ? null : (typeof r[sIdx] === 'number' ? xlSerialToISO(r[sIdx] as number) : clean(String(r[sIdx])));
    const comp = r[cIdx] == null ? null : (typeof r[cIdx] === 'number' ? xlSerialToISO(r[cIdx] as number) : clean(String(r[cIdx])));
    if (sched || comp) amcs.push({ scheduled: sched, completed: comp });
  }
  if (amcs.length > 0 && (!p.amc_visits || p.amc_visits.length === 0)) p.amc_visits = amcs;
  setIfEmpty(p, 'contact_phone', clean(r[17] as string));
  setIfEmpty(p, 'contact_email', clean(r[18] as string));
  setIfEmpty(p, 'commissioning_date', r[7] == null ? null : (typeof r[7] === 'number' ? xlSerialToISO(r[7]) : clean(String(r[7]))));
}

// ── Master Data Sheet / SE_PASSWORD (datalogger + LAN creds) ──
const sePw = readSheet(MD_PATH, 'SE_PASSWORD', 2);
for (const r of sePw.rows) {
  const name = clean(r[1] as string); if (!name || name === 'Plant Name & Description') continue;
  const p = ensure(name, 'SE_PASSWORD');
  setIfEmpty(p, 'portal_brand', clean(r[3] as string));
  setIfEmpty(p, 'portal_username', r[4] == null ? null : String(r[4]).trim());
  setIfEmpty(p, 'portal_password', r[5] == null ? null : String(r[5]).trim());
  setIfEmpty(p, 'local_login_ip', clean(r[6] as string));
  setIfEmpty(p, 'local_admin_user', clean(r[7] as string));
  setIfEmpty(p, 'local_admin_password', r[8] == null ? null : String(r[8]).trim());
  setIfEmpty(p, 'local_user', clean(r[9] as string));
  setIfEmpty(p, 'local_user_password', r[10] == null ? null : String(r[10]).trim());
  setIfEmpty(p, 'internet_type', clean(r[11] as string));
  setIfEmpty(p, 'jio_password', r[12] == null ? null : String(r[12]).trim());
  setIfEmpty(p, 'jio_primary_sim', r[13] == null ? null : String(r[13]));
  setIfEmpty(p, 'jio_backup_sim', r[14] == null ? null : String(r[14]));
  setIfEmpty(p, 'datalogger_mac', clean(r[15] as string));
  setIfEmpty(p, 'datalogger_pk', clean(r[16] as string));
  setIfEmpty(p, 'inverter_serial_number', clean(r[17] as string));
  setIfEmpty(p, 'inverter_power_module_sn', clean(r[18] as string));
  setIfEmpty(p, 'acdb_sn', clean(r[19] as string));
  setIfEmpty(p, 'dcdb_sn', clean(r[20] as string));
}

console.log(`Parsed: ${plants.size} unique plants (parents) + ${clusterMembers.length} cluster members`);

// ─────────────────────────────────────────────────────────────────────────
// Match against existing projects
// ─────────────────────────────────────────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { autoRefreshToken: false, persistSession: false } });

interface ExistingProject {
  id: string; project_number: string | null; customer_name: string | null;
}

async function fetchExisting(): Promise<ExistingProject[]> {
  const out: ExistingProject[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('projects')
      .select('id, project_number, customer_name')
      .is('deleted_at', null)
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as ExistingProject[]));
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function main() {
const existing = await fetchExisting();
console.log(`Fetched ${existing.length} existing projects for matching`);
const existingTokenized = existing.map((p) => ({
  ...p, norm: normName(p.customer_name ?? ''), tokens: tokenize(normName(p.customer_name ?? '')),
}));

function match(p: RawPlant): { id: string | null; name: string | null; confidence: 'exact' | 'fuzzy' | 'none'; score: number } {
  if (!p.normalized) return { id: null, name: null, confidence: 'none', score: 0 };
  const recTokens = tokenize(p.normalized);
  let bestId: string | null = null; let bestScore = 0; let bestName: string | null = null;
  for (const e of existingTokenized) {
    if (!e.norm) continue;
    if (e.norm === p.normalized) return { id: e.id, name: e.customer_name, confidence: 'exact', score: 1.0 };
    const s = jaccard(recTokens, e.tokens);
    if (s > bestScore) { bestScore = s; bestId = e.id; bestName = e.customer_name; }
  }
  if (bestScore >= 0.6) return { id: bestId, name: bestName, confidence: 'fuzzy', score: bestScore };
  return { id: bestId, name: bestName, confidence: 'none', score: bestScore };
}

// ─────────────────────────────────────────────────────────────────────────
// Build JSON payloads and seed
// ─────────────────────────────────────────────────────────────────────────
function buildPayload(p: RawPlant, parentImportId: string | null, matchOutcome?: { id: string | null; name: string | null; confidence: 'exact' | 'fuzzy' | 'none'; score: number }): Record<string, unknown> {
  const portalBrand = classifyBrand(p.portal_url ?? null, p.portal_brand ?? null);
  return {
    project_name: p.primary_name,
    normalized_name: parentImportId ? p.primary_name.toLowerCase() : p.normalized,
    source_sheets: p.source_sheets,
    is_multi_inverter_parent: parentImportId === null && plants.has(p.cluster_key) && clusterMembers.some((m) => m.clusterKey === p.cluster_key),
    parent_import_id: parentImportId,
    matched_project_id: matchOutcome?.id ?? null,
    matched_customer_name: matchOutcome?.name ?? null,
    match_confidence: matchOutcome?.confidence ?? 'none',
    match_score: matchOutcome ? String(matchOutcome.score.toFixed(3)) : '0',
    source_status: p.source_status,
    source_year: p.source_year != null ? String(p.source_year) : null,
    system_size_kwp: p.system_size_kwp != null ? String(p.system_size_kwp) : null,
    system_type: p.system_type,
    net_meter: p.net_meter,
    rooftop_sqft: p.rooftop_sqft != null ? String(p.rooftop_sqft) : null,
    industry: p.industry,
    category: p.category,
    mounting_type: p.mounting_type,
    cable_make: p.cable_make,
    la_scope: p.la_scope,
    lifetime_kwh: p.lifetime_kwh != null ? String(p.lifetime_kwh) : null,
    project_cost: p.project_cost != null ? String(p.project_cost) : null,
    actual_cost: p.actual_cost != null ? String(p.actual_cost) : null,
    profit_inr: p.profit_inr != null ? String(p.profit_inr) : null,
    panel_make: p.panel_make,
    panel_model: p.panel_model,
    panel_wattage: p.panel_wattage != null ? String(p.panel_wattage) : null,
    panel_qty: p.panel_qty != null ? String(p.panel_qty) : null,
    inverter_make: p.inverter_make,
    inverter_model: p.inverter_model,
    inverter_capacity_kw: p.inverter_capacity_kw != null ? String(p.inverter_capacity_kw) : null,
    inverter_qty: p.inverter_qty != null ? String(p.inverter_qty) : null,
    inverter_serial_number: p.inverter_serial_number,
    inverter_power_module_sn: p.inverter_power_module_sn,
    acdb_sn: p.acdb_sn,
    dcdb_sn: p.dcdb_sn,
    address_line1: p.address_line1,
    city: p.city,
    state: p.state ?? 'Tamil Nadu',
    pincode: p.pincode,
    google_maps_url: p.google_maps_url,
    folder_link: p.folder_link,
    contact_name: p.contact_name,
    contact_phone: p.contact_phone,
    contact_email: p.contact_email,
    commissioning_date: p.commissioning_date,
    portal_brand: portalBrand !== 'other' ? portalBrand : p.portal_brand,
    portal_url: p.portal_url,
    portal_username: p.portal_username,
    portal_password: p.portal_password,
    local_login_ip: p.local_login_ip,
    local_admin_user: p.local_admin_user,
    local_admin_password: p.local_admin_password,
    local_user: p.local_user,
    local_user_password: p.local_user_password,
    internet_type: p.internet_type,
    jio_password: p.jio_password,
    jio_primary_sim: p.jio_primary_sim,
    jio_backup_sim: p.jio_backup_sim,
    datalogger_mac: p.datalogger_mac,
    datalogger_pk: p.datalogger_pk,
    amc_type: p.amc_type,
    amc_visits: p.amc_visits ?? [],
    remarks: p.remarks,
  };
}

const parents = [...plants.values()].filter((p) => p.normalized !== '');
console.log(`Plants to seed: ${parents.length} parents + ${clusterMembers.length} children`);

if (DRY_RUN) {
  console.log(`\n--- DRY RUN ---\n`);
  let sample = parents.slice(0, 3);
  for (const s of sample) {
    const m = match(s);
    console.log(`PARENT: ${s.primary_name} → match=${m.confidence}/${m.score.toFixed(2)} ${m.name ? `→ ${m.name}` : ''}`);
    if (VERBOSE) console.log(JSON.stringify(buildPayload(s, null, m), null, 2).slice(0, 500));
  }
  console.log(`\n(showing first 3 of ${parents.length}; rerun without --dry-run to seed)`);
  process.exit(0);
}

let okCount = 0, errCount = 0;
const parentIdMap = new Map<string, string>(); // cluster_key → parent_import_id

// First pass: insert parents
for (const p of parents) {
  const m = match(p);
  const payload = buildPayload(p, null, m);
  const { data, error } = await sb.rpc('seed_pending_project_import', { p_data: payload });
  if (error) {
    console.error(`ERR seeding "${p.primary_name}": ${error.message}`);
    errCount++;
    continue;
  }
  okCount++;
  if (typeof data === 'string') parentIdMap.set(p.cluster_key, data);
  if (okCount % 25 === 0) console.log(`  seeded ${okCount}/${parents.length} parents`);
}

// Second pass: insert cluster children
let childOk = 0, childErr = 0;
for (const { clusterKey, member } of clusterMembers) {
  const parentId = parentIdMap.get(clusterKey);
  if (!parentId) { childErr++; continue; }
  const payload = buildPayload(member, parentId);
  const { error } = await sb.rpc('seed_pending_project_import', { p_data: payload });
  if (error) { console.error(`ERR child "${member.primary_name}": ${error.message}`); childErr++; continue; }
  childOk++;
}

console.log(`\nDone: parents ok=${okCount} err=${errCount} | children ok=${childOk} err=${childErr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
