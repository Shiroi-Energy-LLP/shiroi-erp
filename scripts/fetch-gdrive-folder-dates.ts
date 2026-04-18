/**
 * Fetch Google Drive folder metadata (createdTime, modifiedTime) for all
 * project folders under the 2024 + 2025 year folders. Writes a CSV for
 * subsequent fuzzy-matching against ERP projects.
 *
 * Output: docs/gdrive-folder-dates.csv
 *   columns: folder_id, folder_name, created_time, modified_time
 *
 * Usage: npx tsx scripts/fetch-gdrive-folder-dates.ts
 */

import { google } from 'googleapis';
import { writeFileSync, readFileSync } from 'fs';
import * as path from 'path';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const FOLDER_2024_ID = '1O1pWXIuFrziYQBDKzFke6wtMK9jiv3zV';
const FOLDER_2025_ID = '1P7zYzfnos539MchVIcg_KRsorxO97XWs';
const OUTPUT_PATH = path.resolve(__dirname, '../docs/gdrive-folder-dates.csv');

interface FolderMeta {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  parent: string;
}

async function getDriveClient() {
  const keyRaw = readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf-8');
  const key = JSON.parse(keyRaw);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  await auth.authorize();
  return google.drive({ version: 'v3', auth });
}

async function listChildFolders(drive: ReturnType<typeof google.drive>, parentId: string): Promise<FolderMeta[]> {
  const out: FolderMeta[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.createdTime && f.modifiedTime) {
        out.push({
          id: f.id,
          name: f.name,
          createdTime: f.createdTime,
          modifiedTime: f.modifiedTime,
          parent: parentId === FOLDER_2024_ID ? '2024' : '2025',
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const op = '[fetch-gdrive-folder-dates]';
  console.log(`${op} Authenticating...`);
  const drive = await getDriveClient();

  console.log(`${op} Listing 2024 folder children...`);
  const folders2024 = await listChildFolders(drive, FOLDER_2024_ID);
  console.log(`${op}   -> ${folders2024.length} folders`);

  console.log(`${op} Listing 2025 folder children...`);
  const folders2025 = await listChildFolders(drive, FOLDER_2025_ID);
  console.log(`${op}   -> ${folders2025.length} folders`);

  const all = [...folders2024, ...folders2025];
  console.log(`${op} Total folders: ${all.length}`);

  const header = 'folder_id,folder_name,parent,created_time,modified_time';
  const lines = [header];
  for (const f of all) {
    lines.push([
      f.id,
      escapeCsv(f.name),
      f.parent,
      f.createdTime,
      f.modifiedTime,
    ].join(','));
  }
  writeFileSync(OUTPUT_PATH, lines.join('\n'));
  console.log(`${op} Wrote ${OUTPUT_PATH}`);

  // Summary stats
  const byYear: Record<string, number> = {};
  for (const f of all) {
    const y = f.createdTime.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
  }
  console.log(`${op} createdTime year breakdown:`);
  for (const [y, n] of Object.entries(byYear).sort()) {
    console.log(`   ${y}: ${n}`);
  }
}

main().catch((e) => {
  console.error('[fetch-gdrive-folder-dates] FATAL', e);
  process.exit(1);
});
