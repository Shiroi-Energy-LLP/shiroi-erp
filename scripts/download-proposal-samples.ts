/**
 * Download a stratified sample of proposal PDFs from the 4 Drive year folders
 * for offline analysis (proposal-template design work).
 *
 * Output: scripts/data/proposal-samples/<year>/<name>.pdf
 *         scripts/data/proposal-samples/_manifest.json
 *
 * The samples directory is gitignored.
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const OUT_DIR = path.join('scripts', 'data', 'proposal-samples');

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
  parents?: string[];
}

interface CsvRow {
  year_folder: string;
  depth: string;
  parent_name: string;
  name: string;
  id: string;
  mime: string;
  is_folder: string;
  created: string;
  modified: string;
}

function readCsv(p: string): CsvRow[] {
  const text = readFileSync(p, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!.split(',');
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]!);
    const r: any = {};
    for (let j = 0; j < header.length; j++) r[header[j]!] = parts[j] ?? '';
    rows.push(r);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function getDrive() {
  const key = JSON.parse(readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf-8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  await auth.authorize();
  return google.drive({ version: 'v3', auth });
}

async function downloadPdf(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  destPath: string,
): Promise<void> {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath);
    (res.data as NodeJS.ReadableStream)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .pipe(out);
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

async function main() {
  const csvPath = path.join('docs', 'gdrive-proposals.csv');
  if (!existsSync(csvPath)) {
    console.error(`Missing ${csvPath}. Run fetch-proposals-from-drive.ts first.`);
    process.exit(1);
  }

  const rows = readCsv(csvPath);
  const pdfs = rows.filter((r) => r.mime === 'application/pdf' && r.is_folder !== 'true');
  console.log(`Total PDFs in Drive: ${pdfs.length}`);

  const yearBuckets: Record<string, CsvRow[]> = {};
  for (const r of pdfs) {
    if (!yearBuckets[r.year_folder]) yearBuckets[r.year_folder] = [];
    yearBuckets[r.year_folder]!.push(r);
  }

  // Sort each bucket by created date descending
  for (const k of Object.keys(yearBuckets)) {
    yearBuckets[k]!.sort((a, b) => (a.created < b.created ? 1 : -1));
  }

  // Sample selection:
  //   - 2025/26: top 18 most recent
  //   - 2024/25: top 5
  //   - 2023: top 3
  //   - 2022: top 2 (oldest format references)
  const pick: Record<string, number> = {
    'Proposals 2025/26': 18,
    'Proposals 2024/25': 5,
    'Proposals 2023': 3,
    'Proposals 2022': 2,
  };

  const drive = await getDrive();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const manifest: Array<{
    year_folder: string;
    name: string;
    id: string;
    created: string;
    local_path: string;
  }> = [];

  for (const [year, n] of Object.entries(pick)) {
    const yearDir = path.join(OUT_DIR, year.replace(/[\/\\]/g, '_'));
    if (!existsSync(yearDir)) mkdirSync(yearDir, { recursive: true });

    const bucket = yearBuckets[year] ?? [];
    const sample = bucket.slice(0, n);
    console.log(`\n=== ${year}: sampling ${sample.length} of ${bucket.length} ===`);

    for (const r of sample) {
      const safe = sanitizeFilename(r.name);
      const localPath = path.join(yearDir, safe);
      if (existsSync(localPath)) {
        console.log(`  [skip] ${r.name}`);
      } else {
        try {
          await downloadPdf(drive, r.id, localPath);
          console.log(`  [ok]   ${r.name}`);
        } catch (err: any) {
          console.warn(`  [fail] ${r.name}: ${err?.message}`);
          continue;
        }
      }
      manifest.push({
        year_folder: r.year_folder,
        name: r.name,
        id: r.id,
        created: r.created,
        local_path: localPath,
      });
    }
  }

  writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nDone. Manifest at ${OUT_DIR}/_manifest.json (${manifest.length} files)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
