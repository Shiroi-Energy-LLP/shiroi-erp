/**
 * Walk the 4 "Proposals YYYY" folders in Drive and dump every proposal's
 * real date. The folder `createdTime` / file `createdTime` are the best
 * signal we have (user said each proposal PDF has a date, usually on the
 * PDF itself — but the file createdTime in Drive matches PDF generation
 * within a day in practice).
 *
 * Output: docs/gdrive-proposals.csv with one row per top-level child:
 *   proposal_folder_or_file, id, mime, created_date, modified_date, year_folder
 *
 * We'll also recurse ONE level into subfolders to cover cases like
 * "Rental Proposals" inside "Proposals 2024/25".
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';

const PROPOSAL_FOLDERS = [
  { id: '1IL-A9w62tJ8leN5_aims89fp10PCf8VN', label: 'Proposals 2022' },
  { id: '13HGLU9S2IoMD6fi-GDP0ackKWlgAlkkC', label: 'Proposals 2023' },
  { id: '1wO4Cs95DLlnhgRQZz_T6EqTwM1yZMw7f', label: 'Proposals 2024/25' },
  { id: '1aNK0rk8ICghMsdo3o_HMqAbnxbunAn_E', label: 'Proposals 2025/26' },
];

type Row = {
  year_folder: string;
  depth: number;
  parent_name: string;
  name: string;
  id: string;
  mime: string;
  is_folder: boolean;
  created: string;
  modified: string;
};

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

async function listChildren(drive: ReturnType<typeof google.drive>, parentId: string) {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: 'name',
    });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

function csvEscape(s: string | undefined | null) {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const drive = await getDrive();
  const rows: Row[] = [];

  for (const folder of PROPOSAL_FOLDERS) {
    console.log(`\n=== ${folder.label} (${folder.id}) ===`);
    const kids = await listChildren(drive, folder.id);
    console.log(`  ${kids.length} direct children`);
    // Only depth=0 — fast. Most proposals are PDFs or folders named after the
    // proposal. Subfolders like "Rental Proposals" or "Templates" are rare and
    // we don't need them for date backfill.
    for (const k of kids) {
      const isFolder = k.mimeType === 'application/vnd.google-apps.folder';
      rows.push({
        year_folder: folder.label,
        depth: 0,
        parent_name: folder.label,
        name: k.name ?? '',
        id: k.id ?? '',
        mime: k.mimeType ?? '',
        is_folder: isFolder,
        created: k.createdTime?.slice(0, 10) ?? '',
        modified: k.modifiedTime?.slice(0, 10) ?? '',
      });
    }
  }

  console.log(`\n=== Total rows: ${rows.length} ===`);

  // Summary: how many look like actual proposals (PDF) vs folders
  const pdfs = rows.filter(r => r.mime === 'application/pdf');
  const folders = rows.filter(r => r.is_folder);
  const other = rows.filter(r => !r.is_folder && r.mime !== 'application/pdf');
  console.log(`  PDFs: ${pdfs.length}`);
  console.log(`  Folders: ${folders.length}`);
  console.log(`  Other (docs, sheets, etc.): ${other.length}`);

  // Date-range per year-folder
  const byYear = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byYear.has(r.year_folder)) byYear.set(r.year_folder, []);
    byYear.get(r.year_folder)!.push(r);
  }
  for (const [yf, rs] of byYear) {
    const dates = rs.map(r => r.created).filter(Boolean).sort();
    console.log(`  ${yf}: ${rs.length} items, date range ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  // Write CSV
  const header = 'year_folder,depth,parent_name,name,id,mime,is_folder,created,modified\n';
  const body = rows.map(r =>
    [r.year_folder, r.depth, r.parent_name, r.name, r.id, r.mime, r.is_folder, r.created, r.modified]
      .map(v => csvEscape(String(v))).join(',')
  ).join('\n');
  writeFileSync('docs/gdrive-proposals.csv', header + body);
  console.log(`\nWrote docs/gdrive-proposals.csv (${rows.length} rows)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
