// scripts/sungrow-seed-inverters.ts
//
// Discovers all Sungrow plants + inverters under Manivel's iSolarCloud
// account, fuzzy-matches each plant to an existing Shiroi project by
// customer name, and inserts inverter rows into the inverters table.
//
// Usage:
//   pnpm tsx scripts/sungrow-seed-inverters.ts --dry-run     # show plan
//   pnpm tsx scripts/sungrow-seed-inverters.ts --apply       # write rows
//
// What it does:
//   1. Login via /openapi/login → token.
//   2. List all plants on the account.
//   3. For each plant, list devices (device_type=1 = inverter, type=22 = WiFi).
//   4. Fuzzy-match plant.ps_name to projects.customer_name + site_city.
//   5. For matched plants, insert into `inverters` with:
//      - project_id          = matched project's id
//      - brand               = 'sungrow'
//      - serial_number       = device.device_sn
//      - model               = device.device_model_code
//      - rated_capacity_kw   = plant.ps_capacity_kwp || extracted from name || project.system_size_kwp
//      - monitoring_credentials_id = Sungrow master row (resolved via brand=sungrow)
//      - monitoring_site_id  = ps_id (string)
//      - monitoring_device_id = device.ps_key  (composite; adapter uses this)
//      - polling_enabled     = true
//      - polling_interval_minutes = 15
//
// Idempotent: uses (brand, serial_number) UNIQUE → upsert path. Re-running
// the script after fixing un-matched plants only inserts the new ones.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sungrowRsaEncrypt } from '../packages/inverter-adapters/src/sungrow-rsa';
import { createClient } from '@supabase/supabase-js';

// ─── Env loader ──────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

// ─── Sungrow client ──────────────────────────────────────────────────────

interface SungrowEnvelope<T> {
  result_code: string | number;
  result_msg?: string;
  result_data?: T;
}

async function sungrowPost<T>(
  base: string,
  path: string,
  accessKey: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<SungrowEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'x-access-key': accessKey,
    sys_code: '901',
  };
  if (token) headers.token = token;
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return (await res.json()) as SungrowEnvelope<T>;
}

interface SungrowEnv {
  appkey: string;
  secret: string;
  username: string;
  password: string;
  rsaPublicKey: string;
  apiBase: string;
}

async function sungrowLogin(env: SungrowEnv): Promise<string> {
  const encPass = await sungrowRsaEncrypt(env.password, env.rsaPublicKey);
  const body = await sungrowPost<{ token?: string }>(env.apiBase, '/openapi/login', env.secret, {
    appkey: env.appkey,
    user_account: env.username,
    user_password: encPass,
    login_type: '1',
    sys_code: '901',
  });
  if (String(body.result_code) !== '1') throw new Error(`Login failed: ${body.result_msg}`);
  const token = body.result_data?.token;
  if (!token) throw new Error('No token in login response');
  return token;
}

interface SungrowPlant {
  ps_id: number;
  ps_name: string;
  ps_location?: string;
  total_capacity?: string | number;
  install_date?: string;
  [k: string]: unknown;
}

async function listPlants(env: SungrowEnv, token: string): Promise<SungrowPlant[]> {
  const all: SungrowPlant[] = [];
  let curPage = 1;
  while (true) {
    const body = await sungrowPost<{ pageList?: SungrowPlant[]; rowCount?: number }>(
      env.apiBase, '/openapi/getPowerStationList', env.secret,
      { appkey: env.appkey, token, curPage, size: 100 },
      token,
    );
    if (String(body.result_code) !== '1') throw new Error(`getPowerStationList: ${body.result_msg}`);
    const page = body.result_data?.pageList ?? [];
    all.push(...page);
    if (page.length < 100) break;
    curPage += 1;
    if (curPage > 20) break;
  }
  return all;
}

interface SungrowDevice {
  ps_id: number;
  ps_key: string;
  device_sn: string;
  device_type: number;
  device_code?: number;
  device_model_code?: string;
  device_name?: string;
  uuid?: number;
  communication_dev_sn?: string;
  [k: string]: unknown;
}

