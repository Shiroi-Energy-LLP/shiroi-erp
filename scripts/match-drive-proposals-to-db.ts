/**
 * Match Drive proposal folders to DB proposals by proposal_number.
 *
 * Input:  docs/gdrive-proposals.csv (1405 rows of Drive folder data)
 * DB:     proposals.proposal_number (752 rows, many formats)
 * Output: docs/drive-proposal-date-matches.csv
 *
 * Normalisation rules (both sides):
 *   1. Remove leading/trailing whitespace.
 *   2. Uppercase.
 *   3. Remove "PV" prefix and any spaces between it and the number.
 *   4. Strip leading zeros from the numeric part.
 *   5. Normalise separator: "-" or "/" or " " → "/".
 *   6. Normalise year form:
 *        - Trailing 4-digit year → last 2 digits (e.g. "2022" → "22").
 *        - Trailing "YY-YY" → keep as-is.
 *        - Trailing "YY" → keep as-is.
 *
 * Match key format: "{num}/{year-suffix}" e.g. "18/22", "169/25-26"
 *
 * Special sources:
 *   - SHIROI/PROP/YYYY-YY/NNNN → not in Drive (internally generated), skip.
 *   - SE/PV/NNN/YYYY → look for "PV{num}-{yy}" or similar in Drive.
 *   - "NNN/YY-YY" or "NNN-YY-YY" → strip PV, keep num.
 *
 * Per match, we record:
 *   - db_proposal_id
 *   - db_proposal_number
 *   - db_current_date (what we have now)
 *   - drive_folder_name
 *   - drive_folder_id
 *   - drive_created  (the real date if not bulk-reorg)
 *   - drive_modified
 *   - year_folder    (which Proposals YYYY folder this came from)
 *   - bulk_reorg_flag  (true if Drive createdTime falls in a known bulk-reorg window)
 *   - match_quality  (exact | parsed | ambiguous)
 */

import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const url = 'https://actqtzoxjilqnldnacqz.supabase.co';
const secret = process.env.SUPABASE_SECRET_KEY;
if (!secret) { console.error('SUPABASE_SECRET_KEY env var missing'); process.exit(1); }

const BULK_REORG_WINDOWS: [string, string][] = [
  // Proposals 2022 — everything imported 2023-05-23/29
  ['2023-05-17', '2023-05-31'],
];

function parseCSV(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const header = lines[0].split(',');
  const out: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    // simple CSV parser (no embedded newlines expected in our data)
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
    out.push(row);
  }
  return out;
}

