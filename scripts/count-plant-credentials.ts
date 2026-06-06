/**
 * count-plant-credentials.ts
 *
 * Parses Vivek's pasted credential dump (2026-06-05), classifies each row's
 * brand by portal URL (with brand-column fallback), dedupes, and writes:
 *
 *   scripts/data/credentials-brand-counts-2026-06-05.md
 *
 * Counts both PLANTS (one per project_label after dedupe) and INVERTERS
 * (one per row before multi-inverter collapse). This is what Vivek needs
 * to prioritize Sungrow/Growatt-style API integration for the other brands.
 *
 * Brand classification rules (single source of truth):
 *   solarmanpv.com / solarman → deye   (the key reclassification)
 *   isolarcloud               → sungrow
 *   server.growatt.com        → growatt
 *   auroravision              → fimer
 *   polycabmonitoring         → polycab
 *   power-datacenter          → flin_energy
 *   solarweb / fronius        → fronius
 *   havells                   → havells
 *   (no URL)                  → fallback to normalized brand column
 *
 * Dedup rule: (normalized_label, brand, normalized_username) — latest by
 * created date wins; if no date, last-paste-order wins.
 *
 * Usage: pnpm tsx scripts/count-plant-credentials.ts
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Raw data: loaded at runtime from a gitignored TSV (see loadRaw below).
// Columns: project | brand | username | password | url | created
// ─────────────────────────────────────────────────────────────────────────

interface RawRow {
  project: string;
  brand: string;
  username: string;
  password: string;
  url: string;
  created: string;
}

// Credentials are real customer/portal secrets — NEVER inline them here.
// They are loaded at runtime from a gitignored TSV (same convention as
// growatt-credentials-*.tsv / fimer-credentials-*.tsv). Create the file with
// one row per credential, tab-separated, columns in this exact order:
//
//   project<TAB>brand<TAB>username<TAB>password<TAB>url<TAB>created
//
// Empty fields stay empty (two consecutive tabs). A header line is optional;
// if the first line mentions "project" + "password" it is skipped.
const DUMP_FILE = resolve(__dirname, 'data/plant-credentials-dump.tsv');

function loadRaw(): RawRow[] {
  if (!existsSync(DUMP_FILE)) {
    console.error(
      `Missing credentials dump: ${DUMP_FILE}\n` +
        `This file is gitignored (it holds plaintext portal passwords).\n` +
        `Paste the dump as tab-separated rows: project<TAB>brand<TAB>username<TAB>password<TAB>url<TAB>created`,
    );
    process.exit(1);
  }
  const lines = readFileSync(DUMP_FILE, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (
    lines.length > 0 &&
    lines[0].toLowerCase().includes('project') &&
    lines[0].toLowerCase().includes('password')
  ) {
    lines.shift();
  }
  return lines.map((line) => {
    const [project = '', brand = '', username = '', password = '', url = '', created = ''] =
      line.split('\t');
    return {
      project: project.trim(),
      brand: brand.trim(),
      username: username.trim(),
      password: password.trim(),
      url: url.trim(),
      created: created.trim(),
    };
  });
}

const RAW: RawRow[] = loadRaw();

// ─────────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────────

const BRANDS = [
  'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
  'deye', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
] as const;
type Brand = typeof BRANDS[number];

function classify(row: RawRow): Brand {
  const u = row.url.toLowerCase();
  if (u) {
    if (u.includes('solarmanpv') || u.includes('solarman')) return 'deye';
    if (u.includes('isolarcloud')) return 'sungrow';
    if (u.includes('growatt')) return 'growatt';
    if (u.includes('auroravision') || u.includes('fimer')) return 'fimer';
    if (u.includes('polycabmonitoring')) return 'polycab';
    if (u.includes('power-datacenter') || u.includes('flinenergy')) return 'flin_energy';
    if (u.includes('solarweb') || u.includes('fronius')) return 'fronius';
    if (u.includes('havells')) return 'havells';
    if (u.includes('fusionsolar') || u.includes('huawei')) return 'huawei';
    if (u.includes('sma') || u.includes('sunnyportal')) return 'sma';
    if (u.includes('semsportal') || u.includes('goodwe')) return 'goodwe';
  }
  // Brand-column fallback (normalize typos)
  const b = row.brand.toLowerCase().trim();
  if (b === 'sungrow') return 'sungrow';
  if (b === 'growatt') return 'growatt';
  if (b === 'deye') return 'deye';
  if (b === 'goodwe' || b === 'goodwee') return 'goodwe';
  if (b === 'fimer') return 'fimer';
  if (b === 'polycab') return 'polycab';
  if (b === 'havells') return 'havells';
  if (b === 'flin energy' || b === 'flin_energy') return 'flin_energy';
  if (b === 'fronius' || b === 'fronious' || b === 'fronius solar web') return 'fronius';
  if (b === 'sma') return 'sma';
  if (b === 'huawei') return 'huawei';
  if (b === 'solis') return 'solis';
  return 'other';
}

function portalOf(row: RawRow): string {
  const u = row.url.toLowerCase();
  if (u.includes('solarmanpv')) return 'Solarman';
  if (u.includes('isolarcloud')) return 'iSolarCloud';
  if (u.includes('server.growatt')) return 'server.growatt.com';
  if (u.includes('auroravision')) return 'AuroraVision';
  if (u.includes('polycabmonitoring')) return 'Polycab Monitoring';
  if (u.includes('power-datacenter')) return 'Flin power-datacenter';
  if (u.includes('solarweb') || u.includes('fronius')) return 'Fronius Solar Web';
  if (u.includes('havells')) return 'Havells';
  if (u.includes('semsportal')) return 'SEMS Portal';
  if (u.includes('fusionsolar')) return 'FusionSolar';
  return '(no url)';
}

function normLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
function normUser(s: string): string {
  return s.toLowerCase().trim();
}

// Strip inverter-suffix for multi-inverter plant grouping
function stripInverterSuffix(label: string): string {
  return label
    .replace(/_Inverter_\d+\([^)]*\)$/i, '')
    .replace(/-Inv-\d+\([^)]*\)$/i, '')
    .replace(/-Inv-\d+$/i, '')
    .replace(/_Inv-\d+$/i, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Process
// ─────────────────────────────────────────────────────────────────────────

interface ProcessedRow extends RawRow {
  brandFinal: Brand;
  portal: string;
  stripped: string;       // project label with inverter-suffix removed
  dedupeKey: string;      // normLabel(stripped) | brandFinal | normUser(username)
  parsedDate: number;     // YYYY-MM-DD → epoch ms, or NaN
}

const processed: ProcessedRow[] = RAW.map((r) => {
  const brandFinal = classify(r);
  const stripped = stripInverterSuffix(r.project);
  const dedupeKey = `${normLabel(stripped)}|${brandFinal}|${normUser(r.username)}`;
  const parsedDate = r.created ? Date.parse(r.created) : NaN;
  return { ...r, brandFinal, portal: portalOf(r), stripped, dedupeKey, parsedDate };
});

// Inverter count: total non-deduped rows per brand (the ASK from Vivek).
// Each row in the raw list = one inverter at one site, even if multiple
// rows share a portal login (multi-inverter plants).
const inverterCountByBrand = new Map<Brand, number>();
for (const b of BRANDS) inverterCountByBrand.set(b, 0);
for (const r of processed) {
  inverterCountByBrand.set(r.brandFinal, (inverterCountByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Plant count: dedupe by (stripped project label + brand) — this collapses
// multi-inverter plants AND row-level duplicates.
const plantSeen = new Set<string>();
const plantCountByBrand = new Map<Brand, number>();
for (const b of BRANDS) plantCountByBrand.set(b, 0);
for (const r of processed) {
  const key = `${normLabel(r.stripped)}|${r.brandFinal}`;
  if (plantSeen.has(key)) continue;
  plantSeen.add(key);
  plantCountByBrand.set(r.brandFinal, (plantCountByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Credential rows after full dedupe (the count the importer will land):
// (project_label, brand, username) — latest-by-date wins, paste-order fallback.
const dedupeMap = new Map<string, ProcessedRow>();
for (const r of processed) {
  const existing = dedupeMap.get(r.dedupeKey);
  if (!existing) {
    dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // Both have a date → latest wins
  if (!isNaN(r.parsedDate) && !isNaN(existing.parsedDate)) {
    if (r.parsedDate > existing.parsedDate) dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // New row has a date, existing doesn't → new wins
  if (!isNaN(r.parsedDate) && isNaN(existing.parsedDate)) {
    dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // Existing has date, new doesn't → existing wins (already set)
  if (isNaN(r.parsedDate) && !isNaN(existing.parsedDate)) continue;
  // Neither has date → paste-order: later row wins
  dedupeMap.set(r.dedupeKey, r);
}
const dedupedRows = [...dedupeMap.values()];
const credentialRowsByBrand = new Map<Brand, number>();
for (const b of BRANDS) credentialRowsByBrand.set(b, 0);
for (const r of dedupedRows) {
  credentialRowsByBrand.set(r.brandFinal, (credentialRowsByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Cross-tab: brand × portal (so the "Solarman = Deye" reclassification is visible)
const crosstab = new Map<string, number>();
for (const r of processed) {
  const k = `${r.brandFinal} × ${r.portal}`;
  crosstab.set(k, (crosstab.get(k) ?? 0) + 1);
}

// Duplicates dropped (for audit)
const dupGroups = new Map<string, ProcessedRow[]>();
for (const r of processed) {
  const arr = dupGroups.get(r.dedupeKey) ?? [];
  arr.push(r);
  dupGroups.set(r.dedupeKey, arr);
}
const dupesDropped: { kept: ProcessedRow; dropped: ProcessedRow[] }[] = [];
for (const [, arr] of dupGroups) {
  if (arr.length < 2) continue;
  const kept = dedupeMap.get(arr[0]!.dedupeKey)!;
  const dropped = arr.filter((r) => r !== kept);
  dupesDropped.push({ kept, dropped });
}

// ─────────────────────────────────────────────────────────────────────────
// Render Markdown
// ─────────────────────────────────────────────────────────────────────────

const lines: string[] = [];
lines.push('# Plant-monitoring credentials — brand counts (2026-06-05)');
lines.push('');
lines.push('Source: Vivek\'s pasted dump on 2026-06-05.');
lines.push('Classification: portal URL takes precedence; brand column is fallback when URL is blank.');
lines.push('');
lines.push(`**Raw rows pasted:** ${RAW.length}`);
lines.push(`**Distinct plants (after multi-inverter collapse + row-level dedupe):** ${plantSeen.size}`);
lines.push(`**Credentials rows after dedupe (what the importer will create):** ${dedupedRows.length}`);
lines.push(`**Duplicate groups dropped:** ${dupesDropped.length}`);
lines.push('');
lines.push('---');
lines.push('');

lines.push('## Inverter count by brand');
lines.push('');
lines.push('One inverter = one row in the raw paste (multi-inverter plants like Mrinal Mills count as 4).');
lines.push('Use this for inverter-API integration priority.');
lines.push('');
lines.push('| Brand | Inverters | Plants | Cred rows after dedupe |');
lines.push('|---|---:|---:|---:|');
const sortedBrands = [...BRANDS].sort((a, b) =>
  (inverterCountByBrand.get(b) ?? 0) - (inverterCountByBrand.get(a) ?? 0),
);
for (const b of sortedBrands) {
  const inv = inverterCountByBrand.get(b) ?? 0;
  if (inv === 0) continue;
  lines.push(`| ${b} | ${inv} | ${plantCountByBrand.get(b) ?? 0} | ${credentialRowsByBrand.get(b) ?? 0} |`);
}
lines.push('');

lines.push('## Cross-tab: brand × portal');
lines.push('');
lines.push('Confirms the "Solarman is Deye" reclassification — all Solarman rows now land under Deye.');
lines.push('');
lines.push('| Brand × Portal | Inverters |');
lines.push('|---|---:|');
const sortedCross = [...crosstab.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of sortedCross) lines.push(`| ${k} | ${v} |`);
lines.push('');

lines.push('## Duplicates dropped');
lines.push('');
lines.push('Latest-by-Created-date wins; paste-order fallback when no date.');
lines.push('');
for (const { kept, dropped } of dupesDropped) {
  lines.push(`- **KEPT:** ${kept.stripped} | brand=${kept.brandFinal} | user=${kept.username} | pw=${kept.password} | created=${kept.created || '(none)'}`);
  for (const d of dropped) {
    lines.push(`  - dropped: pw=${d.password} | created=${d.created || '(none)'}`);
  }
}
lines.push('');

writeFileSync(
  resolve('scripts/data/credentials-brand-counts-2026-06-05.md'),
  lines.join('\n'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────────
// Print summary to stdout
// ─────────────────────────────────────────────────────────────────────────

console.log('Raw rows:', RAW.length);
console.log('Distinct plants:', plantSeen.size);
console.log('Credential rows after dedupe:', dedupedRows.length);
console.log('Duplicate groups dropped:', dupesDropped.length);
console.log('');
console.log('Inverters by brand:');
for (const b of sortedBrands) {
  const inv = inverterCountByBrand.get(b) ?? 0;
  if (inv === 0) continue;
  console.log(`  ${b.padEnd(14)} ${String(inv).padStart(4)} inverters | ${String(plantCountByBrand.get(b) ?? 0).padStart(3)} plants | ${String(credentialRowsByBrand.get(b) ?? 0).padStart(3)} cred rows`);
}
console.log('');
console.log('Wrote scripts/data/credentials-brand-counts-2026-06-05.md');