async function listDevices(env: SungrowEnv, token: string, psId: number): Promise<SungrowDevice[]> {
  const body = await sungrowPost<{ pageList?: SungrowDevice[] }>(
    env.apiBase, '/openapi/getDeviceList', env.secret,
    { appkey: env.appkey, token, ps_id: psId, curPage: 1, size: 200 },
    token,
  );
  if (String(body.result_code) !== '1') throw new Error(`getDeviceList: ${body.result_msg}`);
  return body.result_data?.pageList ?? [];
}

// ─── Project matching ────────────────────────────────────────────────────

interface ProjectStub {
  id: string;
  project_number: string;
  customer_name: string;
  site_city: string | null;
  system_size_kwp: number | null;
}

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/mr\.?|mrs\.?|m\/s|dr\.?|ms\.?/g, '')
    .replace(/private limited|pvt\.?\s*ltd\.?|p\.?\s*ltd\.?|ltd\.?/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .join(' ')
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function substrAffinity(a: Set<string>, b: Set<string>): number {
  // Reward when any token in a is a substring of (or contains) any token in b.
  // Helps "anil kumar" ↔ "anilkumar" and "lakshmana" ↔ "lakshmanan".
  let hits = 0;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) continue; // already counted by jaccard
      if (ta.length >= 4 && tb.length >= 4 && (ta.includes(tb) || tb.includes(ta))) {
        hits += 1;
        break;
      }
    }
  }
  return hits / Math.max(a.size, b.size);
}

function matchPlantToProject(plant: SungrowPlant, projects: ProjectStub[]): ProjectStub | null {
  const plantTokens = tokenSet(plant.ps_name);
  let best: ProjectStub | null = null;
  let bestScore = 0;
  for (const p of projects) {
    const projTokens = tokenSet(p.customer_name);
    const score = jaccard(plantTokens, projTokens) + 0.5 * substrAffinity(plantTokens, projTokens);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  // Threshold 0.35 catches name variations like "Anil Kumar" vs "Anilkumar"
  // and "Anandan solar" vs "Mr. Anandan - Nolambur".
  return bestScore >= 0.35 ? best : null;
}

// Extract "X.X KWp" or "X KW" from a plant name.
function extractCapacityKw(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(?:k\s*wp?|kw|kwp)/i);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 10000) return n;
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply;

