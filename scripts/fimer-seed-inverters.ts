// scripts/fimer-seed-inverters.ts
//
// One-pass FIMER (Aurora Vision) seeding for the inverter telemetry pipeline.
//
//   1. Reads accounts + plants from scripts/data/fimer-plants-2026-06-05.json
//   2. Reads paired (api_key, username, password) from
//      scripts/data/fimer-credentials-2026-06-05.tsv (gitignored)
//   3. Upserts one inverter_monitoring_credentials row per account
//      (brand='fimer', vault_secret_ref='FIMER_CRED_<SLUG>',
//       config={ account_slug, account_username, api_base }).
//   4. Logs in to each account's Aurora Vision API → token (60-min lifetime).
//   5. For plants with no entity_id: GET /v1/device/?serialNumber=<sn> → fills it.
//   6. Fuzzy-matches plant_name to projects.customer_name (token-Jaccard).
//   7. Upserts inverters rows (brand='fimer', monitoring_site_id=entity_id,
//      monitoring_credentials_id=this account's row).
//
// Usage:
//   pnpm tsx scripts/fimer-seed-inverters.ts --dry-run     # show plan
//   pnpm tsx scripts/fimer-seed-inverters.ts --apply       # write rows
//
// Idempotent: brand+serial_number unique on inverters, brand+label unique on
// inverter_monitoring_credentials, so re-running only inserts new entries.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fimerAuthenticate, fimerLookupDeviceBySerial } from '../packages/inverter-adapters/src/fimer';

// ─── Env loader ───────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// ─── Data loaders ─────────────────────────────────────────────────────────

interface PlantRecord {
  name: string;
  entity_id: string | null;
  serial: string | null;
  location: string | null;
  capacity_kw: number;
  _note?: string;
}

interface AccountRecord {
  slug: string;
  label: string;
  username: string;
  api_key: string;
  env_var: string;
  plants: PlantRecord[];
  plants_no_eid_yet?: PlantRecord[];
}

interface PlantsFile {
  _meta: Record<string, unknown>;
  accounts: AccountRecord[];
}

function loadPlants(): PlantsFile {
  const path = resolve(process.cwd(), 'scripts/data/fimer-plants-2026-06-05.json');
  return JSON.parse(readFileSync(path, 'utf8')) as PlantsFile;
}

interface CredTsvRow {
  slug: string;
  api_key: string;
  username: string;
  password: string;
}

function loadCredentials(): CredTsvRow[] {
  const path = resolve(process.cwd(), 'scripts/data/fimer-credentials-2026-06-05.tsv');
  const text = readFileSync(path, 'utf8');
  const out: CredTsvRow[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split('\t');
    if (parts.length !== 4) continue;
    out.push({ slug: parts[0]!, api_key: parts[1]!, username: parts[2]!, password: parts[3]! });
  }
  return out;
}

// ─── Project fuzzy matching (same algorithm as sungrow-seed-inverters.ts) ──

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
  let hits = 0;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) continue;
      if (ta.length >= 4 && tb.length >= 4 && (ta.includes(tb) || tb.includes(ta))) {
        hits += 1;
        break;
      }
    }
  }
  return hits / Math.max(a.size, b.size);
}

