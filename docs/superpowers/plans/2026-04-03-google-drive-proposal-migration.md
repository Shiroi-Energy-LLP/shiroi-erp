# Google Drive Proposal Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 1,353 proposal folders from 4 Google Drive year-folders into Supabase, syncing with 1,115 existing HubSpot-imported leads, extracting pricing/BOM data from costing spreadsheets.

**Architecture:** Single TypeScript script (`scripts/migrate-drive-proposals.ts`) with `--year` and `--dry-run` flags. Reuses Google API client setup from existing `migrate-google-drive.ts`. Multi-tier name matching cascade from `fix-hubspot-v2.ts`. Processes one year folder at a time. Generates CSV audit reports.

**Tech Stack:** TypeScript, `googleapis` (Drive + Sheets API), `@supabase/supabase-js`, `xlsx` (for .xlsx parsing), existing `migration-utils.ts`.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/migrate-drive-proposals.ts` | Main migration script — scan, match, sync, report |
| `scripts/data/drive-proposals-{year}-audit.csv` | Generated audit report per year run |

No new files beyond the script. All parsing, matching, and sync logic in one file (~800-1000 lines). This mirrors the pattern of `fix-hubspot-v2.ts` and `migrate-google-drive.ts`.

---

### Task 1: Install xlsx dependency + scaffold script with CLI parsing

**Files:**
- Modify: `package.json` (root)
- Create: `scripts/migrate-drive-proposals.ts`

- [ ] **Step 1: Install xlsx package**

```bash
cd C:\Users\vivek\Projects\shiroi-erp && pnpm add -w xlsx
```

- [ ] **Step 2: Create script scaffold with env loading, CLI parsing, Google/Supabase client init**

Write `scripts/migrate-drive-proposals.ts`:

```typescript
/**
 * Google Drive Proposals → Shiroi ERP Migration
 *
 * Scans proposal folders from Google Drive, matches to existing HubSpot-imported
 * leads, extracts costing/BOM data from spreadsheets, and syncs to Supabase.
 *
 * Usage:
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2022
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2023 --dry-run
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2023
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2024-25 --dry-run
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2024-25
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2025-26 --dry-run
 *   npx tsx scripts/migrate-drive-proposals.ts --year 2025-26
 *
 * Prerequisites:
 *   - Service account key at C:\Users\vivek\Downloads\shiroi-migration-key.json
 *   - All 4 Drive folders shared with service account
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
 *   - Migrations 011 + 012 applied
 */

import { google, sheets_v4, drive_v3 } from 'googleapis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as XLSX from 'xlsx';

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(__dirname, '..', '.env.local'));

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');
const yearIdx = process.argv.indexOf('--year');
const yearArg = yearIdx !== -1 ? process.argv[yearIdx + 1] : null;

