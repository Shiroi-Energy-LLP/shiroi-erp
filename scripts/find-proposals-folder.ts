/**
 * Find the "Proposals" folder(s) in Shiroi Drive.
 *
 * User said: "all the quotes were done manually in Google drive named proposals.
 *            Check there is a proposal folder for each year."
 *
 * Strategy:
 *   1. Walk UP from 1s_58esQ1Xt-... to see the root.
 *   2. Use Drive search API to find any folder with "proposal" in name.
 *   3. For each, list its children to confirm.
 *   4. Also drill into 3-4 sample 2024/2025 project folders to see what's inside.
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const PARENT_OF_CONFIRMED = '1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D';

// Sample projects from different years, different families
const SAMPLES = [
  { id: '1QQh-Wl1-JDC-puwR1s7eDprLaOM8-Kr_', label: '2024 Luxe built homes' },
];

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

async function getInfo(drive: ReturnType<typeof google.drive>, id: string) {
  try {
    const res = await drive.files.get({
      fileId: id,
      fields: 'id, name, parents, mimeType, createdTime, modifiedTime, owners(emailAddress)',
      supportsAllDrives: true,
    });
    return res.data;
  } catch (e: any) {
    return { error: e.message };
  }
}

async function listChildren(drive: ReturnType<typeof google.drive>, parentId: string) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'name',
  });
  return res.data.files ?? [];
}

async function searchProposalFolders(drive: ReturnType<typeof google.drive>) {
  // Search for folders containing "proposal" in name across the drive
  const res = await drive.files.list({
    q: `name contains 'proposal' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents, createdTime, modifiedTime)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files ?? [];
}

async function searchQuoteFolders(drive: ReturnType<typeof google.drive>) {
  const res = await drive.files.list({
    q: `name contains 'quote' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents, createdTime, modifiedTime)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files ?? [];
}

async function main() {
  const drive = await getDrive();

  // 1. Walk up from parent-of-confirmed
  console.log('=== 1. Walking up from PARENT_OF_CONFIRMED ===');
  let curId: string | undefined = PARENT_OF_CONFIRMED;
  for (let i = 0; i < 6 && curId; i++) {
    const info: any = await getInfo(drive, curId);
    if (info.error) {
      console.log(`  [${i}] ERROR: ${info.error}`);
      break;
    }
    console.log(`  [${i}] ${info.name}  (id: ${info.id})  parents: ${JSON.stringify(info.parents)}`);
    curId = info.parents?.[0];
  }

  // 2. Search "proposal" folders
  console.log('\n=== 2. Drive search: folders named "proposal" ===');
  const prop = await searchProposalFolders(drive);
  console.log(`  Found ${prop.length} folders`);
  for (const f of prop.slice(0, 50)) {
    console.log(`  • ${f.name}  (id: ${f.id}, created: ${f.createdTime?.slice(0,10)}, parents: ${JSON.stringify(f.parents)})`);
  }

  // 3. Search "quote" folders
  console.log('\n=== 3. Drive search: folders named "quote" ===');
  const q = await searchQuoteFolders(drive);
  console.log(`  Found ${q.length} folders`);
  for (const f of q.slice(0, 50)) {
    console.log(`  • ${f.name}  (id: ${f.id}, created: ${f.createdTime?.slice(0,10)}, parents: ${JSON.stringify(f.parents)})`);
  }

  // 4. Drill into sample project folders deeply
  console.log('\n=== 4. Sample project folder contents ===');
  for (const s of SAMPLES) {
    console.log(`\n--- ${s.label} (${s.id}) ---`);
    const kids = await listChildren(drive, s.id);
    for (const k of kids) {
      const kind = k.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE';
      console.log(`  [${kind}] ${k.name}  (created ${k.createdTime?.slice(0, 10)}, modified ${k.modifiedTime?.slice(0, 10)})`);
      // If it's a folder, peek inside
      if (k.mimeType === 'application/vnd.google-apps.folder' && k.id) {
        const grandkids = await listChildren(drive, k.id);
        for (const g of grandkids.slice(0, 10)) {
          const gkind = g.mimeType === 'application/vnd.google-apps.folder' ? 'DIR ' : 'FILE';
          console.log(`    [${gkind}] ${g.name}  (created ${g.createdTime?.slice(0, 10)})`);
        }
        if (grandkids.length > 10) console.log(`    ... and ${grandkids.length - 10} more`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
