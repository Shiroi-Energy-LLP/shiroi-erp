/**
 * Fuzzy-match Google Drive folder names (docs/gdrive-folder-dates.csv) to
 * ERP projects (customer_name + project_number). Outputs:
 *
 *   docs/gdrive-project-matches.csv
 *     columns: folder_id, folder_name, parent_year, best_project_id,
 *              best_project_number, best_customer_name, similarity_score,
 *              current_project_created_at, drive_effective_date,
 *              would_change, confidence
 *
 * Scoring:
 *   - similarity = Jaro-Winkler between normalized folder_name and customer_name
 *   - "drive_effective_date" is MIN(createdTime, modifiedTime) clamped by parent
 *     year (parent=2024 and effective in 2025/2026 => use 2024-12-31)
 *   - confidence = high if score >= 0.90, medium if >= 0.80, low otherwise
 *
 * Usage: npx tsx scripts/match-gdrive-folders-to-projects.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY!;

interface DriveFolder {
  id: string;
  name: string;
  parent: string;
  createdTime: string;
  modifiedTime: string;
}

interface ErpProject {
  id: string;
  project_number: string | null;
  customer_name: string | null;
  created_at: string;
  actual_start_date: string | null;
  proposal_id: string | null;
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
        if (c === '\r' && next === '\n') i++;
      }
      else field += c;
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function escapeCsv(s: string | number | null): string {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Normalize a customer-ish string for fuzzy matching.
//  - lowercase
//  - strip common prefixes: "Mr ", "Mrs ", "Ms ", "M/s ", "Ms/ ", "M/S"
//  - strip capacity suffix like " / 3.3 kwp" or "/ 5 KWp"
//  - collapse whitespace and remove punctuation
function normalize(s: string): string {
  let out = s.toLowerCase();
  out = out.replace(/\s*\/\s*\d+(\.\d+)?\s*k\s*wp?\s*$/i, '');
  out = out.replace(/\s*\/\s*\d+(\.\d+)?\s*$/i, '');
  out = out.replace(/\bm\/?s\/?\b\.?/g, '');
  out = out.replace(/\bmr\b\.?/g, '');
  out = out.replace(/\bmrs\b\.?/g, '');
  out = out.replace(/\bms\b\.?/g, '');
  out = out.replace(/[^a-z0-9\s]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Jaro-Winkler similarity (public-domain reference implementation, compacted).
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatch[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let trans = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) trans++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - trans / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function effectiveDriveDate(f: DriveFolder): string {
  // earliest of createdTime and modifiedTime
  const earliest = f.createdTime < f.modifiedTime ? f.createdTime : f.modifiedTime;
  // clamp by parent year: if parent=2024 but date is in 2025/2026, snap to 2024-12-31
  const year = earliest.slice(0, 4);
  if (f.parent === '2024' && year !== '2024') {
    return '2024-12-31T00:00:00.000Z';
  }
  if (f.parent === '2025' && (year === '2026' || year === '2027')) {
    return '2025-12-31T00:00:00.000Z';
  }
  return earliest;
}

async function main() {
  const op = '[match-gdrive]';
  console.log(`${op} Loading drive folders...`);
  const csvPath = path.resolve(__dirname, '../docs/gdrive-folder-dates.csv');
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf-8'));
  const header = rows[0];
  const idIdx = header.indexOf('folder_id');
  const nameIdx = header.indexOf('folder_name');
  const parentIdx = header.indexOf('parent');
  const createdIdx = header.indexOf('created_time');
  const modifiedIdx = header.indexOf('modified_time');
  const folders: DriveFolder[] = rows.slice(1).filter((r) => r.length >= 5).map((r) => ({
    id: r[idIdx],
    name: r[nameIdx],
    parent: r[parentIdx],
    createdTime: r[createdIdx],
    modifiedTime: r[modifiedIdx],
  }));
  console.log(`${op} Loaded ${folders.length} folders`);

  console.log(`${op} Fetching ERP projects...`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, created_at, actual_start_date, proposal_id');
  if (error) { console.error(op, error); process.exit(1); }
  console.log(`${op} Loaded ${projects!.length} ERP projects`);

  // Precompute normalized project names
  const normProjects = projects!.map((p) => ({ ...p, norm: normalize(p.customer_name ?? '') }));

  // Match
  const outLines = ['folder_id,folder_name,parent_year,best_project_id,best_project_number,best_customer_name,similarity_score,current_project_created_at,drive_effective_date,would_change,confidence'];
  let high = 0, medium = 0, low = 0, wouldChange = 0;
  for (const f of folders) {
    const nf = normalize(f.name);
    let bestScore = 0;
    let best: typeof normProjects[number] | null = null;
    for (const p of normProjects) {
      if (!p.norm) continue;
      const score = jaroWinkler(nf, p.norm);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    const effective = effectiveDriveDate(f);
    const wouldChangeFlag = best && best.created_at > effective;
    const confidence = bestScore >= 0.90 ? 'high' : bestScore >= 0.80 ? 'medium' : 'low';
    if (confidence === 'high') high++;
    else if (confidence === 'medium') medium++;
    else low++;
    if (wouldChangeFlag && confidence !== 'low') wouldChange++;
    outLines.push([
      escapeCsv(f.id),
      escapeCsv(f.name),
      escapeCsv(f.parent),
      escapeCsv(best?.id ?? ''),
      escapeCsv(best?.project_number ?? ''),
      escapeCsv(best?.customer_name ?? ''),
      bestScore.toFixed(4),
      escapeCsv(best?.created_at ?? ''),
      escapeCsv(effective),
      wouldChangeFlag ? '1' : '0',
      confidence,
    ].join(','));
  }
  const outPath = path.resolve(__dirname, '../docs/gdrive-project-matches.csv');
  fs.writeFileSync(outPath, outLines.join('\n'));
  console.log(`${op} Wrote ${outPath}`);
  console.log(`${op} High-confidence: ${high}  Medium: ${medium}  Low: ${low}`);
  console.log(`${op} Of high+medium matches, ${wouldChange} would move project.created_at earlier`);
}

main().catch((e) => { console.error(e); process.exit(1); });
