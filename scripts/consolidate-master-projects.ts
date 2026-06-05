/**
 * consolidate-master-projects.ts
 *
 * Reads the two XLSX masters Vivek dropped 2026-06-05:
 *   - scripts/data/master-data-sheet-2026-06-05.xlsx (Sheet2, LIST OF PROJECTS-DM, SE_PASSWORD)
 *   - scripts/data/se-master-file-2026-06-05.xlsx    (Project Report, Project details)
 *
 * Normalizes plant names, cross-joins on best fuzzy match, then matches
 * each consolidated record against the existing projects table in dev
 * (415 rows). Produces:
 *
 *   scripts/data/master-projects-import-plan-2026-06-05.md
 *
 * Three sections:
 *   1. MATCHED-EXACT   — clean overlay onto existing project
 *   2. MATCHED-FUZZY   — likely overlay, needs Vivek's eyeball
 *   3. NEEDS-CREATE    — new projects row required, draft SQL included
 *
 * No DB writes. Read-only against projects. Run separately from the
 * bulk importer.
 *
 * Usage: pnpm tsx scripts/consolidate-master-projects.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve('.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SUPABASE_SECRET) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required in .env.local');
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

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

// Convert Excel serial date → YYYY-MM-DD
function xlSerialToISO(serial: number | string | null): string | null {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof serial !== 'number') return null;
  // Guard: only treat values >= 30000 (~1982) as Excel serial dates.
  // Small numbers (5, 11, 12) are typically size/qty columns, not dates.
  if (serial < 30_000 || serial > 100_000) return null;
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function clean(s: string | null): string | null {
  if (s == null) return null;
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function normName(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/\bmr\.?\b|\bmrs\.?\b|\bm\/s\b|\bdr\.?\b|\bms\.?\b/gi, '')
    .replace(/_\d+(\.\d+)?\s*kwp?\b/gi, '')
    .replace(/\(\d+(\.\d+)?\s*kw[ph]?\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length >= 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ─────────────────────────────────────────────────────────────────────────
// Parse each sheet
// ─────────────────────────────────────────────────────────────────────────

const MD_PATH = 'scripts/data/master-data-sheet-2026-06-05.xlsx';
const SE_PATH = 'scripts/data/se-master-file-2026-06-05.xlsx';
const SI_PATH = 'scripts/data/shiroienergy-2026-06-05.xlsx';

// Sheet2: 170 rows — primary master with hardware specs
const sheet2 = readSheet(MD_PATH, 'Sheet2', 0);
// Columns: S.No | Client Name | Project Size(KW) | System Type | Net Meter | Status | Module Make | Module Capacity (Wp) | Module Qty | Inverter Make | Inverter Qty | Inverter Capacity | Client's Address | Google Map Location | Contact No | Contact Name | Commissioning Date | Mail ID | Inverter SN
type Sheet2Row = {
  client_name: string;
  system_size_kwp: number | null;
  system_type: string | null;
  net_meter: string | null;
  status: string | null;
  module_make: string | null;
  module_wattage: number | null;
  module_qty: number | null;
  inverter_make: string | null;
  inverter_qty: number | null;
  inverter_capacity: number | null;
  address: string | null;
  google_maps: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  commissioning_date: string | null;
  email: string | null;
  inverter_sn: string | null;
};
const sheet2Rows: Sheet2Row[] = sheet2.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '')
  .map((r) => ({
    client_name: String(r[1] ?? '').trim(),
    system_size_kwp: typeof r[2] === 'number' ? r[2] : null,
    system_type: r[3] == null ? null : String(r[3]).trim(),
    net_meter: r[4] == null ? null : String(r[4]).trim(),
    status: r[5] == null ? null : String(r[5]).trim(),
    module_make: r[6] == null ? null : String(r[6]).trim(),
    module_wattage: typeof r[7] === 'number' ? r[7] : null,
    module_qty: typeof r[8] === 'number' ? r[8] : null,
    inverter_make: r[9] == null ? null : String(r[9]).trim(),
    inverter_qty: typeof r[10] === 'number' ? r[10] : null,
    inverter_capacity: typeof r[11] === 'number' ? r[11] : null,
    address: r[12] == null ? null : String(r[12]).trim(),
    google_maps: r[13] == null ? null : String(r[13]).trim(),
    contact_phone: r[14] == null ? null : String(r[14]).trim(),
    contact_name: r[15] == null ? null : String(r[15]).trim(),
    commissioning_date: xlSerialToISO(r[16] ?? null),
    email: r[17] == null ? null : String(r[17]).trim(),
    inverter_sn: r[18] == null ? null : String(r[18]).trim(),
  }));
console.log(`Sheet2 parsed: ${sheet2Rows.length} rows`);

// LIST OF PROJECTS-DM: 62 rows — financial + industry + lifetime production
const dmSheet = readSheet(MD_PATH, 'LIST OF PROJECTS- DM', 0);
// Columns include: S.No | Client Name | Project Size(KW) | System Type | Net Meter | Rooftop Size (square feet) | Industry Name | Project Type (Res/Ind/Comm) | Commissioned on | Estimated Lifetime Production | ...
type DmRow = {
  client_name: string;
  rooftop_sqft: number | null;
  industry: string | null;
  project_type: string | null;
  commissioned_on: string | null;
  lifetime_kwh: number | null;
};
const dmRows: DmRow[] = dmSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '' && String(r[1]).trim() !== 'Client Name')
  .map((r) => ({
    client_name: String(r[1] ?? '').trim(),
    rooftop_sqft: typeof r[5] === 'number' ? r[5] : null,
    industry: r[6] == null ? null : String(r[6]).trim(),
    project_type: r[7] == null ? null : String(r[7]).trim(),
    commissioned_on: r[8] == null ? null : (typeof r[8] === 'number' ? xlSerialToISO(r[8]) : String(r[8]).trim()),
    lifetime_kwh: typeof r[9] === 'number' ? r[9] : null,
  }));
console.log(`LIST OF PROJECTS-DM parsed: ${dmRows.length} rows`);

// Project Report (SE Master): 79 rows — status + completion %
const prSheet = readSheet(SE_PATH, 'Project Report', 0);
// Columns: S.No | Project /Task Name | Sys Size | Status | Location | Asg to | ...
type PrRow = {
  project_name: string;
  system_size_kwp: number | null;
  status: string | null;
  location: string | null;
  assigned_to: string | null;
  percent_done: number | null;
};
const prRows: PrRow[] = prSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '')
  .map((r) => ({
    project_name: String(r[1] ?? '').trim(),
    system_size_kwp: typeof r[2] === 'number' ? r[2] : null,
    status: r[3] == null ? null : String(r[3]).trim(),
    location: r[4] == null ? null : String(r[4]).trim(),
    assigned_to: r[5] == null ? null : String(r[5]).trim(),
    percent_done: typeof r[12] === 'number' ? r[12] : null,
  }));
console.log(`Project Report parsed: ${prRows.length} rows`);

// Project details (SE Master): 66 rows — AMC tracker + portal login
const pdSheet = readSheet(SE_PATH, 'Project details', 0);
// Columns: S.No | Project /Task Name | Sys Size | Location | Panel | Inverter | No of String | Commissiong Date | AMC type | First AMC | 1st AMC Completed Dat | 2nd AMC | 2nd AMC Completed date | 3rd AMC | 3rd AMC Completed Date | 4th AMC | 4th AMC Completed Date | Contact No | Mail ID | Login details
type PdRow = {
  project_name: string;
  system_size_kwp: number | null;
  location: string | null;
  panel: string | null;
  inverter: string | null;
  strings: string | null;
  commissioning_date: string | null;
  amc_type: string | null;
  amc1_scheduled: string | null;
  amc1_completed: string | null;
  amc2_scheduled: string | null;
  amc2_completed: string | null;
  amc3_scheduled: string | null;
  amc3_completed: string | null;
  amc4_scheduled: string | null;
  amc4_completed: string | null;
  contact: string | null;
  email: string | null;
  login: string | null;
};
const pdRows: PdRow[] = pdSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '')
  .map((r) => ({
    project_name: String(r[1] ?? '').trim(),
    system_size_kwp: typeof r[2] === 'number' ? r[2] : null,
    location: r[3] == null ? null : String(r[3]).trim(),
    panel: r[4] == null ? null : String(r[4]).trim(),
    inverter: r[5] == null ? null : String(r[5]).trim(),
    strings: r[6] == null ? null : String(r[6]).trim(),
    commissioning_date: r[7] == null ? null : (typeof r[7] === 'number' ? xlSerialToISO(r[7]) : String(r[7]).trim()),
    amc_type: r[8] == null ? null : String(r[8]).trim(),
    amc1_scheduled: r[9] == null ? null : (typeof r[9] === 'number' ? xlSerialToISO(r[9]) : String(r[9]).trim()),
    amc1_completed: r[10] == null ? null : (typeof r[10] === 'number' ? xlSerialToISO(r[10]) : String(r[10]).trim()),
    amc2_scheduled: r[11] == null ? null : (typeof r[11] === 'number' ? xlSerialToISO(r[11]) : String(r[11]).trim()),
    amc2_completed: r[12] == null ? null : (typeof r[12] === 'number' ? xlSerialToISO(r[12]) : String(r[12]).trim()),
    amc3_scheduled: r[13] == null ? null : (typeof r[13] === 'number' ? xlSerialToISO(r[13]) : String(r[13]).trim()),
    amc3_completed: r[14] == null ? null : (typeof r[14] === 'number' ? xlSerialToISO(r[14]) : String(r[14]).trim()),
    amc4_scheduled: r[15] == null ? null : (typeof r[15] === 'number' ? xlSerialToISO(r[15]) : String(r[15]).trim()),
    amc4_completed: r[16] == null ? null : (typeof r[16] === 'number' ? xlSerialToISO(r[16]) : String(r[16]).trim()),
    contact: r[17] == null ? null : String(r[17]).trim(),
    email: r[18] == null ? null : String(r[18]).trim(),
    login: r[19] == null ? null : String(r[19]).trim(),
  }));
console.log(`Project details parsed: ${pdRows.length} rows`);

// shiroienergy.Projects: 267 rows — CANONICAL project list with Status + Year
const siProjSheet = readSheet(SI_PATH, 'Projects', 0);
type SiProjRow = {
  project_name: string;
  size_kwp: number | null;
  status: string | null;
  location: string | null;
  folder_link: string | null;
  year: number | null;
  remarks: string | null;
};
const siProjRows: SiProjRow[] = siProjSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '')
  .map((r) => ({
    project_name: String(r[1] ?? '').trim(),
    size_kwp: typeof r[2] === 'number' ? r[2] : null,
    status: clean(r[3] == null ? null : String(r[3])),
    location: clean(r[4] == null ? null : String(r[4])),
    folder_link: clean(r[5] == null ? null : String(r[5])),
    year: typeof r[6] === 'number' ? r[6] : null,
    remarks: clean(r[7] == null ? null : String(r[7])),
  }));
console.log(`shiroienergy.Projects parsed: ${siProjRows.length} rows`);

// shiroienergy.Budgets: 267 rows — financial data per project
const siBudgSheet = readSheet(SI_PATH, 'Budgets', 0);
type SiBudgRow = {
  project_name: string;
  size_kwp: number | null;
  status: string | null;
  project_cost: number | null;
  actual_cost: number | null;
  est_profit_pct: number | null;
  act_profit_pct: number | null;
  year: number | null;
  profit_inr: number | null;
};
const siBudgRows: SiBudgRow[] = siBudgSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '')
  .map((r) => ({
    project_name: String(r[1] ?? '').trim(),
    size_kwp: typeof r[2] === 'number' ? r[2] : null,
    status: clean(r[3] == null ? null : String(r[3])),
    project_cost: typeof r[4] === 'number' ? r[4] : null,
    actual_cost: typeof r[5] === 'number' ? r[5] : null,
    est_profit_pct: typeof r[6] === 'number' ? r[6] : null,
    act_profit_pct: typeof r[7] === 'number' ? r[7] : null,
    year: typeof r[8] === 'number' ? r[8] : null,
    profit_inr: typeof r[9] === 'number' ? r[9] : null,
  }));
console.log(`shiroienergy.Budgets parsed: ${siBudgRows.length} rows`);

// shiroienergy.Project details: 22 rows — detailed per-project metadata
const siDetSheet = readSheet(SI_PATH, 'Project details', 0);
type SiDetRow = {
  project_name: string;
  client_name: string | null;
  mobile: string | null;
  email: string | null;
  shipping_address: string | null;
  billing_address: string | null;
  google_maps: string | null;
  sys_size: string | null;
  category: string | null;
  mounting_type: string | null;
  type_of_sys: string | null;
  panel_make_qty: string | null;
  inverter_make_qty: string | null;
  cable_make: string | null;
  la_scope: string | null;
};
const siDetRows: SiDetRow[] = siDetSheet.rows
  .filter((r) => r[0] != null && String(r[0]).trim() !== '')
  .map((r) => ({
    project_name: String(r[0] ?? '').trim(),
    client_name: clean(r[1] == null ? null : String(r[1])),
    mobile: r[2] == null ? null : String(r[2]).trim(),
    email: clean(r[3] == null ? null : String(r[3])),
    shipping_address: clean(r[4] == null ? null : String(r[4])),
    billing_address: clean(r[5] == null ? null : String(r[5])),
    google_maps: clean(r[6] == null ? null : String(r[6])),
    sys_size: clean(r[7] == null ? null : String(r[7])),
    category: clean(r[8] == null ? null : String(r[8])),
    mounting_type: clean(r[9] == null ? null : String(r[9])),
    type_of_sys: clean(r[10] == null ? null : String(r[10])),
    panel_make_qty: clean(r[11] == null ? null : String(r[11])),
    inverter_make_qty: clean(r[12] == null ? null : String(r[12])),
    cable_make: clean(r[13] == null ? null : String(r[13])),
    la_scope: clean(r[14] == null ? null : String(r[14])),
  }));
console.log(`shiroienergy.Project details parsed: ${siDetRows.length} rows`);

// shiroienergy.Plant Monitoring: 186 rows — credentials (same as earlier dump, more authoritative)
const siPmSheet = readSheet(SI_PATH, 'Plant Monitoring', 0);
type SiPmRow = {
  project_name: string;
  brand: string | null;
  username: string | null;
  password: string | null;
  link: string | null;
  created: string | null;
};
const siPmRows: SiPmRow[] = siPmSheet.rows
  .filter((r) => r[0] != null && String(r[0]).trim() !== '')
  .map((r) => ({
    project_name: String(r[0] ?? '').trim(),
    brand: clean(r[1] == null ? null : String(r[1])),
    username: r[2] == null ? null : String(r[2]).trim(),
    password: r[3] == null ? null : String(r[3]).trim(),
    link: clean(r[4] == null ? null : String(r[4])),
    created: typeof r[5] === 'number' ? xlSerialToISO(r[5]) : (r[5] == null ? null : String(r[5]).trim()),
  }));
console.log(`shiroienergy.Plant Monitoring parsed: ${siPmRows.length} rows`);

// SE_PASSWORD: 70 rows — datalogger + LAN creds + inverter SNs
// Note: header is split across rows 1 + 2 (merged cells in the original). Use row 2 as header.
const sePwSheet = readSheet(MD_PATH, 'SE_PASSWORD', 2);
type SePwRow = {
  plant_name: string;
  online_status: string | null;
  portal_brand: string | null;
  portal_username: string | null;
  portal_password: string | null;
  local_login_ip: string | null;
  local_admin_user: string | null;
  local_admin_password: string | null;
  local_user: string | null;
  local_user_password: string | null;
  internet_type: string | null;
  jio_password: string | null;
  jio_primary: string | null;
  jio_backup: string | null;
  datalogger_mac: string | null;
  datalogger_pk: string | null;
  inverter_serial: string | null;
  power_module_sn: string | null;
  acdb_sn: string | null;
  dcdb_sn: string | null;
};
const sePwRows: SePwRow[] = sePwSheet.rows
  .filter((r) => r[1] != null && String(r[1]).trim() !== '' && String(r[1]).trim() !== 'Plant Name & Description')
  .map((r) => ({
    plant_name: String(r[1] ?? '').trim(),
    online_status: r[2] == null ? null : String(r[2]).trim(),
    portal_brand: r[3] == null ? null : String(r[3]).trim(),
    portal_username: r[4] == null ? null : String(r[4]).trim(),
    portal_password: r[5] == null ? null : String(r[5]).trim(),
    local_login_ip: r[6] == null ? null : String(r[6]).trim(),
    local_admin_user: r[7] == null ? null : String(r[7]).trim(),
    local_admin_password: r[8] == null ? null : String(r[8]).trim(),
    local_user: r[9] == null ? null : String(r[9]).trim(),
    local_user_password: r[10] == null ? null : String(r[10]).trim(),
    internet_type: r[11] == null ? null : String(r[11]).trim(),
    jio_password: r[12] == null ? null : String(r[12]).trim(),
    jio_primary: r[13] == null ? null : String(r[13]).trim(),
    jio_backup: r[14] == null ? null : String(r[14]).trim(),
    datalogger_mac: r[15] == null ? null : String(r[15]).trim(),
    datalogger_pk: r[16] == null ? null : String(r[16]).trim(),
    inverter_serial: r[17] == null ? null : String(r[17]).trim(),
    power_module_sn: r[18] == null ? null : String(r[18]).trim(),
    acdb_sn: r[19] == null ? null : String(r[19]).trim(),
    dcdb_sn: r[20] == null ? null : String(r[20]).trim(),
  }));
console.log(`SE_PASSWORD parsed: ${sePwRows.length} rows`);

// ─────────────────────────────────────────────────────────────────────────
// Fetch existing projects from dev DB
// ─────────────────────────────────────────────────────────────────────────

type ExistingProject = {
  id: string;
  project_number: string | null;
  customer_name: string | null;
  system_size_kwp: number | null;
  site_city: string | null;
};

async function fetchExistingProjects(): Promise<ExistingProject[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const out: ExistingProject[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('projects')
      .select('id, project_number, customer_name, system_size_kwp, site_city')
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
const existing = await fetchExistingProjects();
console.log(`Existing projects fetched: ${existing.length} rows`);
const existingTokenized = existing.map((p) => ({
  ...p,
  norm: normName(p.customer_name ?? ''),
  tokens: tokenize(normName(p.customer_name ?? '')),
}));

// ─────────────────────────────────────────────────────────────────────────
// Cross-join all five sheets keyed by normalized name
// ─────────────────────────────────────────────────────────────────────────

interface ConsolidatedRecord {
  source_names: { sheet: string; raw: string }[];
  normalized: string;
  primary_name: string;
  // From Sheet2 / LIST OF PROJECT
  system_size_kwp: number | null;
  system_type: string | null;
  net_meter: string | null;
  status: string | null;
  module_make: string | null;
  module_wattage: number | null;
  module_qty: number | null;
  inverter_make: string | null;
  inverter_qty: number | null;
  inverter_capacity: number | null;
  address: string | null;
  google_maps: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  commissioning_date: string | null;
  inverter_sn_master: string | null;
  // From LIST OF PROJECTS-DM
  rooftop_sqft: number | null;
  industry: string | null;
  project_type: string | null;
  lifetime_kwh: number | null;
  // From Project Report
  pr_status: string | null;
  pr_percent_done: number | null;
  pr_assigned_to: string | null;
  pr_location: string | null;
  // From Project details (AMC tracker)
  amc_type: string | null;
  amc1_scheduled: string | null;
  amc1_completed: string | null;
  amc2_scheduled: string | null;
  amc2_completed: string | null;
  amc3_scheduled: string | null;
  amc3_completed: string | null;
  amc4_scheduled: string | null;
  amc4_completed: string | null;
  pd_login: string | null;
  pd_panel: string | null;
  pd_inverter: string | null;
  pd_strings: string | null;
  // From SE_PASSWORD
  online_status: string | null;
  portal_brand: string | null;
  portal_username: string | null;
  portal_password: string | null;
  local_login_ip: string | null;
  local_admin_user: string | null;
  local_admin_password: string | null;
  local_user: string | null;
  local_user_password: string | null;
  internet_type: string | null;
  jio_password: string | null;
  jio_primary: string | null;
  jio_backup: string | null;
  datalogger_mac: string | null;
  datalogger_pk: string | null;
  inverter_serial_sepwd: string | null;
  power_module_sn: string | null;
  acdb_sn: string | null;
  dcdb_sn: string | null;
  // From shiroienergy.Projects (canonical)
  si_status: string | null;
  si_year: number | null;
  si_location: string | null;
  si_folder_link: string | null;
  si_remarks: string | null;
  // From shiroienergy.Budgets
  project_cost: number | null;
  actual_cost: number | null;
  est_profit_pct: number | null;
  act_profit_pct: number | null;
  profit_inr: number | null;
  // From shiroienergy.Project details (richer hardware + addresses)
  si_mobile: string | null;
  si_email: string | null;
  shipping_address: string | null;
  billing_address: string | null;
  si_google_maps: string | null;
  si_category: string | null;
  mounting_type: string | null;
  si_type_of_sys: string | null;
  panel_make_qty: string | null;
  inverter_make_qty: string | null;
  cable_make: string | null;
  la_scope: string | null;
  // From shiroienergy.Plant Monitoring (creds — overlay if missing)
  pm_brand: string | null;
  pm_username: string | null;
  pm_password: string | null;
  pm_link: string | null;
  pm_created: string | null;
  // Match outcome
  matched_project_id: string | null;
  matched_customer_name: string | null;
  match_confidence: 'exact' | 'fuzzy' | 'none';
  match_score: number;
}

const consolidated = new Map<string, ConsolidatedRecord>();

function blank(): Omit<ConsolidatedRecord, 'normalized' | 'primary_name' | 'source_names'> {
  return {
    system_size_kwp: null, system_type: null, net_meter: null, status: null,
    module_make: null, module_wattage: null, module_qty: null,
    inverter_make: null, inverter_qty: null, inverter_capacity: null,
    address: null, google_maps: null, contact_phone: null, contact_name: null, contact_email: null,
    commissioning_date: null, inverter_sn_master: null,
    rooftop_sqft: null, industry: null, project_type: null, lifetime_kwh: null,
    pr_status: null, pr_percent_done: null, pr_assigned_to: null, pr_location: null,
    amc_type: null, amc1_scheduled: null, amc1_completed: null,
    amc2_scheduled: null, amc2_completed: null,
    amc3_scheduled: null, amc3_completed: null,
    amc4_scheduled: null, amc4_completed: null,
    pd_login: null, pd_panel: null, pd_inverter: null, pd_strings: null,
    online_status: null, portal_brand: null, portal_username: null, portal_password: null,
    local_login_ip: null, local_admin_user: null, local_admin_password: null,
    local_user: null, local_user_password: null, internet_type: null,
    jio_password: null, jio_primary: null, jio_backup: null,
    datalogger_mac: null, datalogger_pk: null,
    inverter_serial_sepwd: null, power_module_sn: null, acdb_sn: null, dcdb_sn: null,
    si_status: null, si_year: null, si_location: null, si_folder_link: null, si_remarks: null,
    project_cost: null, actual_cost: null, est_profit_pct: null, act_profit_pct: null, profit_inr: null,
    si_mobile: null, si_email: null, shipping_address: null, billing_address: null,
    si_google_maps: null, si_category: null, mounting_type: null, si_type_of_sys: null,
    panel_make_qty: null, inverter_make_qty: null, cable_make: null, la_scope: null,
    pm_brand: null, pm_username: null, pm_password: null, pm_link: null, pm_created: null,
    matched_project_id: null, matched_customer_name: null,
    match_confidence: 'none', match_score: 0,
  };
}

function getOrCreate(rawName: string, sheetSource: string): ConsolidatedRecord {
  const norm = normName(rawName);
  if (!norm) {
    // Skip empty/garbage names
    return { ...blank(), normalized: '', primary_name: rawName, source_names: [{ sheet: sheetSource, raw: rawName }] };
  }
  let rec = consolidated.get(norm);
  if (!rec) {
    rec = { ...blank(), normalized: norm, primary_name: rawName, source_names: [] };
    consolidated.set(norm, rec);
  }
  rec.source_names.push({ sheet: sheetSource, raw: rawName });
  return rec;
}

// Sheet2 first (primary)
for (const r of sheet2Rows) {
  if (!r.client_name || /^\d+$/.test(r.client_name)) continue;
  const rec = getOrCreate(r.client_name, 'Sheet2');
  rec.system_size_kwp ??= r.system_size_kwp;
  rec.system_type ??= r.system_type;
  rec.net_meter ??= r.net_meter;
  rec.status ??= r.status;
  rec.module_make ??= r.module_make;
  rec.module_wattage ??= r.module_wattage;
  rec.module_qty ??= r.module_qty;
  rec.inverter_make ??= r.inverter_make;
  rec.inverter_qty ??= r.inverter_qty;
  rec.inverter_capacity ??= r.inverter_capacity;
  rec.address ??= r.address;
  rec.google_maps ??= r.google_maps;
  rec.contact_phone ??= r.contact_phone;
  rec.contact_name ??= r.contact_name;
  rec.contact_email ??= r.email;
  rec.commissioning_date ??= r.commissioning_date;
  rec.inverter_sn_master ??= r.inverter_sn;
}

// LIST OF PROJECTS-DM (enrichment)
for (const r of dmRows) {
  if (!r.client_name) continue;
  const rec = getOrCreate(r.client_name, 'LIST OF PROJECTS-DM');
  rec.rooftop_sqft ??= r.rooftop_sqft;
  rec.industry ??= r.industry;
  rec.project_type ??= r.project_type;
  rec.commissioning_date ??= r.commissioned_on;
  rec.lifetime_kwh ??= r.lifetime_kwh;
}

// Project Report (SE Master)
for (const r of prRows) {
  if (!r.project_name) continue;
  const rec = getOrCreate(r.project_name, 'Project Report');
  rec.pr_status ??= r.status;
  rec.pr_percent_done ??= r.percent_done;
  rec.pr_assigned_to ??= r.assigned_to;
  rec.pr_location ??= r.location;
  rec.system_size_kwp ??= r.system_size_kwp;
}

// Project details (SE Master) — AMC tracker
for (const r of pdRows) {
  if (!r.project_name) continue;
  const rec = getOrCreate(r.project_name, 'Project details');
  rec.system_size_kwp ??= r.system_size_kwp;
  rec.amc_type ??= r.amc_type;
  rec.amc1_scheduled ??= r.amc1_scheduled;
  rec.amc1_completed ??= r.amc1_completed;
  rec.amc2_scheduled ??= r.amc2_scheduled;
  rec.amc2_completed ??= r.amc2_completed;
  rec.amc3_scheduled ??= r.amc3_scheduled;
  rec.amc3_completed ??= r.amc3_completed;
  rec.amc4_scheduled ??= r.amc4_scheduled;
  rec.amc4_completed ??= r.amc4_completed;
  rec.contact_phone ??= r.contact;
  rec.contact_email ??= r.email;
  rec.pd_login ??= r.login;
  rec.pd_panel ??= r.panel;
  rec.pd_inverter ??= r.inverter;
  rec.pd_strings ??= r.strings;
  rec.commissioning_date ??= r.commissioning_date;
}

// SE_PASSWORD
for (const r of sePwRows) {
  if (!r.plant_name) continue;
  const rec = getOrCreate(r.plant_name, 'SE_PASSWORD');
  rec.online_status ??= r.online_status;
  rec.portal_brand ??= r.portal_brand;
  rec.portal_username ??= r.portal_username;
  rec.portal_password ??= r.portal_password;
  rec.local_login_ip ??= r.local_login_ip;
  rec.local_admin_user ??= r.local_admin_user;
  rec.local_admin_password ??= r.local_admin_password;
  rec.local_user ??= r.local_user;
  rec.local_user_password ??= r.local_user_password;
  rec.internet_type ??= r.internet_type;
  rec.jio_password ??= r.jio_password;
  rec.jio_primary ??= r.jio_primary;
  rec.jio_backup ??= r.jio_backup;
  rec.datalogger_mac ??= r.datalogger_mac;
  rec.datalogger_pk ??= r.datalogger_pk;
  rec.inverter_serial_sepwd ??= r.inverter_serial;
  rec.power_module_sn ??= r.power_module_sn;
  rec.acdb_sn ??= r.acdb_sn;
  rec.dcdb_sn ??= r.dcdb_sn;
}

// shiroienergy.Projects (CANONICAL — overrides other status sources)
for (const r of siProjRows) {
  if (!r.project_name || /^\d+$/.test(r.project_name)) continue;
  const rec = getOrCreate(r.project_name, 'shiroienergy.Projects');
  rec.system_size_kwp ??= r.size_kwp;
  rec.si_status ??= r.status;
  rec.si_year ??= r.year;
  rec.si_location ??= r.location;
  rec.si_folder_link ??= r.folder_link;
  rec.si_remarks ??= r.remarks;
  rec.pr_location ??= r.location;
}

// shiroienergy.Budgets (financial enrichment)
for (const r of siBudgRows) {
  if (!r.project_name) continue;
  const rec = getOrCreate(r.project_name, 'shiroienergy.Budgets');
  rec.system_size_kwp ??= r.size_kwp;
  rec.si_status ??= r.status;
  rec.si_year ??= r.year;
  rec.project_cost ??= r.project_cost;
  rec.actual_cost ??= r.actual_cost;
  rec.est_profit_pct ??= r.est_profit_pct;
  rec.act_profit_pct ??= r.act_profit_pct;
  rec.profit_inr ??= r.profit_inr;
}

// shiroienergy.Project details (contacts + hardware)
for (const r of siDetRows) {
  if (!r.project_name) continue;
  const rec = getOrCreate(r.project_name, 'shiroienergy.Project details');
  rec.contact_phone ??= r.mobile;
  rec.si_mobile ??= r.mobile;
  rec.contact_email ??= r.email;
  rec.si_email ??= r.email;
  rec.address ??= r.shipping_address ?? r.billing_address;
  rec.shipping_address ??= r.shipping_address;
  rec.billing_address ??= r.billing_address;
  rec.si_google_maps ??= r.google_maps;
  rec.si_category ??= r.category;
  rec.mounting_type ??= r.mounting_type;
  rec.si_type_of_sys ??= r.type_of_sys;
  rec.panel_make_qty ??= r.panel_make_qty;
  rec.inverter_make_qty ??= r.inverter_make_qty;
  rec.cable_make ??= r.cable_make;
  rec.la_scope ??= r.la_scope;
}

// shiroienergy.Plant Monitoring (creds overlay — same dump as the original credentials list)
for (const r of siPmRows) {
  if (!r.project_name) continue;
  const rec = getOrCreate(r.project_name, 'shiroienergy.Plant Monitoring');
  rec.pm_brand ??= r.brand;
  rec.pm_username ??= r.username;
  rec.pm_password ??= r.password;
  rec.pm_link ??= r.link;
  rec.pm_created ??= r.created;
  rec.portal_brand ??= r.brand;
  rec.portal_username ??= r.username;
  rec.portal_password ??= r.password;
}

console.log(`Consolidated records: ${consolidated.size}`);

// ─────────────────────────────────────────────────────────────────────────
// Match each consolidated record to an existing projects row
// ─────────────────────────────────────────────────────────────────────────

for (const rec of consolidated.values()) {
  if (!rec.normalized) continue;
  const recTokens = tokenize(rec.normalized);

  // Exact normalized name match
  let bestId: string | null = null;
  let bestScore = 0;
  let bestName: string | null = null;

  for (const p of existingTokenized) {
    if (!p.norm) continue;
    if (p.norm === rec.normalized) {
      bestId = p.id; bestScore = 1.0; bestName = p.customer_name; break;
    }
    const s = jaccard(recTokens, p.tokens);
    if (s > bestScore) { bestScore = s; bestId = p.id; bestName = p.customer_name; }
  }

  if (bestScore === 1.0) {
    rec.matched_project_id = bestId;
    rec.matched_customer_name = bestName;
    rec.match_confidence = 'exact';
    rec.match_score = 1.0;
  } else if (bestScore >= 0.6) {
    rec.matched_project_id = bestId;
    rec.matched_customer_name = bestName;
    rec.match_confidence = 'fuzzy';
    rec.match_score = bestScore;
  } else {
    rec.match_confidence = 'none';
    rec.match_score = bestScore;
  }
}

const records = [...consolidated.values()].filter((r) => r.normalized);
const exact = records.filter((r) => r.match_confidence === 'exact');
const fuzzy = records.filter((r) => r.match_confidence === 'fuzzy');
const newCreate = records.filter((r) => r.match_confidence === 'none');

// Focused subsets for completed-projects-status report
function isCompleted(r: ConsolidatedRecord): boolean {
  const s = (r.si_status ?? r.pr_status ?? r.status ?? '').toLowerCase();
  return s === 'completed' || s === 'running';
}
const completed = records.filter(isCompleted);
const completedInDb = completed.filter((r) => r.match_confidence !== 'none');
const completedNotInDb = completed.filter((r) => r.match_confidence === 'none');

console.log(`Match summary: exact=${exact.length} fuzzy=${fuzzy.length} new-create=${newCreate.length}`);
console.log(`Completed: ${completed.length} (in DB: ${completedInDb.length}, NOT in DB: ${completedNotInDb.length})`);

// ─────────────────────────────────────────────────────────────────────────
// Render markdown
// ─────────────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const lines: string[] = [];
lines.push('# Plant master-data consolidation — import plan (2026-06-05)');
lines.push('');
lines.push('Source workbooks:');
lines.push('- `Master Data Sheet (1).xlsx` → sheets Sheet2 (170), LIST OF PROJECTS-DM (62), SE_PASSWORD (70)');
lines.push('- `SE MASTER FILE.xlsx` → sheets Project Report (79), Project details (66)');
lines.push('');
lines.push(`**Consolidated unique plants:** ${records.length}`);
lines.push(`**Existing \`projects\` rows in dev:** ${existing.length}`);
lines.push(`**Match outcome:** exact=${exact.length} · fuzzy=${fuzzy.length} · needs-create=${newCreate.length}`);
lines.push(`**Completed (per shiroienergy.Projects):** ${completed.length} total · ${completedInDb.length} already in DB · **${completedNotInDb.length} NOT in DB → these are what you want to land**`);
lines.push('');
lines.push('Match rules: token-overlap (Jaccard) on normalized names. ≥0.6 = fuzzy (review needed), 1.0 = exact, else needs-create.');
lines.push('Source-sheet column shows where the data merged from — useful for tracing back if a field looks wrong.');
lines.push('');
lines.push('---');
lines.push('');

function section(title: string, recs: ConsolidatedRecord[]) {
  lines.push(`## ${title} (${recs.length})`);
  lines.push('');
  if (recs.length === 0) {
    lines.push('_(none)_');
    lines.push('');
    return;
  }
  // Sort by primary_name for stable diffs
  const sorted = [...recs].sort((a, b) => a.primary_name.localeCompare(b.primary_name));
  for (const r of sorted) {
    lines.push(`### ${r.primary_name}`);
    if (r.matched_project_id) {
      lines.push(`- **Matched:** \`${r.matched_project_id}\` → \`${r.matched_customer_name}\` (score ${r.match_score.toFixed(2)})`);
    } else {
      lines.push(`- **Action:** NEEDS-CREATE (best DB candidate: \`${r.matched_customer_name ?? '(none)'}\` score ${r.match_score.toFixed(2)})`);
    }
    lines.push(`- Sources: ${r.source_names.map((s) => `${s.sheet}:"${s.raw}"`).join(' · ')}`);
    const facts: string[] = [];
    if (r.system_size_kwp != null) facts.push(`size=${r.system_size_kwp}kWp`);
    if (r.system_type || r.si_type_of_sys) facts.push(`type=${r.system_type ?? r.si_type_of_sys}`);
    if (r.net_meter) facts.push(`netmeter=${r.net_meter}`);
    const stat = r.si_status ?? r.status ?? r.pr_status;
    if (stat) facts.push(`status=**${stat}**`);
    if (r.si_year) facts.push(`year=${r.si_year}`);
    if (r.pr_percent_done != null) facts.push(`%done=${(r.pr_percent_done * 100).toFixed(0)}%`);
    if (r.commissioning_date) facts.push(`commissioned=${r.commissioning_date}`);
    if (r.rooftop_sqft != null) facts.push(`roof=${r.rooftop_sqft}sqft`);
    if (r.industry) facts.push(`industry=${r.industry}`);
    if (r.project_type || r.si_category) facts.push(`cat=${r.project_type ?? r.si_category}`);
    if (r.lifetime_kwh != null) facts.push(`lifetime=${r.lifetime_kwh}kWh`);
    if (r.project_cost != null) facts.push(`cost=₹${r.project_cost.toLocaleString('en-IN')}`);
    if (r.actual_cost != null) facts.push(`actual=₹${r.actual_cost.toLocaleString('en-IN')}`);
    if (r.profit_inr != null) facts.push(`profit=₹${r.profit_inr.toLocaleString('en-IN')}`);
    if (facts.length) lines.push(`- ${facts.join(' · ')}`);
    if (r.si_location || r.pr_location) lines.push(`- Location: ${fmt(r.si_location ?? r.pr_location)}`);

    const hw: string[] = [];
    if (r.module_make) hw.push(`panel=${r.module_make}${r.module_wattage ? `@${r.module_wattage}Wp` : ''}${r.module_qty ? `×${r.module_qty}` : ''}`);
    if (r.inverter_make) hw.push(`inv=${r.inverter_make}${r.inverter_capacity ? `@${r.inverter_capacity}kW` : ''}${r.inverter_qty ? `×${r.inverter_qty}` : ''}`);
    if (r.inverter_sn_master || r.inverter_serial_sepwd) hw.push(`sn=${r.inverter_sn_master ?? r.inverter_serial_sepwd}`);
    if (hw.length) lines.push(`- HW: ${hw.join(' · ')}`);
    if (r.panel_make_qty) lines.push(`- Panel detail: ${fmt(r.panel_make_qty)}`);
    if (r.inverter_make_qty) lines.push(`- Inverter detail: ${fmt(r.inverter_make_qty)}`);
    if (r.mounting_type) lines.push(`- Mounting: ${fmt(r.mounting_type)}`);
    if (r.cable_make || r.la_scope) lines.push(`- Scope: cable=${fmt(r.cable_make)} · LA=${fmt(r.la_scope)}`);

    if (r.address || r.shipping_address) lines.push(`- Address: ${fmt(r.address ?? r.shipping_address)}`);
    if (r.billing_address && r.billing_address !== r.shipping_address) lines.push(`- Billing: ${fmt(r.billing_address)}`);
    if (r.contact_name || r.contact_phone || r.contact_email) {
      lines.push(`- Contact: ${fmt(r.contact_name)} · ${fmt(r.contact_phone)} · ${fmt(r.contact_email)}`);
    }
    if (r.google_maps || r.si_google_maps) lines.push(`- Maps: ${fmt(r.google_maps ?? r.si_google_maps)}`);
    if (r.si_folder_link) lines.push(`- Folder: ${fmt(r.si_folder_link)}`);
    if (r.si_remarks) lines.push(`- Remarks: ${fmt(r.si_remarks)}`);

    // Credentials
    if (r.portal_brand || r.portal_username) {
      lines.push(`- Portal: ${fmt(r.portal_brand)} · user=${fmt(r.portal_username)} · pw=${fmt(r.portal_password)}`);
    }
    if (r.local_admin_user || r.local_user) {
      lines.push(`- Local: admin=${fmt(r.local_admin_user)}/${fmt(r.local_admin_password)} · user=${fmt(r.local_user)}/${fmt(r.local_user_password)} · IP=${fmt(r.local_login_ip)}`);
    }
    if (r.datalogger_mac || r.datalogger_pk) {
      lines.push(`- Datalogger: MAC=${fmt(r.datalogger_mac)} · PK=${fmt(r.datalogger_pk)} · power_module_SN=${fmt(r.power_module_sn)} · ACDB=${fmt(r.acdb_sn)} · DCDB=${fmt(r.dcdb_sn)}`);
    }
    if (r.internet_type || r.jio_primary) {
      lines.push(`- Internet: ${fmt(r.internet_type)} · jio=${fmt(r.jio_primary)}/${fmt(r.jio_backup)} · pw=${fmt(r.jio_password)}`);
    }

    // AMC
    if (r.amc_type || r.amc1_scheduled) {
      const amcs: string[] = [];
      if (r.amc1_scheduled) amcs.push(`AMC1 sched=${r.amc1_scheduled}${r.amc1_completed ? ` done=${r.amc1_completed}` : ''}`);
      if (r.amc2_scheduled) amcs.push(`AMC2 sched=${r.amc2_scheduled}${r.amc2_completed ? ` done=${r.amc2_completed}` : ''}`);
      if (r.amc3_scheduled) amcs.push(`AMC3 sched=${r.amc3_scheduled}${r.amc3_completed ? ` done=${r.amc3_completed}` : ''}`);
      if (r.amc4_scheduled) amcs.push(`AMC4 sched=${r.amc4_scheduled}${r.amc4_completed ? ` done=${r.amc4_completed}` : ''}`);
      lines.push(`- AMC: ${r.amc_type ?? '(type tbd)'} — ${amcs.join(' | ')}`);
    }
    if (r.pd_login) lines.push(`- Login note: \`${r.pd_login.replace(/\n/g, ' ⏎ ')}\``);

    lines.push('');
  }
}

section('0a. COMPLETED & NOT IN DB — these are what to create now (your ask)', completedNotInDb);
section('0b. COMPLETED & ALREADY IN DB — confirm status correct, no create needed', completedInDb);
section('1. MATCHED-EXACT (all statuses) — overlay onto existing project', exact);
section('2. MATCHED-FUZZY (all statuses) — review needed before overlay', fuzzy);
section('3. NEEDS-CREATE (all statuses, includes the 0a subset)', newCreate);

writeFileSync(
  resolve('scripts/data/master-projects-import-plan-2026-06-05.md'),
  lines.join('\n'),
  'utf8',
);

console.log('\nWrote scripts/data/master-projects-import-plan-2026-06-05.md');
console.log(`Lines: ${lines.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