// Extract a canonical key like "18/22" or "169/25-26" from a messy string.
function extractKey(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();

  // Strip leading "PV" and any whitespace
  s = s.replace(/^PV\s*/, '');
  // Strip "SE/PV/" prefix
  s = s.replace(/^SE\/PV\//, '');

  // Patterns to try, in priority order.
  // 1. NNN/YY-YY (FY short, e.g. 169/25-26)
  let m = s.match(/^(\d+)\s*[\/\-]\s*(\d{2})\s*[\/\-]\s*(\d{2})/);
  if (m) return `${parseInt(m[1], 10)}/${m[2]}-${m[3]}`;

  // 2. NNN/YYYY (4-digit CY, e.g. 02/2022)
  m = s.match(/^(\d+)\s*[\/\-]\s*(20\d{2})/);
  if (m) return `${parseInt(m[1], 10)}/${m[2].slice(2)}`;

  // 3. NNN/YY (2-digit CY, e.g. 18/23)
  m = s.match(/^(\d+)\s*[\/\-]\s*(\d{2})/);
  if (m) return `${parseInt(m[1], 10)}/${m[2]}`;

  return null;
}

function isBulkReorgDate(date: string): boolean {
  if (!date) return false;
  return BULK_REORG_WINDOWS.some(([start, end]) => date >= start && date <= end);
}

function csvEscape(s: string | undefined | null) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function main() {
  const supabase = createClient(url, secret!, { auth: { persistSession: false } });

  // 1. Load DB proposals
  console.log('Loading proposals from DB...');
  const { data: proposals, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, created_at, lead_id')
    .order('proposal_number');
  if (error) { console.error(error); process.exit(1); }
  console.log(`  ${proposals?.length} proposals`);

  // Build a lookup: key → [{id, number, current_date}]
  const dbByKey = new Map<string, { id: string; number: string; current_date: string }[]>();
  let dbKeyed = 0;
  let dbSkipped_shiroi = 0;
  for (const p of proposals ?? []) {
    // Skip SHIROI/PROP/* — these are internal; Drive doesn't use them.
    if (p.proposal_number.startsWith('SHIROI/PROP/') || p.proposal_number.startsWith('SHIROI/PRP/')) {
      dbSkipped_shiroi++;
      continue;
    }
    const key = extractKey(p.proposal_number);
    if (!key) continue;
    dbKeyed++;
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key)!.push({
      id: p.id,
      number: p.proposal_number,
      current_date: String(p.created_at).slice(0, 10),
    });
  }
  console.log(`  ${dbKeyed} keyed, ${dbSkipped_shiroi} SHIROI (skipped), ${(proposals?.length ?? 0) - dbKeyed - dbSkipped_shiroi} unkeyable`);

  // 2. Load Drive proposals
  console.log('\nLoading Drive proposals...');
  const drive = parseCSV('docs/gdrive-proposals.csv');
  console.log(`  ${drive.length} rows`);

  // 3. Match each Drive row to DB proposal(s)
  const matches: any[] = [];
  let driveKeyed = 0;
  let driveMatched = 0;
  let driveUnmatched = 0;
  let ambiguous = 0;

  for (const d of drive) {
    const key = extractKey(d.name);
    if (!key) continue;
    driveKeyed++;
    const candidates = dbByKey.get(key);
    if (!candidates || candidates.length === 0) {
      driveUnmatched++;
      continue;
    }
    if (candidates.length > 1) ambiguous++;
    driveMatched++;
    for (const c of candidates) {
      matches.push({
        key,
        db_id: c.id,
        db_number: c.number,
        db_current: c.current_date,
        drive_name: d.name,
        drive_id: d.id,
        drive_created: d.created,
        drive_modified: d.modified,
        year_folder: d.year_folder,
        bulk_reorg: isBulkReorgDate(d.created),
        candidate_count: candidates.length,
      });
    }
  }

  console.log(`\nDrive keyed: ${driveKeyed}, matched: ${driveMatched}, unmatched: ${driveUnmatched}, ambiguous keys: ${ambiguous}`);

  // 4. Write full match CSV
  const header = 'key,db_id,db_number,db_current,drive_name,drive_id,drive_created,drive_modified,year_folder,bulk_reorg,candidate_count\n';
  const body = matches.map(m =>
    [m.key, m.db_id, m.db_number, m.db_current, m.drive_name, m.drive_id, m.drive_created, m.drive_modified, m.year_folder, m.bulk_reorg, m.candidate_count]
      .map(v => csvEscape(String(v))).join(',')
  ).join('\n');
  writeFileSync('docs/drive-proposal-date-matches.csv', header + body);
  console.log(`\nWrote docs/drive-proposal-date-matches.csv (${matches.length} rows)`);

  // 5. Summary: how much would we change?
  let wouldImprove = 0;      // drive_created < db_current AND NOT bulk_reorg
  let bulkReorgSkip = 0;
  let alreadyBetter = 0;     // drive_created >= db_current
  for (const m of matches) {
    if (!m.drive_created) continue;
    if (m.bulk_reorg) { bulkReorgSkip++; continue; }
    if (m.drive_created < m.db_current) wouldImprove++;
    else alreadyBetter++;
  }
  console.log(`\n=== Impact forecast ===`);
  console.log(`  ${wouldImprove} proposals would move EARLIER (real Drive date < current DB date)`);
  console.log(`  ${alreadyBetter} already have DB date <= Drive date (no change)`);
  console.log(`  ${bulkReorgSkip} skipped — Drive createdTime in bulk-reorg window`);

  // 6. Also dump ambiguous keys (for audit)
  const ambiguousList = [...new Set(matches.filter(m => m.candidate_count > 1).map(m => m.key))];
  if (ambiguousList.length > 0) {
    console.log(`\n  ${ambiguousList.length} ambiguous keys (multiple DB proposals share same key):`);
    for (const k of ambiguousList.slice(0, 20)) {
      const cands = dbByKey.get(k)!;
      console.log(`    ${k} → ${cands.map(c => c.number).join(', ')}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
