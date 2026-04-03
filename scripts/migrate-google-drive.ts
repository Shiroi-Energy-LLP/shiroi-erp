/**
 * Google Drive → Shiroi ERP Migration Script
 *
 * Migrates all project data from Google Drive (179 project folders + master sheet)
 * into the Supabase ERP database.
 *
 * Data migrated:
 *   - Projects (from Google Sheets "Project details" tab + master sheet)
 *   - Vendors (deduplicated from "Bill of items" tabs)
 *   - Purchase Orders + Line Items (from "Bill of items" tabs)
 *   - Site Expenses (from "Expenses" tabs)
 *   - Files: PDFs + photos → Supabase Storage
 *
 * Usage:
 *   npx tsx scripts/migrate-google-drive.ts --dry-run    # MANDATORY first
 *   npx tsx scripts/migrate-google-drive.ts               # Live run
 *
 * Prerequisites:
 *   - Service account key at C:\Users\vivek\Downloads\shiroi-migration-key.json
 *   - Drive folder shared with service account
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
 *   - Master file at C:\Users\vivek\Downloads\shiroienergy.xlsx
 */

import { google, sheets_v4, drive_v3 } from 'googleapis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { isDryRun, logMigrationStart, logMigrationEnd, normalizePhone } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ─── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const ROOT_FOLDER_ID = '1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D';
const FOLDER_2024_ID = '1O1pWXIuFrziYQBDKzFke6wtMK9jiv3zV';
const FOLDER_2025_ID = '1P7zYzfnos539MchVIcg_KRsorxO97XWs';

// ─── Vendor Name Cleanup Map ───────────────────────────────────────────────────
// Maps misspellings and variations to a single canonical vendor name.
// Built from the 192 raw vendor names found in the dry run.

const VENDOR_CANONICAL_MAP: Record<string, string> = {
  // Krishna Electricals variants
  'krishna electricals': 'Krishna Electricals',
  'krishna elelctricals': 'Krishna Electricals',
  'krsihna electricals': 'Krishna Electricals',
  'krishana electricals': 'Krishna Electricals',
  'krishna electrical': 'Krishna Electricals',
  'krishna elect': 'Krishna Electricals',
  'krishna elec': 'Krishna Electricals',
  'krsihna elec': 'Krishna Electricals',
  'krishan elec': 'Krishna Electricals',
  'krsihna electrical': 'Krishna Electricals',
  'krishna': 'Krishna Electricals',

  // Green Field variants
  'green field': 'Green Field',
  'green feild': 'Green Field',
  'geen field': 'Green Field',
  'green field / stock': 'Green Field',
  'green': 'Green Field',

  // Deekay variants
  'deekay': 'Deekay Electricals',
  'deekay electricals': 'Deekay Electricals',
  'deekay elelctricals': 'Deekay Electricals',
  'deekey': 'Deekay Electricals',

  // Shankheswar / Shankeswar variants
  'shankheswar': 'Shankheswar Electricals',
  'shankeswar': 'Shankheswar Electricals',
  'shankleswar': 'Shankheswar Electricals',
  'shakeswar': 'Shankheswar Electricals',
  'shankheshwar': 'Shankheswar Electricals',
  'shankeswar electricals': 'Shankheswar Electricals',
  'shankeswar electrical': 'Shankheswar Electricals',
  'shakeswar electrical': 'Shankheswar Electricals',
  'shankheswar electricals': 'Shankheswar Electricals',

  // KL variants
  'kl': 'KL Earthing',
  'kl earthing': 'KL Earthing',
  'kl earthinh': 'KL Earthing',
  'kl / stock': 'KL Earthing',

  // Raju variants
  'raju': 'Raju Electricals',
  'raju electricals': 'Raju Electricals',
  'raju electrical': 'Raju Electricals',

  // Namo Solar variants
  'namo': 'Namo Solar',
  'namo solar': 'Namo Solar',
  'namo solar / stock': 'Namo Solar',
  'namosolar': 'Namo Solar',

  // Festa Solar variants
  'festa solar': 'Festa Solar',
  'festa': 'Festa Solar',
  'fest solar': 'Festa Solar',
  'feston': 'Festa Solar',

  // Dhanalakshmi variants
  'dhanalakshmi': 'Dhanalakshmi',
  'dhanalakshimi': 'Dhanalakshmi',
  'dhana lakshmi': 'Dhanalakshmi',
  'dhnalakshmi enter prises': 'Dhanalakshmi',

  // Sri Hari Enterprises variants
  'sri hari enterprises': 'Sri Hari Enterprises',
  'si hari enterprises': 'Sri Hari Enterprises',
  'shr hari': 'Sri Hari Enterprises',
  'sri hari steels': 'Sri Hari Enterprises',

  // Burhani variants
  'burhani': 'Burhani Hardware',
  'buhin': 'Burhani Hardware',
  'bhurhai': 'Burhani Hardware',
  'burhani hardware': 'Burhani Hardware',

  // Mahaveer variants
  'mahaveer': 'Mahaveer Electricals',
  'mahaveer electricals': 'Mahaveer Electricals',
  'mahaaveer': 'Mahaveer Electricals',
  'mahveer electricals': 'Mahaveer Electricals',

  // Meenakshi variants
  'meenakshi': 'Meenakshi Electricals',
  'meenakshi electricals': 'Meenakshi Electricals',
  'sri meenakshi elelctricals': 'Meenakshi Electricals',

  // Mamtha/Mamta variants
  'mamtha elecctricals': 'Mamta Electricals',
  'mamta electricals': 'Mamta Electricals',

  // Esaar/Essar variants
  'esaar': 'Esaar Power Controls',
  'essar': 'Esaar Power Controls',
  'esaar power controls': 'Esaar Power Controls',

  // Southern Power variants
  'southern power': 'Southern Power',
  'southern': 'Southern Power',
  'sothernpower': 'Southern Power',

  // Eco Power variants
  'eco power': 'Eco Power House',
  'eco power house': 'Eco Power House',

  // Creative Eco variants
  'creative eco solutions': 'Creative Eco Solutions',
  'creative eco': 'Creative Eco Solutions',

  // Enpossibility variants
  'enpossibility': 'Enpossibility',
  'en possibility': 'Enpossibility',

  // Sunlit variants
  'sunlit': 'Sunlit Future',
  'sunlit future': 'Sunlit Future',
  'sunlite': 'Sunlit Future',

  // Hive Solar variants
  'hive solar': 'Hive Solar',
  'hivesolar': 'Hive Solar',

  // 3S variants
  '3s': '3S Solutions',
  '3s solutions': '3S Solutions',

  // Thanigai variants
  'thanigai': 'Thanigai Agencies',
  'thanigai agencies': 'Thanigai Agencies',
  'banu thanigai': 'Thanigai Agencies',

  // Lourduraj variants
  'mr lourduraj': 'Lourduraj',
  'lourduraj': 'Lourduraj',

  // Rajesh Welder variants
  'rajesh welder': 'Rajesh Welder',
  'mr rajesh welder': 'Rajesh Welder',
  'mr rajesh contractor': 'Rajesh Welder',
  'rajesh': 'Rajesh Welder',
  'mr rajesh': 'Rajesh Welder',

  // Jeevan variants
  'jeevan': 'Jeevan Electricals',
  'jeevan electricals': 'Jeevan Electricals',

  // Inspire variants
  'inspire': 'Inspire Energy',
  'inspire energy': 'Inspire Energy',

  // Nextgen variants
  'nextgen': 'Nextgen',
  'next gen': 'Nextgen',
  'g nexter': 'Nextgen',

  // Solstrom
  'solstrom': 'Solstrom',

  // Seeyon
  'seeyon': 'Seeyon',

  // Lune Tech / Gayathri Lune
  'lune tech': 'Lune Tech',
  'gayathri lune': 'Lune Tech',

  // Saradha Engineering
  'saradha engineering': 'Saradha Engineering',

  // Shree Aaditya
  'shree aaditya': 'Shree Aaditya',

  // JKR variants
  'jkr': 'JKR Engineering',
  'jkr engineering': 'JKR Engineering',
  'jk': 'JKR Engineering',

  // Switchgear
  'switchgear': 'Switchgear Spares India',
  'switchgear spared india': 'Switchgear Spares India',

  // CC Ramakrishnan
  'ms cc ramakrishnanan': 'CC Ramakrishnan',
  'cc ramakrishnan': 'CC Ramakrishnan',

  // Sri Krishna Electricals (separate from Krishna Electricals)
  'sri krishna electricals': 'Sri Krishna Electricals',

  // Stock entries — map to a pseudo-vendor
  'stock': '__STOCK__',
  'stcok': '__STOCK__',
  'stock from msm': '__STOCK__',

  // Sevvel
  'sevvel': 'Sevvel',

  // VRM
  'vrm': 'VRM',
  'vrk': 'VRM',

  // Vashi
  'vashi': 'Vashi',

  // Devotional Energy
  'devotional energy': 'Devotional Energy',
  'devotinal': 'Devotional Energy',

  // Electromart
  'electromart': 'Electromart',

  // Sunbridger
  'sunbridger': 'Sunbridger',

  // Kranich
  'kranich': 'Kranich',

  // Viridis
  'virdis': 'Viridis',
  'viridis': 'Viridis',

  // Pandian
  'pandian & co': 'Pandian & Co',

  // CMP Earth
  'cmp earth soltutioins': 'CMP Earth Solutions',

  // Minakshi Pipes
  'minakshi pipes & tubes': 'Minakshi Pipes & Tubes',

  // Alif Enterprises
  'alif enterprises': 'Alif Enterprises',

  // Matrix
  'matrix': 'Matrix',

  // Raj Sundar
  'raj sundar': 'Raj Sundar',

  // Balmar Solar
  'balmar solar': 'Balmar Solar',

  // Contendre
  'contendre': 'Contendre',

  // Sunjeyam
  'sunjeyam': 'Sunjeyam',

  // Gemini
  'gemini': 'Gemini',

  // Semicon
  'semicon': 'Semicon',

  // Ever Volt
  'ever volt': 'Ever Volt',

  // Visalam
  'visalam': 'Visalam',

  // Whole Solar
  'whole solar': 'Whole Solar',

  // Ornate
  'ornate agenscies': 'Ornate Agencies',

  // NFR
  'nfr': 'NFR',

  // NF Hardware
  'nf hardware': 'NF Hardware',

  // Myk
  'myk enterprises': 'MYK Enterprises',

  // Uno Power
  'uno power': 'Uno Power',

  // Saravana Electricals
  'saravana electricals': 'Saravana Electricals',

  // Sri Mothi
  'sri mothi electricals': 'Sri Mothi Electricals',

  // Shree Mahalakshmi
  'shree mahalakshmi': 'Shree Mahalakshmi',

  // Global Mobile
  'global mobile': 'Global Mobile',

  // Sangam Fan House
  'sangam fan house': 'Sangam Fan House',

  // Sri Industrial
  'sri industrial spare': 'Sri Industrial Spares',
  'sri industrial steels': 'Sri Industrial Spares',

  // Aarav Fastenner
  'aarav fastenner': 'Aarav Fastener',

  // NN Trading / Sun Trading
  'nn trading': 'NN Trading',
  'sun trading': 'Sun Trading',

  // Others
  'chandrasekaran': 'Chandrasekaran',
  'chndrasekaran': 'Chandrasekaran',
  'patanwala': 'Patanwala',
  'tneb': 'TNEB',
  'tenb': 'TNEB',
  'tenb / mrt': 'TNEB',
  'ceig': 'CEIG',
  'client scope': '__CLIENT_SCOPE__',
};

