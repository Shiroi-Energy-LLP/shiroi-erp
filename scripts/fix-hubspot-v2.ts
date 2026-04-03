/**
 * HubSpot Migration V2 Fix
 *
 * Fixes all issues from V1 migration:
 *   1. Updates stage mappings (Appointment Scheduled → site_survey_scheduled,
 *      Design Confirmation → design_confirmed)
 *   2. Matches and inserts ALL 24 previously unmatched payments
 *   3. Creates missing records (Maharajan, Rakshas)
 *   4. Generates dedup audit report for the 237 deduped records
 *
 * Prerequisites:
 *   - Migration 011 applied (design_confirmed enum value added)
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
 *   - Original migration already completed (V1)
 *
 * Usage:
 *   npx tsx scripts/fix-hubspot-v2.ts --dry-run    (preview — mandatory first)
 *   npx tsx scripts/fix-hubspot-v2.ts               (live run)
 *
 * IDEMPOTENT: Safe to run multiple times.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Environment Loading
// ---------------------------------------------------------------------------

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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const isDryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// CSV Parser (from V1)
// ---------------------------------------------------------------------------

function parseCSVRobust(csvContent: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') {
      if (inQuotes && i + 1 < csvContent.length && csvContent[i + 1] === '"') {
        currentLine += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && i + 1 < csvContent.length && csvContent[i + 1] === '\n') i++;
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((header, j) => { record[header] = (values[j] ?? '').trim(); });
    records.push(record);
  }
  return records;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { field += '"'; i++; continue; }
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields.map(f => {
    if (f.startsWith('"') && f.endsWith('"')) return f.slice(1, -1).replace(/""/g, '"');
    return f;
  });
}

// ---------------------------------------------------------------------------
// PV Number Parser — V2 (supports dash format)
// ---------------------------------------------------------------------------

interface ParsedPV {
  pvNumber: number;
  fy: string;
  raw: string;
}

/**
 * Parse PV number from HubSpot Quote ID field.
 * V2: Now supports both slash (PV49/24) and dash (PV041-22) formats.
 */
function parsePVNumber(quoteId: string): ParsedPV | null {
  if (!quoteId || !quoteId.trim()) return null;

  let cleaned = quoteId
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, '')
    .trim();

  // V2: Accept both / and - as separator
  const match = cleaned.match(/PV\s*(\d+)\s*[\/\-]\s*(\d{2}(?:-\d{2})?)/i);
  if (!match) return null;

  const pvNumber = parseInt(match[1], 10);
  const fy = match[2];
  return { pvNumber, fy, raw: cleaned };
}

// ---------------------------------------------------------------------------
// Name Matching — V2 (improved)
// ---------------------------------------------------------------------------

function normalizeCustomerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?)\s+/i, '')
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

/**
 * V2 name matching: splits on " - " delimiter and matches parts independently.
 * Also increases Levenshtein threshold for longer names.
 */
function namesMatchV2(a: string, b: string): { matches: boolean; confidence: 'high' | 'medium' | 'low'; method: string } {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (!na || !nb) return { matches: false, confidence: 'low', method: 'empty' };

  // Exact match
  if (na === nb) return { matches: true, confidence: 'high', method: 'exact' };

  // Split on " - " and match parts (handles "Developer - Building" patterns)
  const partsA = na.split(/\s*-\s*/).filter(p => p.length > 2);
  const partsB = nb.split(/\s*-\s*/).filter(p => p.length > 2);

  // Check if any significant part of A matches any part of B
  for (const pa of partsA) {
    for (const pb of partsB) {
      if (pa === pb) return { matches: true, confidence: 'high', method: 'part_exact' };
      if (pa.length > 4 && pb.length > 4) {
        if (pa.includes(pb) || pb.includes(pa)) {
          return { matches: true, confidence: 'medium', method: 'part_substring' };
        }
        const dist = levenshtein(pa, pb);
        const maxLen = Math.max(pa.length, pb.length);
        if (dist <= Math.ceil(maxLen * 0.2)) {
          return { matches: true, confidence: 'medium', method: 'part_levenshtein' };
        }
      }
    }
  }

  // Full string: substring containment (only if both names are > 5 chars to avoid false positives)
  if (na.length > 5 && nb.length > 5) {
    if (na.includes(nb) || nb.includes(na)) {
      return { matches: true, confidence: 'medium', method: 'substring' };
    }
  }

  // Full string: Levenshtein
  if (na.length <= 30 && nb.length <= 30) {
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    if (dist <= Math.ceil(maxLen * 0.15)) {
      return { matches: true, confidence: 'low', method: 'levenshtein' };
    }
  }

  return { matches: false, confidence: 'low', method: 'none' };
}

