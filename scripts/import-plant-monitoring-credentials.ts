// scripts/import-plant-monitoring-credentials.ts
//
// Bulk-import customer monitoring portal credentials from a tab/CSV dump
// into plant_monitoring_credentials. Idempotent — uses (project_id, portal_url)
// unique key. Logs unmatched rows for manual triage.
//
// Usage:
//   pnpm tsx scripts/import-plant-monitoring-credentials.ts --input creds.tsv --dry-run
//   pnpm tsx scripts/import-plant-monitoring-credentials.ts --input creds.tsv --apply

import { readFileSync } from 'node:fs';
import type { createAdminClient as CreateAdminClient } from '@repo/supabase/admin';

export interface RawRow {
  project: string;
  brand: string;
  username: string;
  password: string;
  monitoringLink: string;
  created: string;
}

export interface ProjectStub {
  id: string;
  customer_name: string;
  project_number: string;
}

const KNOWN_BRANDS = [
  'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
  'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
] as const;
type KnownBrand = typeof KNOWN_BRANDS[number];

const BRAND_ALIASES: Record<string, KnownBrand> = {
  deye: 'solarman',
  isolar: 'sungrow',
  fronious: 'fronius',
  'flin energy': 'flin_energy',
};

export function normalizeBrand(rawBrand: string, monitoringUrl?: string): KnownBrand {
  const lower = (rawBrand ?? '').trim().toLowerCase();
  if (lower in BRAND_ALIASES) return BRAND_ALIASES[lower];
  if ((KNOWN_BRANDS as readonly string[]).includes(lower)) return lower as KnownBrand;
  const url = (monitoringUrl ?? '').toLowerCase();
  if (!url) return 'other';
  if (url.includes('isolarcloud')) return 'sungrow';
  if (url.includes('growatt')) return 'growatt';
  if (url.includes('solarmanpv')) return 'solarman';
  if (url.includes('semsportal') || url.includes('goodwe')) return 'goodwe';
  if (url.includes('auroravision') || url.includes('fimer')) return 'fimer';
  if (url.includes('polycabmonitoring')) return 'polycab';
  if (url.includes('power-datacenter')) return 'flin_energy';
  return 'other';
}

export function normalizeDate(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const month = us[1].padStart(2, '0');
    const day = us[2].padStart(2, '0');
    return `${us[3]}-${month}-${day}`;
  }
  return null;
}

function tokenize(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/mr\.?|mrs\.?|m\/s|dr\.?|ms\.?/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

export function matchProject(rawCustomerName: string, projects: ProjectStub[]): ProjectStub | null {
  const lowerRaw = rawCustomerName.trim().toLowerCase();
  const exact = projects.find((p) => p.customer_name.trim().toLowerCase() === lowerRaw);
  if (exact) return exact;
  const rawTokens = tokenize(rawCustomerName);
  if (rawTokens.size === 0) return null;
  let bestScore = 0;
  let bestMatch: ProjectStub | null = null;
  for (const project of projects) {
    const projectTokens = tokenize(project.customer_name);
    if (projectTokens.size === 0) continue;
    let overlap = 0;
    for (const t of rawTokens) if (projectTokens.has(t)) overlap++;
    const score = overlap / Math.min(rawTokens.size, projectTokens.size);
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = project;
    }
  }
  return bestMatch;
}

interface CliFlags {
  inputPath: string;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { inputPath: '', dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') flags.inputPath = argv[++i] ?? '';
    if (argv[i] === '--apply') flags.dryRun = false;
    if (argv[i] === '--dry-run') flags.dryRun = true;
  }
  if (!flags.inputPath) throw new Error('Missing --input <path>');
  return flags;
}

function parseTsv(content: string): RawRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    rows.push({
      project: cols[0]?.trim() ?? '',
      brand: cols[1]?.trim() ?? '',
      username: cols[2]?.trim() ?? '',
      password: cols[3]?.trim() ?? '',
      monitoringLink: cols[4]?.trim() ?? '',
      created: cols[5]?.trim() ?? '',
    });
  }
  return rows;
}

async function main() {
  const op = '[import-plant-monitoring-credentials]';
  const flags = parseFlags(process.argv.slice(2));
  console.log(`${op} reading ${flags.inputPath} (dry-run=${flags.dryRun})`);
  const raw = readFileSync(flags.inputPath, 'utf8');
  const rows = parseTsv(raw);
  console.log(`${op} parsed ${rows.length} rows`);
  // Dynamic import: keeps the test runner (which executes in scripts/ cwd
  // where workspace packages aren't symlinked) from failing to resolve the
  // package at module-eval time. The real script runs via `pnpm tsx` from
  // the repo root where @repo/supabase is resolvable.
  const { createAdminClient } = (await import('@repo/supabase/admin')) as {
    createAdminClient: typeof CreateAdminClient;
  };
  const supabase = createAdminClient();
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, customer_name, project_number');
  if (pErr) {
    console.error(`${op} failed to load projects:`, pErr);
    process.exit(1);
  }
  if (!projects) {
    console.error(`${op} projects load returned null data`);
    process.exit(1);
  }
  console.log(`${op} loaded ${projects.length} projects`);
  let matched = 0;
  let unmatched = 0;
  let inserted = 0;
  const unmatchedRows: string[] = [];
  for (const row of rows) {
    if (!row.project || !row.username || !row.password) continue;
    const match = matchProject(row.project, projects);
    if (!match) {
      unmatched++;
      unmatchedRows.push(`UNMATCHED: project="${row.project}" brand="${row.brand}" user="${row.username}"`);
      continue;
    }
    matched++;
    const brand = normalizeBrand(row.brand, row.monitoringLink);
    const createdAt = normalizeDate(row.created);
    const portalUrl = row.monitoringLink || '(no-portal)';
    if (flags.dryRun) {
      console.log(`MATCH: ${row.project} → ${match.project_number} (${match.customer_name}) brand=${brand}`);
      continue;
    }
    const { error: upErr } = await supabase
      .from('plant_monitoring_credentials')
      .upsert(
        {
          project_id: match.id,
          inverter_brand: brand,
          portal_url: portalUrl,
          username: row.username,
          password: row.password,
          created_at: createdAt ?? new Date().toISOString(),
        },
        { onConflict: 'project_id,portal_url', ignoreDuplicates: false },
      );
    if (upErr) {
      console.error(`${op} upsert failed for ${row.project}:`, upErr);
      continue;
    }
    inserted++;
  }
  console.log(`${op} done. matched=${matched} unmatched=${unmatched} inserted=${inserted} (dry-run=${flags.dryRun})`);
  if (unmatchedRows.length > 0) {
    console.log(`\n${op} UNMATCHED ROWS (need manual project mapping):\n`);
    for (const u of unmatchedRows) console.log(u);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
