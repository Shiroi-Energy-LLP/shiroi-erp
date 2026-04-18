/**
 * Explore Drive structure around the 2024/2025 parent folders:
 *   1. Find their shared parent (e.g. "Shiroi / Projects / ...")
 *   2. List siblings of the 2024/2025 folders — hoping for a "Proposals" folder
 *   3. For one sample project folder, list children to understand what subfolders
 *      exist (is there a per-project "Proposal" subfolder? PDFs at top level?)
 *
 * Usage: npx tsx scripts/explore-gdrive-structure.ts
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const FOLDER_2024_ID = '1O1pWXIuFrziYQBDKzFke6wtMK9jiv3zV';
const FOLDER_2025_ID = '1P7zYzfnos539MchVIcg_KRsorxO97XWs';
// Sample: one 2024 project folder (Luxe Built Homes) + one 2025
const SAMPLE_PROJECT_2024 = '1QQh-Wl1-JDC-puwR1s7eDprLaOM8-Kr_';

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

async function getFolderInfo(drive: ReturnType<typeof google.drive>, id: string) {
  const res = await drive.files.get({
    fileId: id,
    fields: 'id, name, parents, mimeType, createdTime, modifiedTime',
    supportsAllDrives: true,
  });
  return res.data;
}

async function listChildren(drive: ReturnType<typeof google.drive>, parentId: string, onlyFolders = false) {
  const q = onlyFolders
    ? `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    : `'${parentId}' in parents and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files ?? [];
}

async function main() {
  const drive = await getDrive();
  console.log('=== 2024 folder metadata ===');
  const f2024 = await getFolderInfo(drive, FOLDER_2024_ID);
  console.log(`  name: ${f2024.name}`);
  console.log(`  parents: ${JSON.stringify(f2024.parents)}`);

  console.log('\n=== 2025 folder metadata ===');
  const f2025 = await getFolderInfo(drive, FOLDER_2025_ID);
  console.log(`  name: ${f2025.name}`);
  console.log(`  parents: ${JSON.stringify(f2025.parents)}`);

  // Siblings (if parents match)
  const parent2024 = f2024.parents?.[0];
  const parent2025 = f2025.parents?.[0];
  if (parent2024 && parent2024 === parent2025) {
    console.log(`\n=== Siblings under ${parent2024} ===`);
    const siblings = await listChildren(drive, parent2024);
    for (const s of siblings) {
      console.log(`  [${s.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE'}] ${s.name}  (id: ${s.id})`);
    }
  } else {
    console.log(`\n2024 parent: ${parent2024}  2025 parent: ${parent2025}  (different — listing each)`);
    if (parent2024) {
      console.log(`\n=== 2024 parent siblings (${parent2024}) ===`);
      const s24 = await listChildren(drive, parent2024);
      for (const s of s24) console.log(`  [${s.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE'}] ${s.name}`);
    }
    if (parent2025 && parent2025 !== parent2024) {
      console.log(`\n=== 2025 parent siblings (${parent2025}) ===`);
      const s25 = await listChildren(drive, parent2025);
      for (const s of s25) console.log(`  [${s.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE'}] ${s.name}`);
    }
  }

  // Sample: drill into one 2024 project folder
  console.log(`\n=== Children of SAMPLE 2024 project (${SAMPLE_PROJECT_2024}) ===`);
  const sample = await getFolderInfo(drive, SAMPLE_PROJECT_2024);
  console.log(`  name: ${sample.name}`);
  const kids = await listChildren(drive, SAMPLE_PROJECT_2024);
  for (const k of kids) {
    const kind = k.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE';
    console.log(`  [${kind}] ${k.name}  (created ${k.createdTime?.slice(0, 10)}, modified ${k.modifiedTime?.slice(0, 10)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