function canonicalVendorName(rawName: string): string {
  const key = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  return VENDOR_CANONICAL_MAP[key] || rawName.trim();
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ProjectData {
  folderName: string;
  folderId: string;
  financialYear: '2024-25' | '2025-26';
  spreadsheetId: string | null;
  details: ProjectDetails | null;
  bomItems: BomItem[];
  expenses: ExpenseItem[];
  tasks: TaskItem[];
  files: DriveFile[];
}

interface ProjectDetails {
  projectName: string;
  systemSize: string;
  assignedTo: string;
  category: string;
  status: string;
  workOrder: string;
  location: string;
  inverterMake: string;
  contactName: string;
  contactPhone: string;
  startDate: string;
  endDate: string;
  budget: number;
  panelMake: string;
  commissioningDate: string;
  loginCredential: string;
  userName: string;
  password: string;
  budgetConsidered: number;
  actualBudget: number;
  consideredMargin: string;
  actualMargin: string;
  billOfItemsTotal: number;
  expensesTotal: number;
  consRatePerWp: number;
  actRatePerWp: number;
}

interface BomItem {
  category: string;
  item: string;
  make: string;
  qty: number;
  units: string;
  status: string;
  rate: number;
  amount: number;
  gstRate: number;
  totalAmount: number;
  vendor: string;
}

interface ExpenseItem {
  description: string;
  engineerName: string;
  date: string;
  voucherNo: string;
  amount: number;
}

interface TaskItem {
  taskName: string;
  assignedTo: string;
  assignedDate: string;
  status: string;
  remarks: string;
  doneBy: string;
  startDate: string;
  endDate: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface MigrationStats {
  projectsFolderScanned: number;
  sheetsRead: number;
  sheetsReadErrors: number;
  vendorsCreated: number;
  projectsCreated: number;
  projectsSkipped: number;
  posCreated: number;
  poItemsCreated: number;
  expensesCreated: number;
  filesUploaded: number;
  errors: string[];
}

// ─── Parsing Helpers ───────────────────────────────────────────────────────────

function parseINR(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/[₹,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parsePercent(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(value: string | undefined | null): string | null {
  if (!value || value === 'NaN' || value === '') return null;
  const str = String(value).trim();
  // Try parsing various date formats
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  return null;
}

function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parsePanelInfo(panelMake: string): { brand: string; model: string; wattage: number; count: number } {
  // Parse formats like "UTL/340Wp/12Nos", "Contendre/550Wp/6Nos"
  const parts = panelMake.split('/').map(p => p.trim());
  const brand = parts[0] || '';
  let wattage = 0;
  let count = 0;
  let model = '';

  for (const part of parts) {
    const wpMatch = part.match(/(\d+)\s*[Ww][Pp]?/);
    if (wpMatch) {
      wattage = parseInt(wpMatch[1], 10);
      model = part;
    }
    const nosMatch = part.match(/(\d+)\s*[Nn][Oo][Ss]?/);
    if (nosMatch) {
      count = parseInt(nosMatch[1], 10);
    }
  }

  return { brand, model, wattage, count };
}

function parseInverterInfo(inverterMake: string): { brand: string; model: string; capacityKw: number } {
  // Parse formats like "VFD drive / Delta", "Deye/3KW/single Phase"
  const parts = inverterMake.split('/').map(p => p.trim());
  const brand = parts.length > 1 ? parts[1] || parts[0] : parts[0] || '';
  let capacityKw = 0;
  let model = inverterMake;

  for (const part of parts) {
    const kwMatch = part.match(/(\d+\.?\d*)\s*[Kk][Ww]/);
    if (kwMatch) {
      capacityKw = parseFloat(kwMatch[1]);
    }
  }

  return { brand, model, capacityKw };
}

function parseSystemType(category: string): 'on_grid' | 'hybrid' | 'off_grid' {
  const lower = category.toLowerCase();
  if (lower.includes('hybrid')) return 'hybrid';
  if (lower.includes('off grid') || lower.includes('off-grid')) return 'off_grid';
  return 'on_grid'; // default
}

function mapProjectStatus(status: string): string {
  const lower = status.toLowerCase().trim();
  if (lower === 'completed') return 'completed';
  if (lower === 'on progress' || lower === 'in progress') return 'installation';
  if (lower === 'yet to start') return 'advance_received';
  if (lower.includes('waiting for net meter')) return 'net_metering_pending';
  if (lower.includes('holding')) return 'on_hold';
  if (lower.includes('meter client scope')) return 'completed';
  return 'completed'; // default for historical
}

function mapBomCategory(category: string): string {
  const lower = category.toLowerCase().trim();
  if (lower.includes('panel') || lower === 'panels') return 'panel';
  if (lower === 'inverter' || lower.includes('inverter')) return 'inverter';
  if (lower === 'mms' || lower.includes('structure')) return 'structure';
  if (lower.includes('dc') && lower.includes('acces')) return 'dc_cable';
  if (lower.includes('ac') && lower.includes('acces')) return 'ac_cable';
  if (lower.includes('earth')) return 'earthing';
  if (lower.includes('conduit')) return 'conduit';
  if (lower.includes('drive')) return 'inverter';
  if (lower.includes('miscellaneous') || lower.includes('misc')) return 'other';
  return 'other';
}

function mapVendorType(bomCategory: string): string {
  const map: Record<string, string> = {
    panel: 'panel_supplier',
    inverter: 'inverter_supplier',
    structure: 'structure_supplier',
    dc_cable: 'cable_supplier',
    ac_cable: 'cable_supplier',
    earthing: 'electrical_supplier',
    conduit: 'electrical_supplier',
    other: 'other',
  };
  return map[bomCategory] || 'other';
}

function mapUnit(unit: string): string {
  const lower = unit.toLowerCase().trim();
  if (lower === 'nos' || lower === 'no' || lower === 'numbers') return 'nos';
  if (lower === 'meter' || lower === 'meters' || lower === 'mtr') return 'meter';
  if (lower === 'set' || lower === 'sets') return 'nos';
  if (lower === 'kwp' || lower === 'kw') return 'kw';
  if (lower === 'lot' || lower === 'lumpsum') return 'lumpsum';
  if (lower === 'packet' || lower === 'pocket') return 'nos';
  return 'nos';
}

function generateProjectNumber(index: number, fy: string): string {
  return `SHIROI/PROJ/${fy}/${String(index).padStart(4, '0')}`;
}

function generatePONumber(index: number, fy: string): string {
  return `SHIROI/PO/${fy}/${String(index).padStart(4, '0')}`;
}

function generateVendorCode(index: number): string {
  return `VEN-${String(index).padStart(3, '0')}`;
}

// ─── Google API Setup ──────────────────────────────────────────────────────────

function getGoogleClients(): { drive: drive_v3.Drive; sheets: sheets_v4.Sheets } {
  const op = '[getGoogleClients]';
  const keyFile = JSON.parse(readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });

  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`${op} Google API clients initialized`);
  return { drive, sheets };
}

// ─── Phase 1: Scan & Extract ───────────────────────────────────────────────────

async function listAllFiles(drive: drive_v3.Drive, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      files.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: parseInt(f.size || '0', 10),
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

async function readSheetTab(sheets: sheets_v4.Sheets, spreadsheetId: string, tabName: string): Promise<string[][]> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:K100`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

function parseProjectDetails(rows: string[][]): ProjectDetails | null {
  if (rows.length < 10) return null;

  // Row indices (0-based): row[0]=header, row[1]=name, row[2]=size+contact, etc.
  const getCell = (row: number, col: number): string => {
    if (row >= rows.length) return '';
    if (col >= (rows[row]?.length || 0)) return '';
    return rows[row][col] || '';
  };

  return {
    projectName: getCell(1, 1),
    systemSize: getCell(2, 1),
    assignedTo: getCell(3, 1),
    category: getCell(4, 1),
    status: getCell(5, 1),
    workOrder: getCell(6, 1),
    location: getCell(7, 1),
    inverterMake: getCell(8, 1),
    contactName: getCell(2, 3),
    contactPhone: getCell(3, 3),
    startDate: getCell(4, 3),
    endDate: getCell(5, 3),
    budget: parseINR(getCell(6, 3)),
    panelMake: getCell(7, 3),
    commissioningDate: getCell(8, 3),
    loginCredential: getCell(9, 1),
    userName: getCell(10, 1),
    password: getCell(10, 3),
    budgetConsidered: parseINR(getCell(11, 1)),
    actualBudget: parseINR(getCell(12, 1)),
    consideredMargin: getCell(11, 3),
    actualMargin: getCell(12, 3),
    billOfItemsTotal: parseINR(getCell(14, 1)),
    expensesTotal: parseINR(getCell(14, 3)),
    consRatePerWp: parseINR(getCell(15, 1)),
    actRatePerWp: parseINR(getCell(15, 3)),
  };
}

function parseBomItems(rows: string[][]): BomItem[] {
  const items: BomItem[] = [];
  // Find the header row (contains "Category", "Items", etc.)
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.some(c => c?.toLowerCase() === 'category')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return items;

  // Parse rows after header until we hit a totals row or empty
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    const category = row[0]?.trim() || '';
    const item = row[1]?.trim() || '';

    // Skip empty rows or totals row
    if (!category && !item) continue;
    if (!item) continue;

    items.push({
      category,
      item,
      make: row[2]?.trim() || '',
      qty: parseFloat(row[3] || '0') || 0,
      units: row[4]?.trim() || 'Nos',
      status: row[5]?.trim() || '',
      rate: parseINR(row[6]),
      amount: parseINR(row[7]),
      gstRate: parsePercent(row[8]),
      totalAmount: parseINR(row[9]),
      vendor: row[10]?.trim() || '',
    });
  }

  return items;
}

function parseExpenses(rows: string[][]): ExpenseItem[] {
  const items: ExpenseItem[] = [];
  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.some(c => c?.toLowerCase().includes('description') || c?.toLowerCase().includes('eng name'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return items;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    // Skip totals row
    if (row.some(c => c?.toLowerCase().includes('total'))) continue;

    const amount = parseINR(row[4]);
    if (amount === 0) continue;

    items.push({
      description: row[0]?.trim() || '',
      engineerName: row[1]?.trim() || '',
      date: row[2]?.trim() || '',
      voucherNo: row[3]?.trim() || '',
      amount,
    });
  }

  return items;
}

function parseTasks(rows: string[][]): TaskItem[] {
  const items: TaskItem[] = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.some(c => c?.toLowerCase().includes('task name'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return items;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]?.trim()) continue;

    items.push({
      taskName: row[0]?.trim() || '',
      assignedTo: row[1]?.trim() || '',
      assignedDate: row[2]?.trim() || '',
      status: row[3]?.trim() || '',
      remarks: row[4]?.trim() || '',
      doneBy: row[5]?.trim() || '',
      startDate: row[6]?.trim() || '',
      endDate: row[7]?.trim() || '',
    });
  }

  return items;
}

async function scanAllProjects(drive: drive_v3.Drive, sheets: sheets_v4.Sheets): Promise<ProjectData[]> {
  const op = '[scanAllProjects]';
  const allProjects: ProjectData[] = [];

  const yearFolders: Array<{ id: string; fy: '2024-25' | '2025-26' }> = [
    { id: FOLDER_2024_ID, fy: '2024-25' },
    { id: FOLDER_2025_ID, fy: '2025-26' },
  ];

  for (const { id: yearFolderId, fy } of yearFolders) {
    console.log(`${op} Scanning ${fy} folder...`);
    const folderItems = await listAllFiles(drive, yearFolderId);

    const projectFolders = folderItems.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    console.log(`${op} Found ${projectFolders.length} project folders in ${fy}`);

    for (const folder of projectFolders) {
      console.log(`${op} Processing: ${folder.name}`);

      try {
        // Wrap entire folder processing in a 30-second timeout
        const projectData = await Promise.race([
          (async () => {
            const filesInFolder = await listAllFiles(drive, folder.id);
            const spreadsheet = filesInFolder.find(f => f.mimeType === 'application/vnd.google-apps.spreadsheet');
            const otherFiles = filesInFolder.filter(f =>
              f.mimeType !== 'application/vnd.google-apps.spreadsheet' &&
              f.mimeType !== 'application/vnd.google-apps.folder'
            );

            // Also check for sub-folders (Site Photos etc.) — with timeout per sub-folder
            const subFolders = filesInFolder.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
            for (const sub of subFolders) {
              try {
                const subFiles = await Promise.race([
                  listAllFiles(drive, sub.id),
                  new Promise<DriveFile[]>((_, reject) => setTimeout(() => reject(new Error('Sub-folder timeout')), 15000)),
                ]);
                otherFiles.push(...subFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder'));
              } catch {
                console.warn(`${op} Timeout reading sub-folder "${sub.name}" in ${folder.name}, skipping`);
              }
            }

            let details: ProjectDetails | null = null;
            let bomItems: BomItem[] = [];
            let expenses: ExpenseItem[] = [];
            let tasks: TaskItem[] = [];

            if (spreadsheet) {
              try {
                const detailsRows = await readSheetTab(sheets, spreadsheet.id, 'Project details');
                details = parseProjectDetails(detailsRows);

                const bomRows = await readSheetTab(sheets, spreadsheet.id, 'Bill of items ');
                if (bomRows.length === 0) {
                  const bomRows2 = await readSheetTab(sheets, spreadsheet.id, 'Bill of items');
                  bomItems = parseBomItems(bomRows2);
                } else {
                  bomItems = parseBomItems(bomRows);
                }

                const expenseRows = await readSheetTab(sheets, spreadsheet.id, 'Expenses');
                expenses = parseExpenses(expenseRows);

                const taskRows = await readSheetTab(sheets, spreadsheet.id, 'Task');
                tasks = parseTasks(taskRows);
              } catch (err) {
                console.error(`${op} Error reading sheet for ${folder.name}:`, err instanceof Error ? err.message : String(err));
              }
            }

            return {
              folderName: folder.name,
              folderId: folder.id,
              financialYear: fy,
              spreadsheetId: spreadsheet?.id || null,
              details,
              bomItems,
              expenses,
              tasks,
              files: otherFiles,
            } as ProjectData;
          })(),
          new Promise<ProjectData>((_, reject) => setTimeout(() => reject(new Error('Folder processing timeout')), 30000)),
        ]);

        allProjects.push(projectData);
      } catch (err) {
        console.warn(`${op} Timeout/error processing "${folder.name}", skipping: ${err instanceof Error ? err.message : String(err)}`);
        // Push a minimal record so we don't lose the project
        allProjects.push({
          folderName: folder.name,
          folderId: folder.id,
          financialYear: fy,
          spreadsheetId: null,
          details: null,
          bomItems: [],
          expenses: [],
          tasks: [],
          files: [],
        });
      }
    }
  }

  return allProjects;
}

// ─── Phase 2: Create Vendors ───────────────────────────────────────────────────

function collectVendors(projects: ProjectData[]): Map<string, { name: string; types: Set<string> }> {
  const vendors = new Map<string, { name: string; types: Set<string> }>();

  for (const project of projects) {
    for (const item of project.bomItems) {
      if (!item.vendor) continue;

      // Apply canonical name cleanup
      const canonical = canonicalVendorName(item.vendor);

      // Skip stock entries and client scope
      if (canonical === '__STOCK__' || canonical === '__CLIENT_SCOPE__') continue;

      const key = normalizeVendorName(canonical);
      if (!vendors.has(key)) {
        vendors.set(key, { name: canonical, types: new Set() });
      }
      vendors.get(key)!.types.add(mapVendorType(mapBomCategory(item.category)));
    }
  }

  return vendors;
}

async function insertVendors(
  supabase: SupabaseClient,
  vendorMap: Map<string, { name: string; types: Set<string> }>,
  stats: MigrationStats
): Promise<Map<string, string>> {
  const op = '[insertVendors]';
  const vendorIdMap = new Map<string, string>(); // normalized name → DB id

  // Find the highest existing vendor code to continue numbering
  // Fetch all vendor codes and find max numerically (alphabetical sort fails: VEN-108 < VEN-99)
  const { data: allVendors } = await supabase
    .from('vendors')
    .select('vendor_code')
    .like('vendor_code', 'VEN-%');
  let idx = 1;
  if (allVendors && allVendors.length > 0) {
    let maxNum = 0;
    for (const v of allVendors) {
      const match = v.vendor_code?.match(/VEN-(\d+)/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    idx = maxNum + 1;
    console.log(`${op} Existing vendors: ${allVendors.length}, continuing from VEN-${String(idx).padStart(3, '0')}`);
  }

  for (const [key, { name, types }] of vendorMap) {
    // Check if vendor already exists by name
    const { data: existingVendors } = await supabase
      .from('vendors')
      .select('id')
      .ilike('company_name', name)
      .limit(1);

    if (existingVendors && existingVendors.length > 0) {
      vendorIdMap.set(key, existingVendors[0].id);
      continue;
    }

    const vendorCode = generateVendorCode(idx++);
    const vendorType = Array.from(types)[0] || 'other';

    const { data, error } = await supabase
      .from('vendors')
      .insert({
        vendor_code: vendorCode,
        company_name: name,
        vendor_type: vendorType,
        city: 'Chennai',
        state: 'Tamil Nadu',
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`${op} Failed to insert vendor "${name}":`, error.message);
      stats.errors.push(`Vendor "${name}": ${error.message}`);
    } else {
      vendorIdMap.set(key, data.id);
      stats.vendorsCreated++;
      console.log(`${op} Created vendor: ${vendorCode} — ${name}`);
    }
  }

  return vendorIdMap;
}

// ─── Phase 3: Create Projects ──────────────────────────────────────────────────

async function insertProjects(
  supabase: SupabaseClient,
  projects: ProjectData[],
  stats: MigrationStats
): Promise<Map<string, string>> {
  const op = '[insertProjects]';
  const projectIdMap = new Map<string, string>(); // folderName → DB id
  let projIdx2024 = 1;
  let projIdx2025 = 1;

  // Get or create a migration system employee for prepared_by fields
  // Role is on profiles table, not employees
  let { data: founderProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'founder')
    .maybeSingle();

  let founderEmp: { id: string } | null = null;
  if (founderProfile) {
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', founderProfile.id)
      .maybeSingle();
    founderEmp = data;
  }

  if (!founderEmp) {
    // Try any active employee
    const { data: anyEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    founderEmp = anyEmp;
  }

  if (!founderEmp) {
    // Create a migration placeholder employee — requires a profile first
    console.log(`${op} No employees found. Creating migration system user...`);

    // Try to find existing migration auth user first
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    let migrationUserId: string | null = null;

    if (existingUsers?.users) {
      const migUser = existingUsers.users.find(u => u.email === 'migration@shiroi.energy');
      if (migUser) {
        migrationUserId = migUser.id;
        console.log(`${op} Found existing migration auth user: ${migrationUserId}`);
      }
    }

    if (!migrationUserId) {
      const { data: authUser, error: profErr } = await supabase.auth.admin.createUser({
        email: 'migration@shiroi.energy',
        password: 'Migration2026!Temp',
        email_confirm: true,
        user_metadata: { role: 'founder', full_name: 'Migration System' },
      });
      if (profErr || !authUser?.user) {
        console.error(`${op} Cannot create migration user:`, profErr?.message);
        process.exit(1);
      }
      migrationUserId = authUser.user.id;
    }

    // Check if employee already exists for this profile
    const { data: existingEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', migrationUserId)
      .maybeSingle();

    if (existingEmp) {
      founderEmp = existingEmp;
      console.log(`${op} Found existing migration employee: ${existingEmp.id}`);
    } else {
      // Ensure profile exists
      const { data: profileCheck } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', migrationUserId)
        .maybeSingle();

      if (!profileCheck) {
        // Manually insert profile if trigger didn't fire
        await supabase.from('profiles').insert({
          id: migrationUserId,
          role: 'founder',
          full_name: 'Migration System',
          email: 'migration@shiroi.energy',
          phone: '0000000000',
        });
      }

      const { data: empData, error: empErr } = await supabase
        .from('employees')
        .insert({
          profile_id: migrationUserId,
          employee_code: 'EMP-MIGRATION',
          full_name: 'Migration System',
          personal_phone: '0000000000',
          designation: 'System',
          department: 'management',
          date_of_joining: '2024-01-01',
          is_active: true,
        })
        .select('id')
        .single();
      if (empErr) {
        console.error(`${op} Cannot create migration employee:`, empErr.message);
        process.exit(1);
      }
      founderEmp = empData;
      console.log(`${op} Created migration system employee: ${empData.id}`);
    }
  }

  const preparedBy = founderEmp.id;

  for (const project of projects) {
    const details = project.details;
    if (!details || !details.projectName) {
      console.warn(`${op} Skipping "${project.folderName}" — no project details`);
      stats.projectsSkipped++;
      continue;
    }

    // Generate project number
    const fy = project.financialYear;
    const idx = fy === '2024-25' ? projIdx2024++ : projIdx2025++;
    const projectNumber = generateProjectNumber(idx, fy);

    // Check idempotency
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('project_number', projectNumber)
      .maybeSingle();

    if (existing) {
      projectIdMap.set(project.folderName, existing.id);
      stats.projectsSkipped++;
      continue;
    }

    // Parse panel info
    const panel = parsePanelInfo(details.panelMake || '');
    const inverter = parseInverterInfo(details.inverterMake || '');
    const rawSizeKwp = parseFloat(details.systemSize?.replace(/[^0-9.]/g, '') || '0');
    const systemSizeKwp = Math.min(rawSizeKwp, 9999.99); // Cap to NUMERIC(6,2)

    // Parse phone — take first 10 digits only
    let phone = details.contactPhone ? details.contactPhone.replace(/[^0-9]/g, '') : '';
    if (phone.length > 10) phone = phone.slice(0, 10);
    if (phone.length === 10) phone = normalizePhone(phone);
    if (!phone || phone.length < 10) phone = '0000000000';

    // Cap contracted_value to prevent numeric overflow (NUMERIC 14,2 max = 999999999999.99)
    const rawBudget = details.budget || details.budgetConsidered || 0;
    const contractedValue = Math.min(rawBudget, 999999999999.99);
    const advanceAmount = Math.min(contractedValue, 999999999999.99);

    // Create or reuse lead (required FK for projects)
    // Look up existing lead by phone first (handles repeat customers like Ramaniyam)
    let leadId: string;

    if (phone && phone !== '0000000000') {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle();

      if (existingLead) {
        leadId = existingLead.id;
        console.log(`${op} Reusing existing lead for phone ${phone} — ${details.projectName}`);
      } else {
        const { data: newLead, error: leadError } = await supabase
          .from('leads')
          .insert({
            customer_name: details.projectName,
            phone,
            city: details.location || 'Chennai',
            state: 'Tamil Nadu',
            source: 'referral' as const,
            segment: 'residential' as const,
            system_type: parseSystemType(details.category || ''),
            estimated_size_kwp: systemSizeKwp || 1,
            status: 'converted' as const,
            is_qualified: true,
            converted_to_project: true,
            converted_at: parseDate(details.startDate) || '2025-01-01',
            notes: `Migration placeholder — ${project.folderName}`,
          })
          .select('id')
          .single();

        if (leadError) {
          console.error(`${op} Failed to create lead for "${details.projectName}":`, leadError.message);
          stats.errors.push(`Lead "${details.projectName}": ${leadError.message}`);
          continue;
        }
        leadId = newLead.id;
      }
    } else {
      // No valid phone — create lead with unique placeholder phone
      const placeholderPhone = `00000${String(idx).padStart(5, '0')}`;
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          customer_name: details.projectName,
          phone: placeholderPhone,
          city: details.location || 'Chennai',
          state: 'Tamil Nadu',
          source: 'referral' as const,
          segment: 'residential' as const,
          system_type: parseSystemType(details.category || ''),
          estimated_size_kwp: systemSizeKwp || 1,
          status: 'converted' as const,
          is_qualified: true,
          converted_to_project: true,
          converted_at: parseDate(details.startDate) || '2025-01-01',
          notes: `Migration placeholder (no phone) — ${project.folderName}`,
        })
        .select('id')
        .single();

      if (leadError) {
        console.error(`${op} Failed to create lead for "${details.projectName}":`, leadError.message);
        stats.errors.push(`Lead "${details.projectName}": ${leadError.message}`);
        continue;
      }
      leadId = newLead.id;
    }

    // Create placeholder proposal (required FK for projects)
    const proposalInsert: Record<string, unknown> = {
      lead_id: leadId,
      proposal_number: `SHIROI/PROP/${fy}/${String(idx).padStart(4, '0')}`,
      revision_number: 1,
      prepared_by: preparedBy,
      status: 'accepted',
      system_size_kwp: systemSizeKwp || 1,
      system_type: parseSystemType(details.category || ''),
      valid_until: '2026-12-31',
      notes: `Migration placeholder — ${project.folderName}`,
    };

    const { data: proposalData, error: proposalError } = await supabase
      .from('proposals')
      .insert(proposalInsert)
      .select('id')
      .single();

    if (proposalError) {
      console.error(`${op} Failed to create proposal for "${details.projectName}":`, proposalError.message);
      stats.errors.push(`Proposal "${details.projectName}": ${proposalError.message}`);
      continue;
    }

    const projectData = {
      project_number: projectNumber,
      lead_id: leadId,
      proposal_id: proposalData.id,
      customer_name: details.projectName,
      customer_phone: phone,
      site_address_line1: details.location || 'Chennai',
      site_city: details.location || 'Chennai',
      site_state: 'Tamil Nadu',
      system_size_kwp: systemSizeKwp || 1,
      system_type: parseSystemType(details.category || ''),
      panel_brand: panel.brand || null,
      panel_model: panel.model || null,
      panel_wattage: panel.wattage || null,
      panel_count: panel.count || 1,
      inverter_brand: inverter.brand || null,
      inverter_model: inverter.model || null,
      inverter_capacity_kw: inverter.capacityKw || null,
      contracted_value: contractedValue,
      advance_amount: advanceAmount,
      advance_received_at: parseDate(details.startDate) || '2025-01-01',
      status: mapProjectStatus(details.status || 'Completed'),
      actual_start_date: parseDate(details.startDate) || null,
      actual_end_date: parseDate(details.endDate) || null,
      commissioned_date: parseDate(details.commissioningDate) || null,
      planned_start_date: parseDate(details.startDate) || null,
      planned_end_date: parseDate(details.endDate) || null,
      structure_type: details.category?.toLowerCase().includes('low raise') ? 'Low Rise' :
                      details.category?.toLowerCase().includes('high raise') ? 'High Rise' : null,
      notes: [
        details.assignedTo ? `Assigned to: ${details.assignedTo}` : '',
        details.category ? `Category: ${details.category}` : '',
        details.consideredMargin ? `Considered Margin: ${details.consideredMargin}` : '',
        details.actualMargin ? `Actual Margin: ${details.actualMargin}` : '',
        details.actualBudget ? `Actual Budget: ₹${details.actualBudget}` : '',
        details.consRatePerWp ? `Cons Rate/Wp: ₹${details.consRatePerWp}` : '',
        details.actRatePerWp ? `Act Rate/Wp: ₹${details.actRatePerWp}` : '',
        `Source: Google Drive / ${project.financialYear} / ${project.folderName}`,
      ].filter(Boolean).join('\n'),
      completion_pct: details.status?.toLowerCase() === 'completed' ? 100 : 0,
    };

    const { data, error } = await supabase
      .from('projects')
      .insert(projectData)
      .select('id')
      .single();

    if (error) {
      console.error(`${op} Failed to insert "${details.projectName}":`, error.message);
      stats.errors.push(`Project "${details.projectName}": ${error.message}`);
    } else {
      projectIdMap.set(project.folderName, data.id);
      stats.projectsCreated++;
      console.log(`${op} Created: ${projectNumber} — ${details.projectName} (${systemSizeKwp} KWp)`);
    }
  }

  return projectIdMap;
}

// ─── Phase 4: Purchase Orders + Line Items ─────────────────────────────────────

async function insertPurchaseOrders(
  supabase: SupabaseClient,
  projects: ProjectData[],
  projectIdMap: Map<string, string>,
  vendorIdMap: Map<string, string>,
  stats: MigrationStats
): Promise<void> {
  const op = '[insertPurchaseOrders]';
  let poCounter2024 = 1;
  let poCounter2025 = 1;

  // We need a "system" user for prepared_by — find founder via profiles→employees
  let preparedById: string | null = null;
  const { data: founderProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'founder')
    .limit(1)
    .maybeSingle();

  if (founderProfile) {
    const { data: founderEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', founderProfile.id)
      .maybeSingle();
    preparedById = founderEmp?.id || null;
  }

  if (!preparedById) {
    // Fallback: any active employee
    const { data: anyEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    preparedById = anyEmp?.id || null;
  }

  for (const project of projects) {
    const projectId = projectIdMap.get(project.folderName);
    if (!projectId || project.bomItems.length === 0) continue;

    // Group BOM items by canonical vendor name
    const itemsByVendor = new Map<string, BomItem[]>();
    for (const item of project.bomItems) {
      if (!item.vendor) continue;
      const canonical = canonicalVendorName(item.vendor);
      if (canonical === '__STOCK__' || canonical === '__CLIENT_SCOPE__') continue;
      const vendorKey = normalizeVendorName(canonical);
      if (!itemsByVendor.has(vendorKey)) itemsByVendor.set(vendorKey, []);
      itemsByVendor.get(vendorKey)!.push(item);
    }

    for (const [vendorKey, items] of itemsByVendor) {
      if (vendorKey === '__no_vendor__') continue;

      const vendorId = vendorIdMap.get(vendorKey);
      if (!vendorId) {
        console.warn(`${op} No vendor ID for "${vendorKey}", skipping PO`);
        continue;
      }

      const fy = project.financialYear;
      const poIdx = fy === '2024-25' ? poCounter2024++ : poCounter2025++;
      const poNumber = generatePONumber(poIdx, fy);

      const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
      const gstAmount = items.reduce((sum, i) => sum + (i.totalAmount - i.amount), 0);
      const totalAmount = items.reduce((sum, i) => sum + i.totalAmount, 0);

      const poData: Record<string, unknown> = {
        project_id: projectId,
        vendor_id: vendorId,
        prepared_by: preparedById,
        po_number: poNumber,
        status: 'fully_delivered',
        po_date: parseDate(project.details?.startDate || '') || '2025-01-01',
        subtotal,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        amount_paid: totalAmount,
        amount_outstanding: 0,
        notes: `Migrated from Google Drive: ${project.folderName}`,
      };

      const { data: poRecord, error: poError } = await supabase
        .from('purchase_orders')
        .insert(poData)
        .select('id')
        .single();

      if (poError) {
        console.error(`${op} Failed PO for "${project.folderName}" / "${vendorKey}":`, poError.message);
        stats.errors.push(`PO ${poNumber}: ${poError.message}`);
        continue;
      }

      stats.posCreated++;

      // Insert line items
      for (let lineIdx = 0; lineIdx < items.length; lineIdx++) {
        const item = items[lineIdx];
        const bomCategory = mapBomCategory(item.category);

        const { error: itemError } = await supabase
          .from('purchase_order_items')
          .insert({
            purchase_order_id: poRecord.id,
            line_number: lineIdx + 1,
            item_category: bomCategory,
            item_description: item.item,
            brand: item.make || null,
            unit: mapUnit(item.units),
            quantity_ordered: item.qty,
            quantity_delivered: item.qty,
            quantity_pending: 0,
            unit_price: item.rate,
            total_price: item.amount,
            gst_rate: item.gstRate,
            gst_amount: item.totalAmount - item.amount,
          });

        if (itemError) {
          console.error(`${op} Failed PO item:`, itemError.message);
          stats.errors.push(`PO Item ${poNumber}/${lineIdx + 1}: ${itemError.message}`);
        } else {
          stats.poItemsCreated++;
        }
      }
    }
  }
}

// ─── Phase 5: Project Expenses ─────────────────────────────────────────────────

async function insertExpenses(
  supabase: SupabaseClient,
  projects: ProjectData[],
  projectIdMap: Map<string, string>,
  stats: MigrationStats
): Promise<void> {
  const op = '[insertExpenses]';

  for (const project of projects) {
    const projectId = projectIdMap.get(project.folderName);
    if (!projectId || project.expenses.length === 0) continue;

    for (const expense of project.expenses) {
      const { error } = await supabase
        .from('project_site_expenses')
        .insert({
          project_id: projectId,
          description: expense.description || null,
          employee_name: expense.engineerName || null,
          expense_date: parseDate(expense.date) || null,
          voucher_no: expense.voucherNo || null,
          amount: expense.amount,
          notes: `Migrated from Google Drive: ${project.folderName}`,
        });

      if (error) {
        console.error(`${op} Failed expense for "${project.folderName}":`, error.message);
        stats.errors.push(`Expense ${project.folderName}/${expense.voucherNo}: ${error.message}`);
      } else {
        stats.expensesCreated++;
      }
    }
  }
}

// ─── Phase 6: File Upload ──────────────────────────────────────────────────────

async function uploadFiles(
  supabase: SupabaseClient,
  drive: drive_v3.Drive,
  projects: ProjectData[],
  projectIdMap: Map<string, string>,
  stats: MigrationStats
): Promise<void> {
  const op = '[uploadFiles]';

  for (const project of projects) {
    const projectId = projectIdMap.get(project.folderName);
    if (!projectId || project.files.length === 0) continue;

    for (const file of project.files) {
      // Only upload PDFs and images
      if (!file.mimeType.includes('pdf') && !file.mimeType.includes('image')) continue;

      try {
        // Determine file category
        let category = 'documents';
        if (file.mimeType.includes('image')) category = 'photos';
        if (file.name.toLowerCase().includes('sesal')) category = 'sesal';
        if (file.name.toLowerCase().includes('layout') || file.name.toLowerCase().includes('module')) category = 'layouts';
        if (file.name.toLowerCase().includes('po') || file.name.toLowerCase().includes('purchase')) category = 'purchase-orders';
        if (file.name.toLowerCase().includes('invoice')) category = 'invoices';
        if (file.name.toLowerCase().includes('dc-') || file.name.toLowerCase().includes('dc ')) category = 'delivery-challans';

        const storagePath = `projects/${projectId}/${category}/${file.name}`;

        // Download from Drive
        const res = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );

        const buffer = Buffer.from(res.data as ArrayBuffer);

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('project-files')
          .upload(storagePath, buffer, {
            contentType: file.mimeType,
            upsert: true,
          });

        if (uploadError) {
          console.error(`${op} Upload failed for ${file.name}:`, uploadError.message);
          stats.errors.push(`Upload ${file.name}: ${uploadError.message}`);
        } else {
          stats.filesUploaded++;
          console.log(`${op} Uploaded: ${storagePath}`);
        }
      } catch (err) {
        console.error(`${op} Download/upload error for ${file.name}:`, err instanceof Error ? err.message : String(err));
        stats.errors.push(`File ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// ─── Dry Run Report ────────────────────────────────────────────────────────────

function printDryRunReport(projects: ProjectData[], vendorMap: Map<string, { name: string; types: Set<string> }>): void {
  const op = '[DRY RUN]';
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  MIGRATION DRY RUN REPORT`);
  console.log(`${'='.repeat(70)}\n`);

  const withSheets = projects.filter(p => p.spreadsheetId);
  const withDetails = projects.filter(p => p.details);
  const withBom = projects.filter(p => p.bomItems.length > 0);
  const withExpenses = projects.filter(p => p.expenses.length > 0);
  const withFiles = projects.filter(p => p.files.length > 0);
  const totalBomItems = projects.reduce((sum, p) => sum + p.bomItems.length, 0);
  const totalExpenses = projects.reduce((sum, p) => sum + p.expenses.length, 0);
  const totalFiles = projects.reduce((sum, p) => sum + p.files.length, 0);

  console.log(`  Project folders scanned:  ${projects.length}`);
  console.log(`    - With spreadsheets:    ${withSheets.length}`);
  console.log(`    - With project details: ${withDetails.length}`);
  console.log(`    - With BOM data:        ${withBom.length}`);
  console.log(`    - With expenses:        ${withExpenses.length}`);
  console.log(`    - With files:           ${withFiles.length}`);
  console.log(`  `);
  console.log(`  Total BOM line items:     ${totalBomItems}`);
  console.log(`  Total expense records:    ${totalExpenses}`);
  console.log(`  Total files to upload:    ${totalFiles}`);
  console.log(`  Unique vendors:           ${vendorMap.size}`);
  console.log(`  `);

  // By financial year
  const fy2024 = projects.filter(p => p.financialYear === '2024-25');
  const fy2025 = projects.filter(p => p.financialYear === '2025-26');
  console.log(`  FY 2024-25: ${fy2024.length} projects`);
  console.log(`  FY 2025-26: ${fy2025.length} projects`);
  console.log(`  `);

  // Projects without sheet data
  const noSheet = projects.filter(p => !p.spreadsheetId);
  if (noSheet.length > 0) {
    console.log(`  ⚠ Projects with NO spreadsheet (${noSheet.length}):`);
    for (const p of noSheet) {
      console.log(`    - ${p.folderName}`);
    }
  }

  // Vendor list
  console.log(`\n  Vendors (${vendorMap.size}):`);
  let vIdx = 1;
  for (const [, { name, types }] of vendorMap) {
    console.log(`    ${vIdx++}. ${name} (${Array.from(types).join(', ')})`);
  }

  // Sample project detail
  const sample = projects.find(p => p.details && p.bomItems.length > 0);
  if (sample) {
    console.log(`\n  ─── Sample: ${sample.folderName} ───`);
    console.log(`  Name: ${sample.details!.projectName}`);
    console.log(`  Size: ${sample.details!.systemSize}`);
    console.log(`  Status: ${sample.details!.status}`);
    console.log(`  Budget: ₹${sample.details!.budget}`);
    console.log(`  BOM items: ${sample.bomItems.length}`);
    console.log(`  Expenses: ${sample.expenses.length}`);
    console.log(`  Files: ${sample.files.length}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  DRY RUN COMPLETE — No database writes performed.`);
  console.log(`${'='.repeat(70)}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

// ─── Phase Selection ──────────────────────────────────────────────────────────
// Usage:
//   npx tsx scripts/migrate-google-drive.ts --dry-run                # Scan only
//   npx tsx scripts/migrate-google-drive.ts --phase vendors          # Vendors only
//   npx tsx scripts/migrate-google-drive.ts --phase projects         # Projects only
//   npx tsx scripts/migrate-google-drive.ts --phase pos              # POs only
//   npx tsx scripts/migrate-google-drive.ts --phase expenses         # Expenses only
//   npx tsx scripts/migrate-google-drive.ts --phase files            # Files only
//   npx tsx scripts/migrate-google-drive.ts                          # All phases

function getPhase(): string | null {
  const idx = process.argv.indexOf('--phase');
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const op = '[migrate-google-drive]';
  const dryRun = isDryRun();
  const phase = getPhase();

  const useCache = process.argv.includes('--use-cache');
  console.log(`${op} Starting migration... (${dryRun ? 'DRY RUN' : phase ? `PHASE: ${phase}` : 'ALL PHASES'}${useCache ? ' + CACHED SCAN' : ''})`);

  const SCAN_CACHE_PATH = path.resolve(__dirname, 'data/migration-scan-cache.json');

  let projects: ProjectData[];

  if (useCache && existsSync(SCAN_CACHE_PATH)) {
    // Load cached scan results (avoids 5+ min Google API scan)
    console.log(`\n${op} Loading cached scan results from ${SCAN_CACHE_PATH}...`);
    projects = JSON.parse(readFileSync(SCAN_CACHE_PATH, 'utf-8'));
    console.log(`${op} Loaded ${projects.length} projects from cache`);
  } else {
    // Initialize Google APIs
    const { drive, sheets } = getGoogleClients();

    // Phase 1: Scan (always runs — data needed by all phases)
    console.log(`\n${op} Phase 1: Scanning Google Drive...`);
    projects = await scanAllProjects(drive, sheets);
    console.log(`${op} Scanned ${projects.length} project folders`);

    // Cache scan results for subsequent phase runs
    writeFileSync(SCAN_CACHE_PATH, JSON.stringify(projects, null, 0));
    console.log(`${op} Scan results cached to ${SCAN_CACHE_PATH}`);
  }

  // Collect vendors
  const vendorMap = collectVendors(projects);
  console.log(`${op} Found ${vendorMap.size} unique vendors`);

  if (dryRun) {
    printDryRunReport(projects, vendorMap);

    // Save scan results for reference
    const report = projects.map(p => ({
      folder: p.folderName,
      fy: p.financialYear,
      hasSheet: !!p.spreadsheetId,
      hasDetails: !!p.details,
      projectName: p.details?.projectName || '',
      systemSize: p.details?.systemSize || '',
      status: p.details?.status || '',
      budget: p.details?.budget || 0,
      bomItems: p.bomItems.length,
      expenses: p.expenses.length,
      files: p.files.length,
    }));

    writeFileSync('scripts/data/migration-scan-report.json', JSON.stringify(report, null, 2));
    console.log(`${op} Scan report saved to scripts/data/migration-scan-report.json`);
    return;
  }

  // Live run — initialize Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stats: MigrationStats = {
    projectsFolderScanned: projects.length,
    sheetsRead: projects.filter(p => p.spreadsheetId).length,
    sheetsReadErrors: projects.filter(p => p.spreadsheetId && !p.details).length,
    vendorsCreated: 0,
    projectsCreated: 0,
    projectsSkipped: 0,
    posCreated: 0,
    poItemsCreated: 0,
    expensesCreated: 0,
    filesUploaded: 0,
    errors: [],
  };

  logMigrationStart('Google Drive Migration', projects.length);

  // Phase 2: Vendors
  if (!phase || phase === 'vendors') {
    console.log(`\n${op} Phase 2: Creating vendors...`);
    const vendorIdMap = await insertVendors(supabase, vendorMap, stats);
    console.log(`${op} ✓ Vendors done — ${stats.vendorsCreated} created`);
    if (phase === 'vendors') {
      printPhaseStats(op, stats);
      return;
    }
  }

  // Phase 3: Projects (needs vendor map for nothing, but leads/proposals)
  let projectIdMap = new Map<string, string>();
  if (!phase || phase === 'projects') {
    console.log(`\n${op} Phase 3: Creating projects...`);
    projectIdMap = await insertProjects(supabase, projects, stats);
    console.log(`${op} ✓ Projects done — ${stats.projectsCreated} created, ${stats.projectsSkipped} skipped`);
    if (phase === 'projects') {
      printPhaseStats(op, stats);
      return;
    }
  }

  // For POs/expenses/files, we need the projectIdMap — load from DB if running individual phase
  if (phase && phase !== 'vendors' && phase !== 'projects') {
    console.log(`${op} Loading existing projects from DB for phase "${phase}"...`);
    projectIdMap = await loadExistingProjectIdMap(supabase, projects);
    console.log(`${op} Found ${projectIdMap.size} existing projects in DB`);
  }

  // Also load vendor map from DB for POs
  let vendorIdMap = new Map<string, string>();
  if (!phase || phase === 'pos') {
    vendorIdMap = await loadExistingVendorIdMap(supabase, vendorMap);
  }

  // Phase 4: Purchase Orders
  if (!phase || phase === 'pos') {
    console.log(`\n${op} Phase 4: Creating purchase orders...`);
    await insertPurchaseOrders(supabase, projects, projectIdMap, vendorIdMap, stats);
    console.log(`${op} ✓ POs done — ${stats.posCreated} POs, ${stats.poItemsCreated} items`);
    if (phase === 'pos') {
      printPhaseStats(op, stats);
      return;
    }
  }

  // Phase 5: Expenses
  if (!phase || phase === 'expenses') {
    console.log(`\n${op} Phase 5: Creating project expenses...`);
    await insertExpenses(supabase, projects, projectIdMap, stats);
    console.log(`${op} ✓ Expenses done — ${stats.expensesCreated} created`);
    if (phase === 'expenses') {
      printPhaseStats(op, stats);
      return;
    }
  }

  // Phase 6: File uploads
  if (!phase || phase === 'files') {
    // Need Google Drive API to download files — init if not already available
    const { drive: driveClient } = getGoogleClients();
    console.log(`\n${op} Phase 6: Uploading files to Supabase Storage...`);
    await uploadFiles(supabase, driveClient, projects, projectIdMap, stats);
    console.log(`${op} ✓ Files done — ${stats.filesUploaded} uploaded`);
    if (phase === 'files') {
      printPhaseStats(op, stats);
      return;
    }
  }

  // Summary (all phases)
  printPhaseStats(op, stats);
}

// Load project ID map from DB for when running individual phases
async function loadExistingProjectIdMap(
  supabase: SupabaseClient,
  projects: ProjectData[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const project of projects) {
    if (!project.details?.projectName) continue;

    const { data } = await supabase
      .from('projects')
      .select('id, notes')
      .ilike('notes', `%${project.folderName}%`)
      .maybeSingle();

    if (data) {
      map.set(project.folderName, data.id);
    }
  }

  return map;
}

// Load vendor ID map from DB for when running individual phases
async function loadExistingVendorIdMap(
  supabase: SupabaseClient,
  vendorMap: Map<string, { name: string; types: Set<string> }>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const [key, { name }] of vendorMap) {
    const { data } = await supabase
      .from('vendors')
      .select('id')
      .ilike('company_name', name)
      .maybeSingle();

    if (data) {
      map.set(key, data.id);
    }
  }

  return map;
}

function printPhaseStats(op: string, stats: MigrationStats): void {
  logMigrationEnd('Google Drive Migration', {
    processed: stats.projectsFolderScanned,
    inserted: stats.projectsCreated,
    skipped: stats.projectsSkipped,
    errors: stats.errors.length,
  });

  console.log(`\n  Stats:`);
  console.log(`    Vendors created:    ${stats.vendorsCreated}`);
  console.log(`    Projects created:   ${stats.projectsCreated}`);
  console.log(`    Projects skipped:   ${stats.projectsSkipped}`);
  console.log(`    POs created:        ${stats.posCreated}`);
  console.log(`    PO items created:   ${stats.poItemsCreated}`);
  console.log(`    Expenses created:   ${stats.expensesCreated}`);
  console.log(`    Files uploaded:     ${stats.filesUploaded}`);

  if (stats.errors.length > 0) {
    console.log(`\n  ⚠ Errors (${stats.errors.length}):`);
    for (const err of stats.errors.slice(0, 30)) {
      console.log(`    - ${err}`);
    }
    if (stats.errors.length > 30) {
      console.log(`    ... and ${stats.errors.length - 30} more`);
    }
  }

  // Save full report
  writeFileSync('scripts/data/migration-report.json', JSON.stringify(stats, null, 2));
  console.log(`\n${op} Report saved to scripts/data/migration-report.json`);
}

main().catch(console.error);