if (!yearArg) {
  console.error('Usage: npx tsx scripts/migrate-drive-proposals.ts --year <2022|2023|2024-25|2025-26> [--dry-run]');
  process.exit(1);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';

const YEAR_FOLDERS: Record<string, { folderId: string; fy: string }> = {
  '2022': { folderId: '1IL-A9w62tJ8leN5_aims89fp10PCf8VN', fy: '2022-23' },
  '2023': { folderId: '13HGLU9S2IoMD6fi-GDP0ackKWlgAlkkC', fy: '2023-24' },
  '2024-25': { folderId: '1wO4Cs95DLlnhgRQZz_T6EqTwM1yZMw7f', fy: '2024-25' },
  '2025-26': { folderId: '1aNK0rk8ICghMsdo3o_HMqAbnxbunAn_E', fy: '2025-26' },
};

const yearConfig = YEAR_FOLDERS[yearArg];
if (!yearConfig) {
  console.error(`Unknown year: ${yearArg}. Valid: 2022, 2023, 2024-25, 2025-26`);
  process.exit(1);
}

// ─── Google API ───────────────────────────────────────────────────────────────

function getGoogleClients(): { drive: drive_v3.Drive; sheets: sheets_v4.Sheets } {
  const keyFile = JSON.parse(readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  return {
    drive: google.drive({ version: 'v3', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  };
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ... (remaining code in subsequent tasks)

async function main() {
  const mode = isDryRun ? 'DRY RUN' : 'LIVE';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Google Drive Proposals Migration — ${yearArg} — ${mode}`);
  console.log(`  Folder: ${yearConfig.folderId}`);
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  // TODO: phases will be added in subsequent tasks
}

main().catch(err => {
  console.error('[migrate-drive-proposals] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the scaffold compiles and runs**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Expected output: the banner header, then exits (no phases yet).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-drive-proposals.ts package.json pnpm-lock.yaml
git commit -m "feat: scaffold Drive proposal migration script with CLI + env setup"
```

---

### Task 2: Drive scanning — list all folders and parse folder names

**Files:**
- Modify: `scripts/migrate-drive-proposals.ts`

- [ ] **Step 1: Add types and folder name parser**

Add after the constants section:

```typescript
// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedFolder {
  folderId: string;
  folderName: string;
  pvNumber: number | null;
  pvFy: string | null;
  customerName: string;
  driveUrl: string;
}

interface CostingData {
  systemSizeKwp: number;
  totalCost: number;
  costPerWatt: number;
  supplyCost: number;
  installationCost: number;
  panelBrand: string;
  panelModel: string;
  panelWattage: number;
  panelCount: number;
  inverterBrand: string;
  inverterModel: string;
  inverterCapacityKw: number;
}

interface FolderData extends ParsedFolder {
  hasSpreadsheet: boolean;
  spreadsheetId: string | null;
  spreadsheetType: 'google_sheet' | 'xlsx' | null;
  costing: CostingData | null;
}

interface MatchResult {
  matchType: 'pv_number' | 'name_exact' | 'name_fuzzy' | 'none';
  leadId: string | null;
  proposalId: string | null;
  projectId: string | null;
  customerName: string | null;
}

interface MigrationStats {
  foldersScanned: number;
  foldersWithSheet: number;
  foldersEmpty: number;
  matched: number;
  matchedByPv: number;
  matchedByName: number;
  newLeadsCreated: number;
  proposalsUpdated: number;
  proposalsCreated: number;
  projectsUpdated: number;
  skippedAlreadyMigrated: number;
  errors: string[];
}

// ─── Folder Name Parsing ──────────────────────────────────────────────────────

function parseFolderName(name: string): { pvNumber: number | null; pvFy: string | null; customerName: string } {
  // Match patterns: "PV345/25-26 Mr.Name", "PV134-22 Name", "PV275/23 DMS"
  const pvMatch = name.match(/PV\s*(\d+)\s*[\/\-]\s*(\d{2}(?:-\d{2})?)\s*(.*)/i);
  if (pvMatch) {
    const pvNumber = parseInt(pvMatch[1], 10);
    const pvFy = pvMatch[2];
    const customerName = pvMatch[3]
      .replace(/^[\s_\-]+/, '')
      .replace(/[\s_\-]+$/, '')
      .replace(/_/g, ' ')
      .trim();
    return { pvNumber, pvFy, customerName: customerName || name };
  }

  // No PV number — entire folder name is the customer name
  return {
    pvNumber: null,
    pvFy: null,
    customerName: name.replace(/_/g, ' ').trim(),
  };
}
```

- [ ] **Step 2: Add Drive folder listing function**

```typescript
// ─── Drive Scanning ───────────────────────────────────────────────────────────

async function listFolderContents(drive: drive_v3.Drive, folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const items: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 500,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      items.push({ id: f.id!, name: f.name!, mimeType: f.mimeType! });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}

async function scanYearFolder(drive: drive_v3.Drive, folderId: string): Promise<ParsedFolder[]> {
  const op = '[scanYearFolder]';
  const allItems = await listFolderContents(drive, folderId);

  // Only folders (skip root-level spreadsheets, docs, etc.)
  const folders = allItems.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  console.log(`${op} Found ${folders.length} proposal folders (skipping ${allItems.length - folders.length} root files)`);

  return folders.map(f => {
    const parsed = parseFolderName(f.name);
    return {
      folderId: f.id,
      folderName: f.name,
      pvNumber: parsed.pvNumber,
      pvFy: parsed.pvFy,
      customerName: parsed.customerName,
      driveUrl: `https://drive.google.com/drive/folders/${f.id}`,
    };
  });
}
```

- [ ] **Step 3: Wire scanning into main()**

Replace the TODO in `main()`:

```typescript
async function main() {
  const mode = isDryRun ? 'DRY RUN' : 'LIVE';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Google Drive Proposals Migration — ${yearArg} — ${mode}`);
  console.log(`  Folder: ${yearConfig.folderId}`);
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  const { drive, sheets } = getGoogleClients();

  // Phase 1: Scan folders
  console.log('[Phase 1] Scanning Drive folders...');
  const folders = await scanYearFolder(drive, yearConfig.folderId);
  console.log(`  Parsed ${folders.length} folders. ${folders.filter(f => f.pvNumber).length} have PV numbers.\n`);

  // Phase 2: Read spreadsheets (next task)
  // Phase 3: Match to DB (next task)
  // Phase 4: Sync (next task)
  // Phase 5: Report (next task)
}
```

- [ ] **Step 4: Test the scan**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Expected: banner, then "Found 312 proposal folders", parsed count, PV number count.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-drive-proposals.ts
git commit -m "feat: Drive scanning + folder name parsing with PV number extraction"
```

---

### Task 3: Spreadsheet reading — costing and BOM extraction

**Files:**
- Modify: `scripts/migrate-drive-proposals.ts`

- [ ] **Step 1: Add costing sheet parser**

```typescript
// ─── Sheet Reading ────────────────────────────────────────────────────────────

function parseINR(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/[₹,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function findCostingTab(tabNames: string[]): string | null {
  const lower = tabNames.map(t => t.toLowerCase().trim());
  // Priority: "costing sheet" > "costing" > "cost" > "summary"
  for (const pattern of ['costing sheet', 'costing', 'cost sheet', 'cost']) {
    const idx = lower.findIndex(t => t.includes(pattern));
    if (idx !== -1) return tabNames[idx];
  }
  return null;
}

function findBomTab(tabNames: string[]): string | null {
  const lower = tabNames.map(t => t.toLowerCase().trim());
  // Priority: contains "bom" > contains "kwp" > contains "bill"
  for (const pattern of ['bom', 'kwp', 'kw', 'bill of material']) {
    const idx = lower.findIndex(t => t.includes(pattern));
    if (idx !== -1) return tabNames[idx];
  }
  return null;
}

function parseCostingRows(rows: string[][]): Partial<CostingData> {
  const result: Partial<CostingData> = {};

  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const joined = row.join(' ').toLowerCase();

    // System size — look for "system size" label followed by a number
    if (joined.includes('system size') && !result.systemSizeKwp) {
      for (const cell of row) {
        const num = parseFloat(String(cell).replace(/[^0-9.]/g, ''));
        if (num > 0 && num < 10000) {
          result.systemSizeKwp = num;
          break;
        }
      }
    }

    // Total cost
    if (joined.includes('total cost') && !result.totalCost) {
      for (const cell of row) {
        const val = parseINR(cell);
        if (val > 10000) { result.totalCost = val; break; }
      }
    }

    // Cost per watt
    if (joined.includes('cost per watt') || joined.includes('per watt')) {
      for (const cell of row) {
        const val = parseINR(cell);
        if (val > 10 && val < 200) { result.costPerWatt = val; break; }
      }
    }

    // Supply cost
    if (joined.includes('supply cost') || joined.includes('supply including')) {
      for (const cell of row) {
        const val = parseINR(cell);
        if (val > 10000) { result.supplyCost = val; break; }
      }
    }

    // Installation cost
    if (joined.includes('installation cost') || joined.includes('installation including')) {
      for (const cell of row) {
        const val = parseINR(cell);
        if (val > 1000) { result.installationCost = val; break; }
      }
    }
  }

  return result;
}

function parseBomRows(rows: string[][]): Partial<CostingData> {
  const result: Partial<CostingData> = {};

  for (const row of rows) {
    if (!row || row.length < 3) continue;
    const joined = row.join(' ').toLowerCase();

    // Panel line — look for "solar pv module" or "panel"
    if ((joined.includes('solar pv module') || joined.includes('solar panel')) && !result.panelBrand) {
      // Typically: description | unit | qty | rate | amount
      for (let i = 0; i < row.length; i++) {
        const cell = String(row[i]).trim();
        // Look for wattage pattern like "550Wp" or "545 Wp"
        const wpMatch = cell.match(/(\d+)\s*[Ww][Pp]?/);
        if (wpMatch) result.panelWattage = parseInt(wpMatch[1], 10);
        // Look for quantity (small positive integer for panel count)
        const num = parseInt(cell);
        if (num > 0 && num < 500 && !result.panelCount && i > 1) result.panelCount = num;
      }
    }

    // Inverter line
    if (joined.includes('inverter') && !result.inverterBrand) {
      for (const cell of row) {
        const kwMatch = String(cell).match(/(\d+\.?\d*)\s*[Kk][Ww]/);
        if (kwMatch) result.inverterCapacityKw = parseFloat(kwMatch[1]);
      }
      // Brand is usually in the description cell
      const desc = String(row[1] || row[0]).trim();
      const brandMatch = desc.match(/(Deye|Sungrow|Growatt|Havells|Solplanet|Goodwe|Delta|Fronius|SMA|Huawei|Waaree|Tata|Adani|Vikram)/i);
      if (brandMatch) result.inverterBrand = brandMatch[1];
    }

    // Panel brand from description
    if ((joined.includes('panel') || joined.includes('module')) && !result.panelBrand) {
      const desc = String(row[1] || row[0]).trim();
      const brandMatch = desc.match(/(Waaree|Tata|Adani|Vikram|Canadian|Jinko|LONGi|JA Solar|Risen|UTL|Contendre|Emmvee)/i);
      if (brandMatch) result.panelBrand = brandMatch[1];
    }
  }

  return result;
}

async function readGoogleSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<CostingData | null> {
  const op = '[readGoogleSheet]';
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabNames = meta.data.sheets?.map(s => s.properties?.title || '') || [];

    let costing: Partial<CostingData> = {};

    // Read costing tab
    const costingTab = findCostingTab(tabNames);
    if (costingTab) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${costingTab}'!A1:L30`,
      });
      costing = { ...costing, ...parseCostingRows(res.data.values || []) };
    }

    // Read BOM tab
    const bomTab = findBomTab(tabNames);
    if (bomTab) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bomTab}'!A1:L50`,
      });
      costing = { ...costing, ...parseBomRows(res.data.values || []) };
    }

    // If no costing or BOM tab found, try reading first non-utility tab
    if (!costingTab && !bomTab && tabNames.length > 0) {
      const firstTab = tabNames[0];
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${firstTab}'!A1:L30`,
      });
      const rows = res.data.values || [];
      costing = { ...costing, ...parseCostingRows(rows), ...parseBomRows(rows) };
    }

    // Only return if we got something meaningful
    if (!costing.systemSizeKwp && !costing.totalCost && !costing.panelBrand) return null;

    return {
      systemSizeKwp: costing.systemSizeKwp || 0,
      totalCost: costing.totalCost || 0,
      costPerWatt: costing.costPerWatt || 0,
      supplyCost: costing.supplyCost || 0,
      installationCost: costing.installationCost || 0,
      panelBrand: costing.panelBrand || '',
      panelModel: costing.panelModel || '',
      panelWattage: costing.panelWattage || 0,
      panelCount: costing.panelCount || 0,
      inverterBrand: costing.inverterBrand || '',
      inverterModel: costing.inverterModel || '',
      inverterCapacityKw: costing.inverterCapacityKw || 0,
    };
  } catch (err) {
    console.warn(`${op} Error reading sheet ${spreadsheetId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function readXlsxFromDrive(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<CostingData | null> {
  const op = '[readXlsxFromDrive]';
  try {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    const workbook = XLSX.read(Buffer.from(res.data as ArrayBuffer), { type: 'buffer' });
    const tabNames = workbook.SheetNames;

    let costing: Partial<CostingData> = {};

    const costingTab = findCostingTab(tabNames);
    if (costingTab) {
      const sheet = workbook.Sheets[costingTab];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      costing = { ...costing, ...parseCostingRows(rows) };
    }

    const bomTab = findBomTab(tabNames);
    if (bomTab) {
      const sheet = workbook.Sheets[bomTab];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      costing = { ...costing, ...parseBomRows(rows) };
    }

    if (!costingTab && !bomTab && tabNames.length > 0) {
      const sheet = workbook.Sheets[tabNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      costing = { ...costing, ...parseCostingRows(rows), ...parseBomRows(rows) };
    }

    if (!costing.systemSizeKwp && !costing.totalCost && !costing.panelBrand) return null;

    return {
      systemSizeKwp: costing.systemSizeKwp || 0,
      totalCost: costing.totalCost || 0,
      costPerWatt: costing.costPerWatt || 0,
      supplyCost: costing.supplyCost || 0,
      installationCost: costing.installationCost || 0,
      panelBrand: costing.panelBrand || '',
      panelModel: costing.panelModel || '',
      panelWattage: costing.panelWattage || 0,
      panelCount: costing.panelCount || 0,
      inverterBrand: costing.inverterBrand || '',
      inverterModel: costing.inverterModel || '',
      inverterCapacityKw: costing.inverterCapacityKw || 0,
    };
  } catch (err) {
    console.warn(`${op} Error reading xlsx ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
```

- [ ] **Step 2: Add folder enrichment function that reads spreadsheets**

```typescript
async function enrichFolders(
  drive: drive_v3.Drive,
  sheets: sheets_v4.Sheets,
  folders: ParsedFolder[],
  stats: MigrationStats,
): Promise<FolderData[]> {
  const op = '[enrichFolders]';
  const results: FolderData[] = [];

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    if ((i + 1) % 50 === 0) console.log(`${op} Progress: ${i + 1}/${folders.length}`);

    stats.foldersScanned++;

    // List files in the folder (with timeout)
    let files: Array<{ id: string; name: string; mimeType: string }> = [];
    try {
      files = await Promise.race([
        listFolderContents(drive, folder.folderId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
    } catch {
      console.warn(`${op} Timeout listing "${folder.folderName}", skipping sheet read`);
    }

    // Find a spreadsheet
    const googleSheet = files.find(f => f.mimeType === 'application/vnd.google-apps.spreadsheet');
    const xlsxFile = files.find(f =>
      f.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      (f.name.toLowerCase().includes('costing') || f.name.toLowerCase().includes('bom') || f.name.toLowerCase().includes('cost'))
    );
    // Fallback: any xlsx if no costing-named one
    const anyXlsx = xlsxFile || files.find(f =>
      f.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    let costing: CostingData | null = null;
    let spreadsheetId: string | null = null;
    let spreadsheetType: 'google_sheet' | 'xlsx' | null = null;

    if (googleSheet) {
      spreadsheetId = googleSheet.id;
      spreadsheetType = 'google_sheet';
      costing = await readGoogleSheet(sheets, googleSheet.id);
      stats.foldersWithSheet++;
    } else if (anyXlsx) {
      spreadsheetId = anyXlsx.id;
      spreadsheetType = 'xlsx';
      costing = await readXlsxFromDrive(drive, anyXlsx.id);
      stats.foldersWithSheet++;
    } else {
      stats.foldersEmpty++;
    }

    results.push({
      ...folder,
      hasSpreadsheet: !!spreadsheetId,
      spreadsheetId,
      spreadsheetType,
      costing,
    });
  }

  return results;
}
```

- [ ] **Step 3: Wire Phase 2 into main()**

Add after Phase 1 in `main()`:

```typescript
  // Phase 2: Read spreadsheets
  console.log('[Phase 2] Reading costing spreadsheets...');
  const stats: MigrationStats = {
    foldersScanned: 0, foldersWithSheet: 0, foldersEmpty: 0,
    matched: 0, matchedByPv: 0, matchedByName: 0,
    newLeadsCreated: 0, proposalsUpdated: 0, proposalsCreated: 0,
    projectsUpdated: 0, skippedAlreadyMigrated: 0, errors: [],
  };
  const enrichedFolders = await enrichFolders(drive, sheets, folders, stats);
  const withCosting = enrichedFolders.filter(f => f.costing);
  console.log(`  Spreadsheets read: ${stats.foldersWithSheet}`);
  console.log(`  With costing data: ${withCosting.length}`);
  console.log(`  No spreadsheet: ${stats.foldersEmpty}\n`);
```

- [ ] **Step 4: Test with dry-run on 2022**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Expected: scan 312 folders, read spreadsheets, show costing stats.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-drive-proposals.ts
git commit -m "feat: spreadsheet reading — costing + BOM extraction from Google Sheets and xlsx"
```

---

### Task 4: Matching engine — link Drive folders to existing DB leads

**Files:**
- Modify: `scripts/migrate-drive-proposals.ts`

- [ ] **Step 1: Add name matching functions**

```typescript
// ─── Name Matching ────────────────────────────────────────────────────────────

function normalizeCustomerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?|m\/s\.?)\s*/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function namesMatch(a: string, b: string): { matches: boolean; method: string } {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (!na || !nb) return { matches: false, method: 'empty' };
  if (na === nb) return { matches: true, method: 'exact' };

  // Part matching (split on " - ", "/", "_")
  const partsA = na.split(/\s*[-\/]\s*/).filter(p => p.length > 3);
  const partsB = nb.split(/\s*[-\/]\s*/).filter(p => p.length > 3);

  for (const pa of partsA) {
    for (const pb of partsB) {
      if (pa === pb) return { matches: true, method: 'part_exact' };
      if (pa.length > 4 && pb.length > 4 && (pa.includes(pb) || pb.includes(pa))) {
        return { matches: true, method: 'part_substring' };
      }
    }
  }

  // Substring on full name (only if >6 chars to avoid false positives)
  if (na.length > 6 && nb.length > 6 && (na.includes(nb) || nb.includes(na))) {
    return { matches: true, method: 'substring' };
  }

  // Levenshtein (short names only)
  if (na.length <= 30 && nb.length <= 30) {
    const dist = levenshtein(na, nb);
    if (dist <= Math.ceil(Math.max(na.length, nb.length) * 0.15)) {
      return { matches: true, method: 'levenshtein' };
    }
  }

  return { matches: false, method: 'none' };
}
```

- [ ] **Step 2: Add DB loading and matching function**

```typescript
// ─── DB Loading ───────────────────────────────────────────────────────────────

interface DbLead {
  id: string;
  customer_name: string;
  notes: string | null;
  status: string;
  estimated_size_kwp: number | null;
}

interface DbProposal {
  id: string;
  lead_id: string;
  proposal_number: string;
  system_size_kwp: number | null;
  notes: string | null;
  total_before_discount: number | null;
}

interface DbProject {
  id: string;
  lead_id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number | null;
  contracted_value: number | null;
  panel_brand: string | null;
  inverter_brand: string | null;
  notes: string | null;
}

async function loadDbState(): Promise<{
  leads: DbLead[];
  proposals: DbProposal[];
  projects: DbProject[];
}> {
  const op = '[loadDbState]';

  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name, notes, status, estimated_size_kwp')
    .order('customer_name');

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, lead_id, proposal_number, system_size_kwp, notes, total_before_discount')
    .order('proposal_number');

  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, project_number, customer_name, system_size_kwp, contracted_value, panel_brand, inverter_brand, notes')
    .order('project_number');

  console.log(`${op} Loaded: ${leads?.length ?? 0} leads, ${proposals?.length ?? 0} proposals, ${projects?.length ?? 0} projects`);

  return {
    leads: leads || [],
    proposals: proposals || [],
    projects: projects || [],
  };
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function matchFolder(
  folder: FolderData,
  leads: DbLead[],
  proposals: DbProposal[],
  projects: DbProject[],
): MatchResult {
  // Tier 1: PV number match
  if (folder.pvNumber) {
    const pvStr = `PV${folder.pvNumber}`;

    // Search in lead notes
    for (const lead of leads) {
      if (lead.notes && lead.notes.includes(pvStr)) {
        const proposal = proposals.find(p => p.lead_id === lead.id);
        const project = projects.find(p => p.lead_id === lead.id);
        return {
          matchType: 'pv_number',
          leadId: lead.id,
          proposalId: proposal?.id || null,
          projectId: project?.id || null,
          customerName: lead.customer_name,
        };
      }
    }

    // Search in proposal notes
    for (const proposal of proposals) {
      if (proposal.notes && proposal.notes.includes(pvStr)) {
        const lead = leads.find(l => l.id === proposal.lead_id);
        const project = projects.find(p => p.lead_id === proposal.lead_id);
        return {
          matchType: 'pv_number',
          leadId: proposal.lead_id,
          proposalId: proposal.id,
          projectId: project?.id || null,
          customerName: lead?.customer_name || null,
        };
      }
    }
  }

  // Tier 2 + 3: Name matching
  for (const lead of leads) {
    const result = namesMatch(folder.customerName, lead.customer_name);
    if (result.matches) {
      const proposal = proposals.find(p => p.lead_id === lead.id);
      const project = projects.find(p => p.lead_id === lead.id);
      const matchType = result.method === 'exact' || result.method === 'part_exact'
        ? 'name_exact' as const
        : 'name_fuzzy' as const;
      return {
        matchType,
        leadId: lead.id,
        proposalId: proposal?.id || null,
        projectId: project?.id || null,
        customerName: lead.customer_name,
      };
    }
  }

  // Also check project customer_name (some projects have different names than their leads)
  for (const project of projects) {
    const result = namesMatch(folder.customerName, project.customer_name);
    if (result.matches) {
      const lead = leads.find(l => l.id === project.lead_id);
      const proposal = proposals.find(p => p.lead_id === project.lead_id);
      return {
        matchType: result.method === 'exact' || result.method === 'part_exact'
          ? 'name_exact' as const
          : 'name_fuzzy' as const,
        leadId: project.lead_id,
        proposalId: proposal?.id || null,
        projectId: project.id,
        customerName: project.customer_name,
      };
    }
  }

  return { matchType: 'none', leadId: null, proposalId: null, projectId: null, customerName: null };
}
```

- [ ] **Step 3: Wire Phase 3 into main()**

```typescript
  // Phase 3: Match to DB
  console.log('[Phase 3] Loading DB state and matching...');
  const db = await loadDbState();

  const matchResults: Array<{ folder: FolderData; match: MatchResult }> = [];
  for (const folder of enrichedFolders) {
    // Idempotency check: skip if this folder URL is already in any lead's notes
    const alreadyMigrated = db.leads.some(l => l.notes?.includes(folder.folderId));
    if (alreadyMigrated) {
      stats.skippedAlreadyMigrated++;
      continue;
    }

    const match = matchFolder(folder, db.leads, db.proposals, db.projects);
    matchResults.push({ folder, match });

    if (match.matchType !== 'none') stats.matched++;
    if (match.matchType === 'pv_number') stats.matchedByPv++;
    if (match.matchType === 'name_exact' || match.matchType === 'name_fuzzy') stats.matchedByName++;
  }

  console.log(`  Already migrated (skip): ${stats.skippedAlreadyMigrated}`);
  console.log(`  Matched: ${stats.matched} (PV: ${stats.matchedByPv}, Name: ${stats.matchedByName})`);
  console.log(`  Unmatched (will create new): ${matchResults.filter(r => r.match.matchType === 'none').length}\n`);
```

- [ ] **Step 4: Test matching with dry-run**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Expected: shows match stats — how many matched by PV, by name, and how many unmatched.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-drive-proposals.ts
git commit -m "feat: multi-tier matching engine — PV number + name matching to existing leads"
```

---

### Task 5: Sync engine — update existing records and create new leads

**Files:**
- Modify: `scripts/migrate-drive-proposals.ts`

- [ ] **Step 1: Add the sync function**

```typescript
// ─── Sync ─────────────────────────────────────────────────────────────────────

function getFinancialYear(date: Date): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month >= 3) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

async function getNextNumber(
  table: string,
  column: string,
  prefix: string,
  fy: string,
): Promise<{ current: number; generate: () => string }> {
  const { data } = await supabase
    .from(table)
    .select(column)
    .like(column, `${prefix}/${fy}/%`)
    .order(column, { ascending: false })
    .limit(1);

  let max = 0;
  if (data && data.length > 0) {
    const val = (data[0] as Record<string, string>)[column];
    const match = val.match(/\/(\d+)$/);
    if (match) max = parseInt(match[1], 10);
  }

  return {
    current: max,
    generate: () => {
      max++;
      return `${prefix}/${fy}/${String(max).padStart(4, '0')}`;
    },
  };
}

async function syncToDatabase(
  matchResults: Array<{ folder: FolderData; match: MatchResult }>,
  stats: MigrationStats,
): Promise<string[][]> {
  const op = '[syncToDatabase]';
  const auditRows: string[][] = [
    ['folder_name', 'pv_number', 'customer_name', 'match_type', 'matched_to', 'action', 'system_size', 'total_cost', 'drive_url'],
  ];

  // Get a system employee for prepared_by
  const { data: employees } = await supabase
    .from('employees')
    .select('id')
    .eq('is_active', true)
    .limit(1);
  const systemEmployeeId = employees?.[0]?.id;
  if (!systemEmployeeId) {
    console.error(`${op} No active employees found`);
    return auditRows;
  }

  // Prepare number generators for the FY
  const fy = yearConfig.fy;
  const propGen = await getNextNumber('proposals', 'proposal_number', 'SHIROI/PROP', fy);

  for (const { folder, match } of matchResults) {
    const pvStr = folder.pvNumber ? `PV${folder.pvNumber}/${folder.pvFy || ''}` : '';
    const driveNote = `[Drive] ${folder.driveUrl}${pvStr ? ` | ${pvStr}` : ''}`;

    if (match.matchType !== 'none' && match.leadId) {
      // ── MATCHED: Update existing records ──
      const action: string[] = [];

      // Update lead notes (append Drive URL)
      if (!isDryRun) {
        const { data: currentLead } = await supabase
          .from('leads')
          .select('notes, estimated_size_kwp')
          .eq('id', match.leadId)
          .single();

        const existingNotes = currentLead?.notes || '';
        if (!existingNotes.includes(folder.folderId)) {
          const newNotes = existingNotes ? `${existingNotes}\n${driveNote}` : driveNote;
          const updates: Record<string, unknown> = { notes: newNotes };

          // Update size if we have better data
          if (folder.costing?.systemSizeKwp && (!currentLead?.estimated_size_kwp || currentLead.estimated_size_kwp === 0)) {
            updates.estimated_size_kwp = folder.costing.systemSizeKwp;
          }

          await supabase.from('leads').update(updates).eq('id', match.leadId);
          action.push('lead_updated');
        }
      }

      // Update proposal if we have costing data
      if (match.proposalId && folder.costing) {
        if (!isDryRun) {
          const { data: currentProp } = await supabase
            .from('proposals')
            .select('total_before_discount, system_size_kwp, panel_brand, notes')
            .eq('id', match.proposalId)
            .single();

          const propUpdates: Record<string, unknown> = {};
          const c = folder.costing;

          if (c.systemSizeKwp && (!currentProp?.system_size_kwp || currentProp.system_size_kwp === 0)) {
            propUpdates.system_size_kwp = c.systemSizeKwp;
          }
          if (c.totalCost && (!currentProp?.total_before_discount || currentProp.total_before_discount === 0)) {
            propUpdates.total_before_discount = c.totalCost;
            propUpdates.total_after_discount = c.totalCost;
          }
          if (c.supplyCost) propUpdates.subtotal_supply = c.supplyCost;
          if (c.installationCost) propUpdates.subtotal_works = c.installationCost;
          if (c.panelBrand && !currentProp?.panel_brand) propUpdates.panel_brand = c.panelBrand;
          if (c.panelWattage) propUpdates.panel_wattage = c.panelWattage;
          if (c.panelCount) propUpdates.panel_count = c.panelCount;
          if (c.inverterBrand) propUpdates.inverter_brand = c.inverterBrand;
          if (c.inverterCapacityKw) propUpdates.inverter_capacity_kw = c.inverterCapacityKw;

          // Append Drive URL to proposal notes
          const propNotes = currentProp?.notes || '';
          if (!propNotes.includes(folder.folderId)) {
            propUpdates.notes = propNotes ? `${propNotes}\n${driveNote}` : driveNote;
          }

          if (Object.keys(propUpdates).length > 0) {
            await supabase.from('proposals').update(propUpdates).eq('id', match.proposalId);
            stats.proposalsUpdated++;
            action.push('proposal_updated');
          }
        } else {
          action.push('would_update_proposal');
        }
      }

      // Update project if it exists and we have costing data
      if (match.projectId && folder.costing) {
        if (!isDryRun) {
          const { data: currentProj } = await supabase
            .from('projects')
            .select('system_size_kwp, contracted_value, panel_brand, inverter_brand')
            .eq('id', match.projectId)
            .single();

          const projUpdates: Record<string, unknown> = {};
          const c = folder.costing;

          if (c.systemSizeKwp && (!currentProj?.system_size_kwp || currentProj.system_size_kwp <= 1)) {
            projUpdates.system_size_kwp = c.systemSizeKwp;
          }
          if (c.totalCost && (!currentProj?.contracted_value || currentProj.contracted_value === 0)) {
            projUpdates.contracted_value = c.totalCost;
          }
          if (c.panelBrand && !currentProj?.panel_brand) projUpdates.panel_brand = c.panelBrand;
          if (c.inverterBrand && !currentProj?.inverter_brand) projUpdates.inverter_brand = c.inverterBrand;

          if (Object.keys(projUpdates).length > 0) {
            await supabase.from('projects').update(projUpdates).eq('id', match.projectId);
            stats.projectsUpdated++;
            action.push('project_updated');
          }
        } else {
          action.push('would_update_project');
        }
      }

      auditRows.push([
        folder.folderName, pvStr, folder.customerName,
        match.matchType, match.customerName || '',
        action.join('+') || 'no_update_needed',
        String(folder.costing?.systemSizeKwp || ''),
        String(folder.costing?.totalCost || ''),
        folder.driveUrl,
      ]);

    } else {
      // ── UNMATCHED: Create new lead + proposal ──
      if (isDryRun) {
        auditRows.push([
          folder.folderName, pvStr, folder.customerName,
          'none', '', 'would_create_new',
          String(folder.costing?.systemSizeKwp || ''),
          String(folder.costing?.totalCost || ''),
          folder.driveUrl,
        ]);
        continue;
      }

      const sizeKwp = folder.costing?.systemSizeKwp || 0;
      const segment = sizeKwp > 15 ? 'commercial' : 'residential';
      const phoneRand = String(Date.now()).slice(-6);
      const placeholderPhone = `8888${phoneRand}${String(Math.floor(Math.random() * 9000) + 1000)}`;

      // Create lead
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          customer_name: folder.customerName,
          phone: placeholderPhone,
          city: 'Chennai',
          state: 'Tamil Nadu',
          source: 'referral',
          segment,
          system_type: 'on_grid',
          estimated_size_kwp: sizeKwp || null,
          status: 'proposal_sent',
          notes: driveNote,
        })
        .select('id')
        .single();

      if (leadErr) {
        console.error(`${op} Lead create failed for "${folder.customerName}": ${leadErr.message}`);
        stats.errors.push(`Lead "${folder.customerName}": ${leadErr.message}`);
        auditRows.push([
          folder.folderName, pvStr, folder.customerName,
          'none', '', `error: ${leadErr.message}`, '', '', folder.driveUrl,
        ]);
        continue;
      }

      stats.newLeadsCreated++;

      // Create proposal
      const propNumber = propGen.generate();
      const propInsert: Record<string, unknown> = {
        lead_id: newLead.id,
        proposal_number: propNumber,
        prepared_by: systemEmployeeId,
        system_size_kwp: sizeKwp || 1,
        system_type: 'on_grid',
        status: 'sent',
        valid_until: '2027-12-31',
        notes: driveNote,
      };

      if (folder.costing) {
        const c = folder.costing;
        if (c.totalCost) {
          propInsert.total_before_discount = c.totalCost;
          propInsert.total_after_discount = c.totalCost;
        }
        if (c.supplyCost) propInsert.subtotal_supply = c.supplyCost;
        if (c.installationCost) propInsert.subtotal_works = c.installationCost;
        if (c.panelBrand) propInsert.panel_brand = c.panelBrand;
        if (c.panelWattage) propInsert.panel_wattage = c.panelWattage;
        if (c.panelCount) propInsert.panel_count = c.panelCount;
        if (c.inverterBrand) propInsert.inverter_brand = c.inverterBrand;
        if (c.inverterCapacityKw) propInsert.inverter_capacity_kw = c.inverterCapacityKw;
      }

      const { error: propErr } = await supabase.from('proposals').insert(propInsert);
      if (propErr) {
        console.error(`${op} Proposal create failed for "${folder.customerName}": ${propErr.message}`);
        stats.errors.push(`Proposal "${folder.customerName}": ${propErr.message}`);
      } else {
        stats.proposalsCreated++;
      }

      auditRows.push([
        folder.folderName, pvStr, folder.customerName,
        'none', '', 'created_new',
        String(sizeKwp || ''),
        String(folder.costing?.totalCost || ''),
        folder.driveUrl,
      ]);
    }
  }

  return auditRows;
}
```

- [ ] **Step 2: Wire Phase 4 + 5 (sync + report) into main()**

```typescript
  // Phase 4: Sync to database
  console.log(`[Phase 4] Syncing to database${isDryRun ? ' (DRY RUN)' : ''}...`);
  const auditRows = await syncToDatabase(matchResults, stats);

  // Phase 5: Report
  const auditPath = resolve(__dirname, `data/drive-proposals-${yearArg}-audit.csv`);
  const csvContent = auditRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  writeFileSync(auditPath, csvContent);

  // Final DB counts
  const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
  const { count: totalProposals } = await supabase.from('proposals').select('*', { count: 'exact', head: true });
  const { count: totalProjects } = await supabase.from('projects').select('*', { count: 'exact', head: true });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Migration Summary — ${yearArg}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Folders scanned:       ${stats.foldersScanned}`);
  console.log(`  With spreadsheet:      ${stats.foldersWithSheet}`);
  console.log(`  No spreadsheet:        ${stats.foldersEmpty}`);
  console.log(`  Already migrated:      ${stats.skippedAlreadyMigrated}`);
  console.log(`  Matched to existing:   ${stats.matched} (PV: ${stats.matchedByPv}, Name: ${stats.matchedByName})`);
  console.log(`  New leads created:     ${stats.newLeadsCreated}`);
  console.log(`  Proposals updated:     ${stats.proposalsUpdated}`);
  console.log(`  Proposals created:     ${stats.proposalsCreated}`);
  console.log(`  Projects updated:      ${stats.projectsUpdated}`);
  console.log(`  Errors:                ${stats.errors.length}`);
  console.log(`  `);
  console.log(`  DB totals: leads=${totalLeads}, proposals=${totalProposals}, projects=${totalProjects}`);
  console.log(`  Audit report: ${auditPath}`);
  if (stats.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const err of stats.errors.slice(0, 20)) console.log(`    - ${err}`);
    if (stats.errors.length > 20) console.log(`    ... and ${stats.errors.length - 20} more`);
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
```

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-drive-proposals.ts
git commit -m "feat: sync engine — update existing records + create new leads from Drive folders"
```

---

### Task 6: Dry-run year 2022 → review → live run

**Files:**
- No file changes — execution only

- [ ] **Step 1: Dry-run 2022**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Review the output: folder count, match stats, audit CSV. Check for false matches.

- [ ] **Step 2: Review audit CSV**

```bash
head -20 scripts/data/drive-proposals-2022-audit.csv
```

Check: are the matches reasonable? Any obvious false positives?

- [ ] **Step 3: Live run 2022**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022
```

- [ ] **Step 4: Verify idempotency — re-run should skip all**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
```

Expected: all folders show "Already migrated (skip)".

---

### Task 7: Run remaining years — 2023, 2024-25, 2025-26

- [ ] **Step 1: Dry-run + live run 2023**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2023 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2023
```

- [ ] **Step 2: Dry-run + live run 2024-25**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2024-25 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2024-25
```

- [ ] **Step 3: Dry-run + live run 2025-26**

```bash
npx tsx scripts/migrate-drive-proposals.ts --year 2025-26 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2025-26
```

- [ ] **Step 4: Final verification — total DB counts**

Run a quick check:
```bash
npx tsx -e "..." # (inline script to query total counts)
```

Expected: leads significantly increased from 1,115, proposals increased, projects unchanged at 314.

---

### Task 8: Update CLAUDE.md and master reference

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

- [ ] **Step 1: Update CLAUDE.md**

Update CURRENT STATE table:
- Google Drive migration → ✅ Complete with stats
- Data migration → mark Drive folders as done

- [ ] **Step 2: Update master reference**

Update Section 11 (Data Migration) with Drive migration results.

- [ ] **Step 3: Commit all**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md
git commit -m "docs: update CLAUDE.md + master reference with Drive migration results"
```