// ---------------------------------------------------------------------------
// Manual Mapping Table
// ---------------------------------------------------------------------------

/** Known name mismatches between HubSpot and Google Drive data */
const MANUAL_NAME_MAP: Record<string, string> = {
  // HubSpot name → expected DB name (substring to search for)
  'srestha padmalaya': 'spdpl padmalaya',
  'spdpl padmalaya': 'srestha padmalaya',
  'jains aadheeswar': 'jians aadheeswar',
  'jians aadheeswar': 'jains aadheeswar',
  'prestige ooty hill crest': 'prestige hill crest',
  'prestige hill crest': 'prestige ooty hill crest',
  'khurinji the orchid': "khurinji's orchid",
  "khurinji's orchid": 'khurinji the orchid',
  'rcc e-construct': 'rcc e constrcution',
  'rcc e constrcution': 'rcc e-construct',
  'newry properties astor': 'newry astor',
  'newry astor': 'newry properties astor',
  'shree viruksha homes': 'shree viruskha homes',
  'shree viruskha homes': 'shree viruksha homes',
  'adroit urban': 'adroit prosper',
  'adroit prosper': 'adroit urban',
  'rcc e-construct': 'rcc e constrcution',
  'rcc econstruct': 'rcc e constrcution',
};

/**
 * HubSpot Record ID → DB project customer_name (substring match).
 * For payments that can't be auto-matched.
 * Also includes records that need new lead+project creation.
 */
interface ManualPaymentMatch {
  dbProjectSubstring?: string;  // substring to find in projects.customer_name
  createNew?: {                 // create new lead+project if no DB match
    customerName: string;
    sizeKwp: number;
    status: string;
    segment: string;
  };
}

const MANUAL_PAYMENT_MAP: Record<string, ManualPaymentMatch> = {
  // Adroit urban - C and D Block → Adroit Prosper D Block
  '232531934950': { dbProjectSubstring: 'adroit prosper d block' },
  // Adroit Urban (Retention, no amount) → Adroit Prosper
  '223303729863': { dbProjectSubstring: 'adroit prosper' },
  // Subramaniam Nithya Builders → needs new project (PV034/25-26)
  '239542594277': {
    createNew: { customerName: 'Subramaniam Nithya Builders', sizeKwp: 6, status: 'commissioned', segment: 'residential' },
  },
  // Radiance Splendour - Coimbatore → needs new project (PV222/25-26, 141.6 kWp)
  '217571741423': {
    createNew: { customerName: 'Radiance Splendour - Coimbatore', sizeKwp: 141.6, status: 'commissioned', segment: 'commercial' },
  },
  // Raja - Rajagopal Street → needs new project (PV128/25-26, 9.9 kWp)
  '213215914689': {
    createNew: { customerName: 'GRN Rajagopal Street', sizeKwp: 9.9, status: 'commissioned', segment: 'residential' },
  },
  // Navins Hanging Garden (Retention, no amount) → needs new project
  '223196619513': {
    createNew: { customerName: 'Navins Hanging Garden', sizeKwp: 5, status: 'completed', segment: 'commercial' },
  },
};

/**
 * Try manual mapping: look up normalized HubSpot name in the manual map,
 * then check if any project's name contains the mapped value.
 */