function matchPlantToProject(plantName: string, projects: ProjectStub[]): ProjectStub | null {
  const plantTokens = tokenSet(plantName);
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
  return bestScore >= 0.35 ? best : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply;
const skipDiscovery = args.includes('--skip-discovery');   // useful when API rate-limited

async function main() {
  const env = loadEnv();
  const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL']!, env['SUPABASE_SECRET_KEY']!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log('');

  const plantsFile = loadPlants();
  const credTsv = loadCredentials();
  const credBySlug = new Map(credTsv.map((c) => [c.slug, c]));

  // ── Step 1: Upsert credential rows ──────────────────────────────────────
  console.log('[1] Upserting inverter_monitoring_credentials rows...');
  const credIdBySlug = new Map<string, string>();
  for (const acc of plantsFile.accounts) {
    const tsv = credBySlug.get(acc.slug);
    if (!tsv) {
      console.warn(`    ⚠ ${acc.slug}: no row in fimer-credentials-*.tsv; skipping account`);
      continue;
    }
    const row = {
      brand: 'fimer' as const,
      label: `Aurora Vision: ${acc.label}`,
      vault_secret_ref: acc.env_var,    // FIMER_CRED_<SLUG>
      config: {
        account_slug: acc.slug,
        account_username: acc.username,
        api_base: 'https://api.auroravision.net/api/rest',
        notes: `Aurora Vision REST v1. ${acc.plants.length} plant(s) discovered 2026-06-05. Edge Function reads FIMER_CRED_<SLUG> as JSON {api_key, username, password}.`,
      },
    };
    if (dryRun) {
      console.log(`    [DRY] ${acc.slug} (${acc.label})`);
      credIdBySlug.set(acc.slug, `dry-${acc.slug}`);
    } else {
      const { data, error } = await supabase
        .from('inverter_monitoring_credentials')
        .upsert(row, { onConflict: 'brand,label' })
        .select('id')
        .single();
      if (error || !data) {
        console.error(`    ✗ ${acc.slug}: ${error?.message}`);
        continue;
      }
      console.log(`    ✓ ${acc.slug} → id=${data.id}`);
      credIdBySlug.set(acc.slug, data.id);
    }
  }
  console.log('');

  // ── Step 2: Authenticate + discover missing entity IDs ──────────────────
  console.log('[2] Authenticating + discovering missing entity IDs...');
  const tokenBySlug = new Map<string, string>();
  for (const acc of plantsFile.accounts) {
    if (!credBySlug.has(acc.slug)) continue;
    if (skipDiscovery) continue;
    const tsv = credBySlug.get(acc.slug)!;
    try {
      const token = await fimerAuthenticate({
        apiKey: tsv.api_key,
        username: tsv.username,
        password: tsv.password,
      });
      tokenBySlug.set(acc.slug, token);
      console.log(`    ✓ ${acc.slug} → token=${token.slice(0, 8)}…`);
    } catch (e) {
      console.error(`    ✗ ${acc.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!skipDiscovery) {
    for (const acc of plantsFile.accounts) {
      const token = tokenBySlug.get(acc.slug);
      const tsv = credBySlug.get(acc.slug);
      if (!token || !tsv) continue;
      for (const plant of acc.plants) {
        if (plant.entity_id || !plant.serial) continue;
        try {
          const dev = await fimerLookupDeviceBySerial(
            'https://api.auroravision.net/api/rest',
            tsv.api_key,
            token,
            plant.serial,
          );
          if (dev?.entityID) {
            plant.entity_id = String(dev.entityID);
            console.log(`    discovered eid=${plant.entity_id} for ${acc.slug}:${plant.name} via SN ${plant.serial}`);
          } else {
            console.log(`    ⚠ no device for SN ${plant.serial} (${acc.slug}:${plant.name})`);
          }
        } catch (e) {
          console.log(`    ⚠ SN ${plant.serial}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }
  console.log('');

  // ── Step 3: Load projects for fuzzy matching ────────────────────────────
  console.log('[3] Loading projects...');
  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, site_city, system_size_kwp')
    .is('deleted_at', null);
  if (projErr || !projects) throw new Error(`projects query failed: ${projErr?.message}`);
  console.log(`    ✓ ${projects.length} projects`);
  console.log('');

  // ── Step 4: Plan + upsert inverters ─────────────────────────────────────
  console.log('═══ PLAN ═══\n');
  interface PlanRow {
    account_slug: string;
    plant_name: string;
    entity_id: string | null;
    serial: string | null;
    capacity_kw: number;
    matched: ProjectStub | null;
    credentials_id: string;
  }
  const plan: PlanRow[] = [];
  for (const acc of plantsFile.accounts) {
    const credId = credIdBySlug.get(acc.slug);
    if (!credId) continue;
    console.log(`  [${acc.slug}] ${acc.label}`);
    for (const plant of acc.plants) {
      const match = matchPlantToProject(plant.name, projects as ProjectStub[]);
      const matchStr = match
        ? `→ ${match.project_number} (${match.customer_name})`
        : '→ (unmapped)';
      const eidStr = plant.entity_id ? `eid=${plant.entity_id}` : 'eid=MISSING';
      const snStr = plant.serial ? `sn=${plant.serial}` : 'sn=—';
      console.log(`    • ${plant.name}  ${eidStr}  ${snStr}  cap=${plant.capacity_kw}kW  ${matchStr}`);
      plan.push({
        account_slug: acc.slug,
        plant_name: plant.name,
        entity_id: plant.entity_id,
        serial: plant.serial,
        capacity_kw: plant.capacity_kw,
        matched: match,
        credentials_id: credId,
      });
    }
  }
  console.log('');

  const have_eid = plan.filter((p) => p.entity_id).length;
  const have_match = plan.filter((p) => p.matched).length;
  console.log(`Summary: ${plan.length} plants total; ${have_eid} with entity_id; ${have_match} matched to a project.`);

  if (dryRun) {
    console.log('\n(dry-run — re-run with --apply to write to DB)');
    return;
  }

  // ── Step 5: Apply ───────────────────────────────────────────────────────
  console.log('\n[5] Inserting inverter rows...');
  let inserted = 0;
  let skippedNoEid = 0;
  let skippedNoSn = 0;
  for (const p of plan) {
    if (!p.serial) {
      console.log(`    ⚠ skip ${p.plant_name}: no serial number`);
      skippedNoSn += 1;
      continue;
    }
    if (!p.entity_id) {
      console.log(`    ⚠ skip ${p.plant_name}: no entity_id (run with API discovery enabled)`);
      skippedNoEid += 1;
      continue;
    }
    const row = {
      project_id: p.matched?.id ?? null,
      brand: 'fimer' as const,
      serial_number: p.serial,
      model: null,
      rated_capacity_kw: p.capacity_kw,
      monitoring_credentials_id: p.credentials_id,
      monitoring_site_id: p.entity_id,
      monitoring_device_id: null,
      polling_enabled: true,
      polling_interval_minutes: 15,
    };
    const { error } = await supabase
      .from('inverters')
      .upsert(row, { onConflict: 'brand,serial_number' });
    if (error) {
      console.error(`    ✗ ${p.serial} (${p.plant_name}): ${error.message}`);
    } else {
      console.log(`    ✓ ${p.serial} → ${p.matched?.project_number ?? '(unmapped)'}`);
      inserted += 1;
    }
  }
  console.log(`\nDone: inserted ${inserted} inverters (skipped ${skippedNoSn} no-SN, ${skippedNoEid} no-EID).`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