async function main() {
  const env = loadEnv();
  const sungrowEnv: SungrowEnv = {
    appkey: env.SUNGROW_APPKEY,
    secret: env.SUNGROW_SECRET,
    username: env.SUNGROW_USERNAME,
    password: env.SUNGROW_PASSWORD,
    rsaPublicKey: env.SUNGROW_RSA_PUBLIC_KEY,
    apiBase: env.SUNGROW_BASE_URL ?? 'https://gateway.isolarcloud.com.hk',
  };

  if (!sungrowEnv.appkey || !sungrowEnv.secret || !sungrowEnv.username || !sungrowEnv.password) {
    throw new Error('Missing SUNGROW_* env vars in .env.local');
  }

  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log('');

  // ── Sungrow side: discover plants + inverters ──────────────────────────
  console.log('[1] Logging in to Sungrow...');
  const token = await sungrowLogin(sungrowEnv);
  console.log(`    ✓ token=${token.slice(0, 12)}…`);

  console.log('[2] Listing plants...');
  const plants = await listPlants(sungrowEnv, token);
  console.log(`    ✓ ${plants.length} plants`);

  console.log('[3] Listing devices per plant...');
  type PlantWithDevices = { plant: SungrowPlant; inverters: SungrowDevice[] };
  const enriched: PlantWithDevices[] = [];
  for (const plant of plants) {
    const devices = await listDevices(sungrowEnv, token, plant.ps_id);
    const inverters = devices.filter((d) => Number(d.device_type) === 1);
    enriched.push({ plant, inverters });
    console.log(`    • ${plant.ps_name} → ${inverters.length} inverter(s)`);
  }

  // ── ERP side: load projects + master credential id ─────────────────────
  console.log('[4] Loading projects and Sungrow credential row from Supabase...');
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: credRow, error: credErr } = await supabase
    .from('inverter_monitoring_credentials')
    .select('id')
    .eq('brand', 'sungrow')
    .maybeSingle();
  if (credErr || !credRow) throw new Error(`Sungrow credential row missing: ${credErr?.message}`);
  const credentialsId = credRow.id;
  console.log(`    ✓ credentials_id=${credentialsId}`);

  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, site_city, system_size_kwp')
    .is('deleted_at', null);
  if (projErr || !projects) throw new Error(`projects query failed: ${projErr?.message}`);
  console.log(`    ✓ ${projects.length} projects`);
  console.log('');

  // ── Match + plan ────────────────────────────────────────────────────────
  type Plan = {
    plant_name: string;
    ps_id: number;
    matched_project: ProjectStub | null;
    inverters: Array<{
      device_sn: string;
      ps_key: string;
      model: string | null;
      rated_capacity_kw: number;
    }>;
  };

  const plan: Plan[] = enriched.map(({ plant, inverters }) => {
    const match = matchPlantToProject(plant, projects as ProjectStub[]);
    const fromName = extractCapacityKw(plant.ps_name);
    const fromProject = match?.system_size_kwp != null ? Number(match.system_size_kwp) : null;
    const ratedFromPlant = fromName ?? fromProject ?? 5;
    // Split capacity across N inverters evenly when there are multiple.
    const perInverter = inverters.length > 0 ? ratedFromPlant / inverters.length : ratedFromPlant;
    return {
      plant_name: plant.ps_name,
      ps_id: plant.ps_id,
      matched_project: match,
      inverters: inverters.map((d) => ({
        device_sn: d.device_sn,
        ps_key: d.ps_key,
        model: d.device_model_code ?? null,
        rated_capacity_kw: Math.round(perInverter * 100) / 100,
      })),
    };
  });

  console.log('═══ PLAN ═══');
  for (const p of plan) {
    const matchStr = p.matched_project
      ? `→ ${p.matched_project.project_number} (${p.matched_project.customer_name})`
      : '→ PLACEHOLDER (manual mapping later)';
    console.log(`\n  ${p.plant_name}  (ps_id=${p.ps_id})  ${matchStr}`);
    for (const inv of p.inverters) {
      console.log(`    • SN=${inv.device_sn}  model=${inv.model}  cap=${inv.rated_capacity_kw}kW  ps_key=${inv.ps_key}`);
    }
  }
  console.log('');

  const matchedCount = plan.filter((p) => p.matched_project).length;
  const totalInverters = plan.flatMap((p) => p.inverters).length;
  const onPlaceholder = plan.flatMap((p) => p.matched_project ? [] : p.inverters).length;
  console.log(`Summary: ${matchedCount}/${plan.length} plants matched; ${totalInverters} inverters to insert (${onPlaceholder} on placeholder).`);

  if (dryRun) {
    console.log('\n(dry-run — re-run with --apply to write to DB)');
    return;
  }

  // ── Apply: upsert inverter rows ─────────────────────────────────────────
  // Unmatched plants get project_id = NULL (monitoring-only). O&M maps to a
  // real project later via the Inverters admin UI. The Edge Function only
  // reads project_id for the Growatt branch, so Sungrow polling works fine
  // without it.
  console.log('\n[5] Inserting inverter rows...');
  let inserted = 0;
  let unmappedRows = 0;
  for (const p of plan) {
    const targetProjectId = p.matched_project?.id ?? null;
    const targetLabel = p.matched_project?.project_number ?? '(unmapped — Sungrow-only)';
    for (const inv of p.inverters) {
      const row = {
        project_id: targetProjectId,
        brand: 'sungrow' as const,
        serial_number: inv.device_sn,
        model: inv.model,
        rated_capacity_kw: inv.rated_capacity_kw,
        monitoring_credentials_id: credentialsId,
        monitoring_site_id: String(p.ps_id),
        monitoring_device_id: inv.ps_key,
        polling_enabled: true,
        polling_interval_minutes: 15,
      };
      const { error } = await supabase
        .from('inverters')
        .upsert(row, { onConflict: 'brand,serial_number' });
      if (error) {
        console.error(`    ✗ ${inv.device_sn}: ${error.message}`);
      } else {
        console.log(`    ✓ ${inv.device_sn} → ${targetLabel}`);
        inserted += 1;
        if (!p.matched_project) unmappedRows += 1;
      }
    }
  }
  console.log(`\nDone: inserted ${inserted} (${unmappedRows} unmapped — re-assign in UI later).`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