function tryManualMatch(hubspotName: string, dbName: string): boolean {
  const nHub = normalizeCustomerName(hubspotName);
  const nDb = normalizeCustomerName(dbName);

  for (const [key, value] of Object.entries(MANUAL_NAME_MAP)) {
    if (nHub.includes(key) && nDb.includes(value)) return true;
    if (nHub.includes(value) && nDb.includes(key)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Payment Stage Mapping
// ---------------------------------------------------------------------------

interface PaymentStageInfo {
  isAdvance: boolean;
  milestoneNote: string;
}

function mapPaymentStage(stage: string): PaymentStageInfo {
  const s = stage.trim();
  switch (s) {
    case 'Advance':
      return { isAdvance: true, milestoneNote: 'Advance payment (HubSpot)' };
    case 'Supply payment':
      return { isAdvance: false, milestoneNote: 'Supply payment (HubSpot)' };
    case 'Installation payment':
      return { isAdvance: false, milestoneNote: 'Installation payment (HubSpot)' };
    case 'Commissioning payment':
      return { isAdvance: false, milestoneNote: 'Commissioning payment (HubSpot)' };
    case 'Retention':
      return { isAdvance: false, milestoneNote: 'Retention payment (HubSpot)' };
    default:
      return { isAdvance: false, milestoneNote: `${s} (HubSpot)` };
  }
}

// ---------------------------------------------------------------------------
// Amount / Date Parsing (from V1)
// ---------------------------------------------------------------------------

function parseAmount(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) return null;
  const cleaned = amountStr.replace(/[₹$,\s]/g, '').replace(/INR/gi, '').trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseHubSpotDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const cleaned = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const d = new Date(`${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function getFinancialYear(date: Date): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month >= 3) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Supabase Init
// ---------------------------------------------------------------------------

function initSupabase(): SupabaseClient {
  const op = '[initSupabase]';
  const envPath = resolve(__dirname, '..', '.env.local');
  loadEnvFile(envPath);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY`);
    process.exit(1);
  }
  console.log(`${op} Connecting to ${supabaseUrl}`);
  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Number Generators
// ---------------------------------------------------------------------------

/**
 * Get next sequence number for a given prefix/FY.
 * Supports generating numbers for DIFFERENT financial years (not just current).
 */
async function getNextNumber(
  supabase: SupabaseClient,
  table: string,
  column: string,
  prefix: string,
): Promise<{ generate: (forDate?: Date) => string }> {
  // Track max per FY so we can generate numbers for any year
  const maxByFy = new Map<string, number>();

  // Preload max for all FYs that have data
  const { data: allRows } = await supabase
    .from(table)
    .select(column)
    .like(column, `${prefix}/%`)
    .order(column, { ascending: false })
    .limit(5000);

  if (allRows) {
    for (const row of allRows) {
      const val = (row as Record<string, string>)[column];
      const fyMatch = val.match(new RegExp(`${prefix.replace(/\//g, '\\/')}\\/(\\d{4}-\\d{2})\\/(\\d+)$`));
      if (fyMatch) {
        const fy = fyMatch[1];
        const num = parseInt(fyMatch[2], 10);
        maxByFy.set(fy, Math.max(maxByFy.get(fy) ?? 0, num));
      }
    }
  }

  const currentFy = getFinancialYear(new Date());
  console.log(`[getNextNumber] ${prefix}: max by FY = ${JSON.stringify(Object.fromEntries(maxByFy))}`);

  return {
    generate: (forDate?: Date) => {
      const fy = forDate ? getFinancialYear(forDate) : currentFy;
      const current = maxByFy.get(fy) ?? 0;
      const next = current + 1;
      maxByFy.set(fy, next);
      return `${prefix}/${fy}/${String(next).padStart(4, '0')}`;
    },
  };
}

// ===========================================================================
// PHASE 1: Fix Stage Mappings on Existing Leads
// ===========================================================================

async function fixStageMappings(supabase: SupabaseClient): Promise<void> {
  const op = '[fixStageMappings]';
  console.log(`\n${op} Fixing stage mappings...`);

  // We need to find leads that came from HubSpot deals with 'Appointment Scheduled'
  // and 'Design Confirmation' stages. They have hubspot_deal_id set.
  // Re-parse the deals CSV to find which Record IDs had those stages.

  const dealsCSV = resolve(__dirname, 'data/hubspot-deals.csv');
  if (!existsSync(dealsCSV)) {
    console.error(`${op} Deals CSV not found: ${dealsCSV}`);
    return;
  }

  const csvContent = readFileSync(dealsCSV, 'utf-8');
  const records = parseCSVRobust(csvContent);

  // Find deals with incorrect mappings
  const appointmentDeals = records.filter(r => r['Deal Stage']?.trim() === 'Appointment Scheduled');
  const designDeals = records.filter(r => r['Deal Stage']?.trim() === 'Design Confirmation');

  console.log(`${op} Appointment Scheduled deals: ${appointmentDeals.length} (should be site_survey_scheduled)`);
  console.log(`${op} Design Confirmation deals: ${designDeals.length} (should be design_confirmed)`);

  if (isDryRun) {
    console.log(`${op} DRY RUN — would update ${appointmentDeals.length + designDeals.length} leads`);
    return;
  }

  // Update Appointment Scheduled → site_survey_scheduled
  let updatedAppointment = 0;
  for (const deal of appointmentDeals) {
    const dealId = deal['Record ID']?.trim();
    if (!dealId) continue;

    const { data, error } = await supabase
      .from('leads')
      .update({ status: 'site_survey_scheduled' })
      .eq('hubspot_deal_id', dealId)
      .eq('status', 'new')  // only update if still at old mapping
      .select('id');

    if (error) {
      console.warn(`${op} Failed to update lead for deal ${dealId}: ${error.message}`);
    } else if (data && data.length > 0) {
      updatedAppointment += data.length;
    }
  }

  // Update Design Confirmation → design_confirmed
  let updatedDesign = 0;
  for (const deal of designDeals) {
    const dealId = deal['Record ID']?.trim();
    if (!dealId) continue;

    const { data, error } = await supabase
      .from('leads')
      .update({ status: 'design_confirmed' })
      .eq('hubspot_deal_id', dealId)
      .eq('status', 'proposal_sent')  // only update if still at old mapping
      .select('id');

    if (error) {
      console.warn(`${op} Failed to update lead for deal ${dealId}: ${error.message}`);
    } else if (data && data.length > 0) {
      updatedDesign += data.length;
    }
  }

  console.log(`${op} ✅ Updated ${updatedAppointment} leads: new → site_survey_scheduled`);
  console.log(`${op} ✅ Updated ${updatedDesign} leads: proposal_sent → design_confirmed`);
}

// ===========================================================================
// PHASE 2: Fix All Unmatched Payments
// ===========================================================================

interface ProjectMatch {
  id: string;
  projectNumber: string;
  customerName: string;
  leadId: string;
  systemSizeKwp: number;
}

async function fixUnmatchedPayments(supabase: SupabaseClient): Promise<void> {
  const op = '[fixUnmatchedPayments]';
  console.log(`\n${op} Fixing unmatched payments...`);

  // Load payments CSV
  const paymentsCSV = resolve(__dirname, 'data/hubspot-payments-pending.csv');
  if (!existsSync(paymentsCSV)) {
    console.error(`${op} Payments CSV not found: ${paymentsCSV}`);
    return;
  }

  const csvContent = readFileSync(paymentsCSV, 'utf-8');
  const allPaymentRecords = parseCSVRobust(csvContent);
  console.log(`${op} Parsed ${allPaymentRecords.length} payment records from CSV`);

  // Load ALL existing projects
  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, lead_id')
    .is('deleted_at', null);

  if (projErr || !projects) {
    console.error(`${op} Failed to load projects: ${projErr?.message}`);
    return;
  }
  console.log(`${op} Loaded ${projects.length} projects`);

  // Load existing payments to avoid re-inserting
  const { data: existingPayments } = await supabase
    .from('customer_payments')
    .select('id, notes, receipt_number');

  const existingPaymentNotes = new Set(
    (existingPayments || []).map(p => p.notes || '').filter(n => n.includes('HubSpot'))
  );

  // Resolve system employee
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true);

  let systemEmployeeId: string | null = null;
  for (const emp of (employees || [])) {
    if ((emp.full_name ?? '').toLowerCase().includes('vivek')) {
      systemEmployeeId = emp.id;
      break;
    }
  }
  if (!systemEmployeeId && employees && employees.length > 0) {
    systemEmployeeId = employees[0].id;
  }

  if (!systemEmployeeId) {
    console.error(`${op} No system employee found`);
    return;
  }

  // Get receipt number generator
  const receiptGen = await getNextNumber(supabase, 'customer_payments', 'receipt_number', 'SHIROI/REC');
  const projGen = await getNextNumber(supabase, 'projects', 'project_number', 'SHIROI/PROJ');
  const propGen = await getNextNumber(supabase, 'proposals', 'proposal_number', 'SHIROI/PROP');

  let matched = 0;
  let alreadyImported = 0;
  let inserted = 0;
  let skippedNoAmount = 0;
  let created = 0;
  const unmatched: Array<{ recordId: string; name: string; amount: number | null; stage: string; reason: string }> = [];

  for (const payment of allPaymentRecords) {
    const recordId = payment['Record ID']?.trim();
    const dealName = payment['Deal Name']?.trim();
    const quoteId = payment['Quote ID']?.trim() || '';
    const amount = parseAmount(payment['Amount'] || payment['Total Project Value'] || '');
    const stage = payment['Deal Stage']?.trim() || '';
    const sizeKwp = parseFloat(payment['Project Size'] || '0') || null;

    if (!dealName) continue;

    // Check if already imported (by Record ID in notes)
    const alreadyNote = `Record ID: ${recordId}`;
    let alreadyDone = false;
    for (const note of existingPaymentNotes) {
      if (note.includes(alreadyNote)) {
        alreadyDone = true;
        break;
      }
    }
    if (alreadyDone) {
      alreadyImported++;
      continue;
    }

    // Parse PV number (V2 — supports dash format)
    const pv = parsePVNumber(quoteId);

    // --- Matching cascade ---
    let matchedProject: ProjectMatch | null = null;

    // 0. Manual payment map — hardcoded matches for known problematic records
    const manualMatch = recordId ? MANUAL_PAYMENT_MAP[recordId] : undefined;
    if (manualMatch && !matchedProject) {
      if (manualMatch.dbProjectSubstring) {
        const sub = manualMatch.dbProjectSubstring.toLowerCase();
        const proj = projects.find(p => p.customer_name.toLowerCase().includes(sub));
        if (proj) {
          matchedProject = {
            id: proj.id,
            projectNumber: proj.project_number,
            customerName: proj.customer_name,
            leadId: proj.lead_id,
            systemSizeKwp: proj.system_size_kwp,
          };
          console.log(`${op} Manual map: "${dealName}" → "${proj.customer_name}" (Record ${recordId})`);
        }
      }
    }

    // 1. PV number match — search proposals notes for EXACT PV number format
    if (pv && !matchedProject) {
      // Use exact format: "PV123/" to avoid PV32 matching PV320
      const pvExact = `PV${pv.pvNumber}/`;
      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, lead_id, notes, proposal_number')
        .ilike('notes', `%${pvExact}%`);

      if (proposals && proposals.length > 0) {
        for (const prop of proposals) {
          const proj = projects.find(p => p.lead_id === prop.lead_id);
          if (proj) {
            matchedProject = {
              id: proj.id,
              projectNumber: proj.project_number,
              customerName: proj.customer_name,
              leadId: proj.lead_id,
              systemSizeKwp: proj.system_size_kwp,
            };
            console.log(`${op} PV match: "${dealName}" → ${proj.customer_name} (via PV${pv.pvNumber}/${pv.fy})`);
            break;
          }
        }
      }
    }

    // 2. Manual name mapping table (before fuzzy — prevents false substring hits)
    if (!matchedProject) {
      for (const proj of projects) {
        if (tryManualMatch(dealName, proj.customer_name)) {
          matchedProject = {
            id: proj.id,
            projectNumber: proj.project_number,
            customerName: proj.customer_name,
            leadId: proj.lead_id,
            systemSizeKwp: proj.system_size_kwp,
          };
          console.log(`${op} Manual match: "${dealName}" → "${proj.customer_name}"`);
          break;
        }
      }
    }

    // 3. Improved fuzzy name match (V2)
    if (!matchedProject) {
      for (const proj of projects) {
        const result = namesMatchV2(dealName, proj.customer_name);
        if (result.matches) {
          // If both have sizes, verify they're within 30%
          if (sizeKwp && proj.system_size_kwp) {
            const ratio = Math.abs(sizeKwp - proj.system_size_kwp) / Math.max(sizeKwp, proj.system_size_kwp);
            if (ratio > 0.3) continue; // size mismatch
          }
          matchedProject = {
            id: proj.id,
            projectNumber: proj.project_number,
            customerName: proj.customer_name,
            leadId: proj.lead_id,
            systemSizeKwp: proj.system_size_kwp,
          };
          console.log(`${op} Name match (${result.method}): "${dealName}" → "${proj.customer_name}"`);
          break;
        }
      }
    }

    // 4. No match — create new records (from manual map or known names)
    if (!matchedProject) {
      // Check if this record is in the manual payment map with createNew
      const manualCreate = recordId ? MANUAL_PAYMENT_MAP[recordId]?.createNew : undefined;
      const lowerName = dealName.toLowerCase();
      const shouldCreate = manualCreate
        || lowerName.includes('maharajan')
        || lowerName.includes('rakshas')
        || lowerName.includes('raksas');

      if (shouldCreate) {
        // Use manual map data if available, otherwise infer from deal name
        const custName = manualCreate?.customerName
          ?? (lowerName.includes('rakshas') || lowerName.includes('raksas') ? 'Rakshas Enterprises' : dealName.replace(/\s*\d+\s*kw[p]?\s*/i, '').trim() || dealName);
        const projSize = manualCreate?.sizeKwp ?? sizeKwp ?? (lowerName.includes('20') ? 20 : 4);
        const projSegment = manualCreate?.segment ?? 'residential';
        const projStatus = manualCreate?.status
          ?? (stage === 'Advance' ? 'advance_received'
            : stage === 'Commissioning payment' ? 'commissioned'
            : 'completed');

        const now = new Date().toISOString();
        const createdAt = parseHubSpotDate(payment['Create Date'] || '') ?? now;

        if (isDryRun) {
          const dealDate = new Date(createdAt);
          const fy = getFinancialYear(dealDate);
          console.log(`${op} DRY RUN — would create new lead+proposal+project for "${custName}" (${projSize} kWp, ${projStatus}, FY: ${fy}, deal date: ${createdAt.split('T')[0]})`);
          matched++;
          continue;
        }

        console.log(`${op} Creating new records for: "${custName}"`);

        const leadId = crypto.randomUUID();
        const proposalId = crypto.randomUUID();
        const projectId = crypto.randomUUID();
        const totalValue = parseAmount(payment['Total Project Value'] || '') ?? 0;
        // Use timestamp-based phone to avoid collisions on re-runs
        const phoneRand = String(Date.now()).slice(-6);
        const placeholderPhone = `9997${phoneRand}${String(Math.floor(Math.random() * 9000) + 1000)}`;

        // Create lead
        const { error: leadErr } = await supabase.from('leads').insert({
          id: leadId,
          customer_name: custName,
          phone: placeholderPhone,
          segment: projSegment,
          source: 'referral',
          status: 'won',
          estimated_size_kwp: projSize,
          city: 'Chennai',
          state: 'Tamil Nadu',
          created_at: createdAt,
          converted_to_project: true as any,
          converted_at: createdAt,
          notes: `[HubSpot V2 Migration] Created for unmatched payment. Record ID: ${recordId}. Google Drive: https://drive.google.com/drive/folders/1r22qXIGtS3Zhx4VkaUcISlEjCAHbb30q`,
        });

        if (leadErr) {
          console.error(`${op} Failed to create lead for "${custName}": ${leadErr.message}`);
          unmatched.push({ recordId, name: dealName, amount, stage, reason: `Lead creation failed: ${leadErr.message}` });
          continue;
        }

        // Create proposal — use deal's date for FY in number
        const dealDate = new Date(createdAt);
        const propNumber = propGen.generate(dealDate);
        const { error: propErr } = await supabase.from('proposals').insert({
          id: proposalId,
          lead_id: leadId,
          proposal_number: propNumber,
          system_size_kwp: projSize,
          system_type: 'on_grid',
          status: 'accepted',
          prepared_by: systemEmployeeId,
          valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          total_before_discount: totalValue,
          total_after_discount: totalValue,
          shiroi_revenue: totalValue,
          created_at: createdAt,
          notes: `[HubSpot V2 Migration] PV: ${pv ? `PV${pv.pvNumber}/${pv.fy}` : 'N/A'} | Record ID: ${recordId}`,
        });

        if (propErr) {
          console.error(`${op} Failed to create proposal for "${custName}": ${propErr.message}`);
        }

        // Create project — use deal's date for FY in number
        const projNumber = projGen.generate(dealDate);
        const advanceAmt = (stage === 'Advance' && amount) ? amount : 0;
        const { error: projError } = await supabase.from('projects').insert({
          id: projectId,
          lead_id: leadId,
          proposal_id: proposalId,
          project_number: projNumber,
          customer_name: custName,
          customer_phone: placeholderPhone,
          system_size_kwp: projSize,
          system_type: 'on_grid',
          contracted_value: totalValue || 0,
          advance_amount: advanceAmt,
          advance_received_at: createdAt,
          panel_count: Math.ceil(projSize * 1000 / 545), // ~545W per panel estimate
          status: projStatus,
          site_city: lowerName.includes('coimbatore') ? 'Coimbatore' : 'Chennai',
          site_state: 'Tamil Nadu',
          site_address_line1: custName, // placeholder — will be updated from Drive data
          created_at: createdAt,
        });

        if (projError) {
          console.error(`${op} Failed to create project for "${custName}": ${projError.message}`);
          unmatched.push({ recordId, name: dealName, amount, stage, reason: `Project creation failed: ${projError.message}` });
          continue;
        }

        // Add to projects list for potential future matching
        projects.push({
          id: projectId,
          project_number: projNumber,
          customer_name: custName,
          system_size_kwp: projSize,
          lead_id: leadId,
        });

        matchedProject = {
          id: projectId,
          projectNumber: projNumber,
          customerName: custName,
          leadId: leadId,
          systemSizeKwp: projSize,
        };
        created++;
        console.log(`${op} ✅ Created lead+proposal+project for "${custName}" (${projNumber})`);
      }
    }

    if (!matchedProject) {
      unmatched.push({
        recordId,
        name: dealName,
        amount,
        stage,
        reason: 'No project match found in DB',
      });
      console.warn(`${op} ⚠ STILL UNMATCHED: "${dealName}" (Record: ${recordId}, Amount: ${amount}, Stage: ${stage})`);
      continue;
    }

    matched++;

    // Now insert the payment if it has an amount
    if (!amount || amount <= 0) {
      skippedNoAmount++;
      console.log(`${op} Matched "${dealName}" → ${matchedProject.projectNumber} but no amount — skipping payment insert`);
      continue;
    }

    if (isDryRun) {
      console.log(`${op} DRY RUN — would insert payment: "${dealName}" → ${matchedProject.projectNumber}, ₹${amount.toLocaleString('en-IN')}, ${stage}`);
      continue;
    }

    // Insert payment
    const stageInfo = mapPaymentStage(stage);
    const paymentDate = parseHubSpotDate(payment['Close Date'] || payment['Create Date'] || '') ?? new Date().toISOString();
    const receiptNumber = receiptGen.generate(new Date(paymentDate));

    const { error: payErr } = await supabase.from('customer_payments').insert({
      id: crypto.randomUUID(),
      project_id: matchedProject.id,
      amount: amount,
      payment_date: paymentDate.split('T')[0],
      payment_method: 'bank_transfer',
      receipt_number: receiptNumber,
      is_advance: stageInfo.isAdvance,
      recorded_by: systemEmployeeId,
      notes: `${stageInfo.milestoneNote} | Record ID: ${recordId} | ${dealName}`,
    });

    if (payErr) {
      console.error(`${op} Payment insert failed for "${dealName}": ${payErr.message}`);
      unmatched.push({ recordId, name: dealName, amount, stage, reason: `Insert failed: ${payErr.message}` });
    } else {
      inserted++;
      existingPaymentNotes.add(`${stageInfo.milestoneNote} | Record ID: ${recordId}`);
      console.log(`${op} ✅ Payment: "${dealName}" → ${matchedProject.projectNumber}, ₹${amount.toLocaleString('en-IN')} (${stage})`);
    }
  }

  console.log(`\n${op} === Payment Fix Summary ===`);
  console.log(`  Already imported:   ${alreadyImported}`);
  console.log(`  Matched:            ${matched}`);
  console.log(`  New records created: ${created}`);
  console.log(`  Payments inserted:  ${inserted}`);
  console.log(`  Skipped (no amount): ${skippedNoAmount}`);
  console.log(`  Still unmatched:    ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log(`\n${op} === Still Unmatched ===`);
    for (const u of unmatched) {
      console.log(`  ${u.recordId} | ${u.name} | ₹${u.amount?.toLocaleString('en-IN') ?? 'N/A'} | ${u.stage} | ${u.reason}`);
    }
  }
}

// ===========================================================================
// PHASE 3: Dedup Audit Report
// ===========================================================================

async function generateDedupAudit(supabase: SupabaseClient): Promise<void> {
  const op = '[dedupAudit]';
  console.log(`\n${op} Generating dedup audit report...`);

  // Re-parse deals CSV
  const dealsCSV = resolve(__dirname, 'data/hubspot-deals.csv');
  if (!existsSync(dealsCSV)) {
    console.error(`${op} Deals CSV not found`);
    return;
  }

  const csvContent = readFileSync(dealsCSV, 'utf-8');
  const records = parseCSVRobust(csvContent);

  // Load current DB state
  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name, hubspot_deal_id, estimated_size_kwp')
    .is('deleted_at', null);

  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, lead_id')
    .is('deleted_at', null);

  if (!leads || !projects) {
    console.error(`${op} Failed to load data`);
    return;
  }

  // Build index of leads with hubspot_deal_id
  const leadByHubspot = new Map<string, typeof leads[0]>();
  for (const lead of leads) {
    if (lead.hubspot_deal_id) {
      leadByHubspot.set(lead.hubspot_deal_id, lead);
    }
  }

  const auditRows: string[] = [
    'hubspot_record_id,hubspot_deal_name,hubspot_pv_number,hubspot_stage,matched_to_lead_id,matched_name,match_type,confidence,flag',
  ];

  let totalDeduped = 0;
  let flagged = 0;

  for (const deal of records) {
    const recordId = deal['Record ID']?.trim();
    const dealName = deal['Deal Name']?.trim();
    if (!dealName) continue;

    const pvInfo = parsePVNumber(deal['Quote ID']);
    const pvStr = pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : '';
    const stage = deal['Deal Stage']?.trim() || '';
    const sizeKwp = parseFloat(deal['Project Size'] || '0') || null;

    // Check if this deal was deduped (has hubspot_deal_id set on an existing lead)
    const existingLead = recordId ? leadByHubspot.get(recordId) : undefined;

    if (existingLead) {
      // This deal exists in DB (either created by V1 or matched to Google Drive)
      // Not a dedup — it's an actual record
      continue;
    }

    // This deal does NOT have a lead with its hubspot_deal_id.
    // Check if it was deduped against an existing record by name.
    // Try to find what it would have matched against.
    let matchedLeadId = '';
    let matchedName = '';
    let matchType = '';
    let confidence = '';
    let flag = '';

    // Check projects first
    let foundMatch = false;
    for (const proj of projects) {
      const result = namesMatchV2(dealName, proj.customer_name);
      if (result.matches) {
        matchedLeadId = proj.lead_id;
        matchedName = proj.customer_name;
        matchType = result.method;
        confidence = result.confidence;

        // Flag suspicious matches
        if (result.confidence === 'low') flag = 'REVIEW';
        if (dealName.length < 6 && result.method !== 'exact') flag = 'REVIEW';
        if (result.method === 'substring' && Math.abs(dealName.length - proj.customer_name.length) > 10) flag = 'REVIEW';

        // Size mismatch check
        if (sizeKwp && proj.system_size_kwp) {
          const ratio = Math.abs(sizeKwp - proj.system_size_kwp) / Math.max(sizeKwp, proj.system_size_kwp);
          if (ratio > 0.3) flag = 'REVIEW_SIZE_MISMATCH';
        }

        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      // Check leads
      for (const lead of leads) {
        const result = namesMatchV2(dealName, lead.customer_name);
        if (result.matches) {
          matchedLeadId = lead.id;
          matchedName = lead.customer_name;
          matchType = result.method;
          confidence = result.confidence;

          if (result.confidence === 'low') flag = 'REVIEW';
          if (dealName.length < 6 && result.method !== 'exact') flag = 'REVIEW';

          foundMatch = true;
          break;
        }
      }
    }

    if (!foundMatch) {
      // This deal wasn't deduped and doesn't have a lead — it may have been inserted as a new lead
      // without hubspot_deal_id being set. Skip from audit.
      continue;
    }

    totalDeduped++;
    if (flag) flagged++;

    // Escape CSV fields
    const escapeCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;
    auditRows.push([
      escapeCsv(recordId || ''),
      escapeCsv(dealName),
      escapeCsv(pvStr),
      escapeCsv(stage),
      escapeCsv(matchedLeadId),
      escapeCsv(matchedName),
      escapeCsv(matchType),
      escapeCsv(confidence),
      escapeCsv(flag),
    ].join(','));
  }

  // Write CSV report
  const reportPath = resolve(__dirname, 'data/dedup-audit-report.csv');
  writeFileSync(reportPath, auditRows.join('\n'), 'utf-8');

  console.log(`${op} ✅ Dedup audit report written to: ${reportPath}`);
  console.log(`${op} Total deduped records audited: ${totalDeduped}`);
  console.log(`${op} Flagged for review: ${flagged}`);
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main(): Promise<void> {
  const op = '[fix-hubspot-v2]';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  HubSpot Migration V2 Fix — ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  const supabase = initSupabase();

  // Phase 1: Fix stage mappings
  await fixStageMappings(supabase);

  // Phase 2: Fix unmatched payments
  await fixUnmatchedPayments(supabase);

  // Phase 3: Dedup audit report
  await generateDedupAudit(supabase);

  // Final verification
  console.log(`\n${op} === Final DB State ===`);
  const { count: leadCount } = await supabase.from('leads').select('*', { count: 'exact', head: true });
  const { count: propCount } = await supabase.from('proposals').select('*', { count: 'exact', head: true });
  const { count: projCount } = await supabase.from('projects').select('*', { count: 'exact', head: true });
  const { count: payCount } = await supabase.from('customer_payments').select('*', { count: 'exact', head: true });
  console.log(`  Leads:      ${leadCount}`);
  console.log(`  Proposals:  ${propCount}`);
  console.log(`  Projects:   ${projCount}`);
  console.log(`  Payments:   ${payCount}`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  HubSpot Migration V2 Fix — COMPLETE`);
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
  console.error('[fix-hubspot-v2] Fatal error:', err);
  process.exit(1);
});
