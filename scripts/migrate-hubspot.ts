/**
 * HubSpot Comprehensive Migration Script
 *
 * Imports data from two HubSpot CSV exports:
 *   1. hubspot-deals.csv     — 1,210 deals from the Sales pipeline
 *   2. hubspot-payments-pending.csv — 65 payment records from the Payments pipeline
 *
 * Usage:
 *   npx tsx scripts/migrate-hubspot.ts --dry-run --phase deals      (mandatory first)
 *   npx tsx scripts/migrate-hubspot.ts --phase deals                (live run)
 *   npx tsx scripts/migrate-hubspot.ts --dry-run --phase payments   (mandatory first)
 *   npx tsx scripts/migrate-hubspot.ts --phase payments             (live run)
 *
 * Prerequisites:
 *   - CSV files placed in scripts/data/
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
 *   - Existing data from Google Drive migration (146 leads, 164 projects, 164 proposals)
 *
 * IMPORTANT: This script is IDEMPOTENT — running twice will not create duplicates.
 * Dedup by: hubspot_deal_id → PV number → customer_name similarity.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load .env.local manually (no dotenv dependency — read and parse inline)
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
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
import {
  isDryRun,
  logMigrationStart,
  logMigrationEnd,
} from './migration-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CustomerSegment = 'residential' | 'commercial' | 'industrial';
type LeadSource = 'referral' | 'website' | 'builder_tie_up' | 'channel_partner' | 'cold_call' | 'exhibition' | 'social_media' | 'walkin';
type LeadStatus = 'new' | 'contacted' | 'site_survey_scheduled' | 'site_survey_done' | 'proposal_sent' | 'negotiation' | 'won' | 'lost' | 'on_hold' | 'disqualified';
type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'negotiating' | 'accepted' | 'rejected' | 'expired' | 'superseded';
type ProjectStatus = 'advance_received' | 'planning' | 'material_procurement' | 'installation' | 'electrical_work' | 'testing' | 'commissioned' | 'net_metering_pending' | 'completed' | 'on_hold' | 'cancelled';
type SystemType = 'on_grid' | 'hybrid' | 'off_grid';

interface HubSpotDeal {
  'Record ID': string;
  'Deal Name': string;
  'Category': string;
  'Deal Stage': string;
  'Project Size': string;
  'Quote ID': string;
  'Deal Description': string;
  'Deal owner': string;
  'Priority': string;
  'Create Date': string;
  'Close Date': string;
  'Received Amount': string;
  'Total Project Value': string;
  'Next step': string;
  [key: string]: string;
}

interface HubSpotPayment {
  'Record ID': string;
  'Deal Name': string;
  'Deal Stage': string;
  'Quote ID': string;
  'Amount': string;
  'Total Project Value': string;
  'Project Size': string;
  [key: string]: string;
}

interface ExistingLead {
  id: string;
  customer_name: string;
  hubspot_deal_id: string | null;
  estimated_size_kwp: number | null;
}

interface ExistingProject {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  lead_id: string;
}

interface ExistingProposal {
  id: string;
  proposal_number: string;
  lead_id: string;
}

interface MigrationStats {
  processed: number;
  leadsInserted: number;
  leadsSkipped: number;
  proposalsInserted: number;
  proposalsSkipped: number;
  projectsInserted: number;
  projectsSkipped: number;
  paymentsInserted: number;
  paymentsSkipped: number;
  errors: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'migrate-hubspot';
const DEALS_CSV = resolve(__dirname, 'data/hubspot-deals.csv');
const PAYMENTS_CSV = resolve(__dirname, 'data/hubspot-payments-pending.csv');

/** Map HubSpot Category → customer_segment enum */
const CATEGORY_TO_SEGMENT: Record<string, CustomerSegment> = {
  'Individual': 'residential',
  'Residential': 'residential',
  'Real Estate': 'commercial',
  'Commercial': 'commercial',
  'Industry': 'industrial',
  'Industrial': 'industrial',
  'Association': 'commercial',
  'Schools': 'commercial',
  'School': 'commercial',
  'Hospital': 'commercial',
  'Hospitals': 'commercial',
  'Government': 'commercial',
  'Trust': 'commercial',
};

/** Map HubSpot Deal Stage → lead_status enum */
const STAGE_TO_STATUS: Record<string, LeadStatus> = {
  'To check': 'new',
  'Appointment Scheduled': 'new',
  'Appointment scheduled': 'new',
  'Site visit Completed': 'site_survey_done',
  'Site Visit Completed': 'site_survey_done',
  'Proposal Sent': 'proposal_sent',
  'Design Confirmation': 'proposal_sent',
  'Negotiation': 'negotiation',
  'Final Negotiation': 'negotiation',
  'Closed Won': 'won',
  'Closed Lost to Competition': 'lost',
  'Closed Didnt do': 'lost',
  'Closed Later': 'lost',
  'Closed lost to competition': 'lost',
  'Closed didnt do': 'lost',
  'Closed later': 'lost',
};

/** Map HubSpot Deal owner → employee UUIDs (populated at runtime if needed) */
const DEAL_OWNER_MAP: Record<string, string | null> = {
  'Prem .': null,         // Will be resolved from employees table
  'Prem': null,
  'Vivek Sridhar': null,  // Will be resolved from employees table
  'Vivek': null,
};

// System employee ID for migration-created records (prepared_by, recorded_by)
// This will be resolved at runtime from the employees table
let SYSTEM_EMPLOYEE_ID: string | null = null;

// ---------------------------------------------------------------------------
// CSV Parser — handles quoted fields with commas and embedded newlines
// ---------------------------------------------------------------------------

function parseCSVRobust(csvContent: string): Record<string, string>[] {
  const op = '[parseCSVRobust]';
  const records: Record<string, string>[] = [];
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  // Split into logical lines (handling quoted newlines)
  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];

    if (char === '"') {
      // Check for escaped quote ("")
      if (inQuotes && i + 1 < csvContent.length && csvContent[i + 1] === '"') {
        currentLine += '""';
        i++; // skip next quote
        continue;
      }
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && i + 1 < csvContent.length && csvContent[i + 1] === '\n') {
        i++; // skip \n after \r
      }
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  if (lines.length < 2) {
    console.warn(`${op} CSV has fewer than 2 lines (header + data)`);
    return [];
  }

  const headers = parseCSVLine(lines[0]);
  console.log(`${op} Parsed ${headers.length} columns: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? '...' : ''}`);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((header, j) => {
      record[header] = (values[j] ?? '').trim();
    });
    records.push(record);
  }

  console.log(`${op} Parsed ${records.length} records from CSV`);
  return records;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.trim());

  // Strip surrounding quotes from each field
  return fields.map(f => {
    if (f.startsWith('"') && f.endsWith('"')) {
      return f.slice(1, -1).replace(/""/g, '"');
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Quote ID (PV number) Parser
// ---------------------------------------------------------------------------

interface ParsedPV {
  pvNumber: number;
  fy: string; // e.g. "24", "25-26"
  raw: string;
}

/**
 * Parse PV number from HubSpot Quote ID field.
 *
 * Formats encountered:
 *   - "PV49/24 Customer Name"
 *   - "PV008/25-26 Name"
 *   - "<p>PV321/25-26&nbsp;</p>"
 *   - "PV 123/24-25"
 *   - Multiple PV numbers separated by commas or newlines
 *
 * Returns the first valid PV number found, or null.
 */
function parsePVNumber(quoteId: string): ParsedPV | null {
  const op = '[parsePVNumber]';
  if (!quoteId || !quoteId.trim()) return null;

  // Strip HTML tags and entities
  let cleaned = quoteId
    .replace(/<[^>]*>/g, '')       // remove HTML tags
    .replace(/&nbsp;/gi, ' ')      // replace &nbsp;
    .replace(/&amp;/gi, '&')       // replace &amp;
    .replace(/&#\d+;/g, '')        // remove numeric entities
    .trim();

  // Match pattern: PV followed by optional space, then digits, slash, FY
  const match = cleaned.match(/PV\s*(\d+)\s*\/\s*(\d{2}(?:-\d{2})?)/i);
  if (!match) {
    return null;
  }

  const pvNumber = parseInt(match[1], 10);
  const fy = match[2];

  return { pvNumber, fy, raw: cleaned };
}

/**
 * Normalize FY to two-digit format for comparison.
 * "24" → "24", "25-26" → "25-26", "2025-26" → "25-26"
 */
function normalizeFY(fy: string): string {
  if (/^\d{4}-\d{2}$/.test(fy)) {
    return fy.slice(2); // "2025-26" → "25-26"
  }
  return fy;
}

/**
 * Get financial year string for a date.
 * April 1 boundary. Returns "2025-26" format.
 */
function getFinancialYear(date: Date): string {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  if (month >= 3) { // April onwards
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Customer Name Matching
// ---------------------------------------------------------------------------

/**
 * Normalize a customer name for fuzzy comparison.
 * Strips common prefixes (Mr, Mrs, Dr), lowercases, removes extra spaces.
 */
function normalizeCustomerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two customer names are similar enough to be the same person.
 * Uses substring containment + Levenshtein for short names.
 */
function namesMatch(a: string, b: string): boolean {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);

  if (!na || !nb) return false;

  // Exact match after normalization
  if (na === nb) return true;

  // One contains the other (handles "Vivek" matching "Vivek Sridhar")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Levenshtein distance for short names (typo tolerance)
  if (na.length <= 20 && nb.length <= 20) {
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    // Allow ~15% edit distance
    if (dist <= Math.ceil(maxLen * 0.15)) return true;
  }

  return false;
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

// ---------------------------------------------------------------------------
// Google Drive Link Extractor
// ---------------------------------------------------------------------------

function extractGoogleDriveNote(description: string): string | null {
  if (!description || !description.trim()) return null;

  // Strip HTML
  const cleaned = description
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  // Check for Google Drive links
  const driveMatch = cleaned.match(/https?:\/\/drive\.google\.com[^\s)"]*/);
  if (driveMatch) {
    return `[Google Drive] ${driveMatch[0]}`;
  }

  // Check for any URL
  const urlMatch = cleaned.match(/https?:\/\/[^\s)"]+/);
  if (urlMatch) {
    return `[Link] ${urlMatch[0]}`;
  }

  // Return plain text if short enough
  if (cleaned.length <= 500) {
    return cleaned;
  }

  return cleaned.slice(0, 497) + '...';
}

// ---------------------------------------------------------------------------
// Date Parsing
// ---------------------------------------------------------------------------

/**
 * Parse HubSpot date formats into ISO string.
 * HubSpot exports dates as "2024-03-15", "03/15/2024", "March 15, 2024", etc.
 */
function parseHubSpotDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  const cleaned = dateStr.trim();

  // Already ISO format: 2024-03-15
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // MM/DD/YYYY format
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const d = new Date(`${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Try native Date parsing as fallback
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

// ---------------------------------------------------------------------------
// Parse Amount
// ---------------------------------------------------------------------------

function parseAmount(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) return null;

  // Strip currency symbols, commas, spaces
  const cleaned = amountStr
    .replace(/[₹$,\s]/g, '')
    .replace(/INR/gi, '')
    .trim();

  if (!cleaned) return null;

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;

  return num;
}

// ---------------------------------------------------------------------------
// Segment from category
// ---------------------------------------------------------------------------

function mapSegment(category: string): CustomerSegment {
  if (!category) return 'residential';
  const normalized = category.trim();
  return CATEGORY_TO_SEGMENT[normalized] ?? 'residential';
}

// ---------------------------------------------------------------------------
// Deal Stage to Lead Status
// ---------------------------------------------------------------------------

function mapDealStage(stage: string): { status: LeadStatus; isWon: boolean; isLost: boolean } {
  if (!stage) return { status: 'new', isWon: false, isLost: false };

  const normalized = stage.trim();
  const status = STAGE_TO_STATUS[normalized] ?? 'new';
  const isWon = normalized === 'Closed Won';
  const isLost = ['Closed Lost to Competition', 'Closed Didnt do', 'Closed Later',
    'Closed lost to competition', 'Closed didnt do', 'Closed later'].includes(normalized);

  return { status, isWon, isLost };
}

// ---------------------------------------------------------------------------
// Build Notes String
// ---------------------------------------------------------------------------

function buildNotes(deal: HubSpotDeal): string | null {
  const parts: string[] = [];

  // Google Drive link from description
  const driveNote = extractGoogleDriveNote(deal['Deal Description']);
  if (driveNote) parts.push(driveNote);

  // Priority
  if (deal['Priority'] && deal['Priority'].trim()) {
    parts.push(`Priority: ${deal['Priority'].trim()}`);
  }

  // Next step
  if (deal['Next step'] && deal['Next step'].trim()) {
    parts.push(`Next step: ${deal['Next step'].trim()}`);
  }

  // PV number for reference
  const pv = parsePVNumber(deal['Quote ID']);
  if (pv) {
    parts.push(`HubSpot PV: PV${pv.pvNumber}/${pv.fy}`);
  }

  // Total project value if present
  const tpv = parseAmount(deal['Total Project Value']);
  if (tpv && tpv > 0) {
    parts.push(`HubSpot Total Project Value: ₹${tpv.toLocaleString('en-IN')}`);
  }

  // Received amount if present
  const ra = parseAmount(deal['Received Amount']);
  if (ra && ra > 0) {
    parts.push(`HubSpot Received Amount: ₹${ra.toLocaleString('en-IN')}`);
  }

  if (parts.length === 0) return null;
  return `[HubSpot Migration] ${parts.join(' | ')}`;
}

// ---------------------------------------------------------------------------
// Supabase Initialization
// ---------------------------------------------------------------------------

function initSupabase(): SupabaseClient {
  const op = '[initSupabase]';

  // Load .env.local from project root
  const envPath = resolve(__dirname, '..', '.env.local');
  loadEnvFile(envPath);
  console.log(`${op} Loaded environment from .env.local`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    console.error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL`);
    process.exit(1);
  }
  if (!supabaseKey) {
    console.error(`${op} Missing SUPABASE_SECRET_KEY`);
    process.exit(1);
  }

  console.log(`${op} Connecting to ${supabaseUrl}`);

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Load Existing Data for Dedup
// ---------------------------------------------------------------------------

async function loadExistingLeads(supabase: SupabaseClient): Promise<ExistingLead[]> {
  const op = '[loadExistingLeads]';
  const allLeads: ExistingLead[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, customer_name, hubspot_deal_id, estimated_size_kwp')
      .is('deleted_at', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`${op} Failed to load leads:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load existing leads: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`${op} Loaded ${allLeads.length} existing leads`);
  return allLeads;
}

async function loadExistingProjects(supabase: SupabaseClient): Promise<ExistingProject[]> {
  const op = '[loadExistingProjects]';
  const allProjects: ExistingProject[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_number, customer_name, system_size_kwp, lead_id')
      .is('deleted_at', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`${op} Failed to load projects:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load existing projects: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    allProjects.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`${op} Loaded ${allProjects.length} existing projects`);
  return allProjects;
}

async function loadExistingProposals(supabase: SupabaseClient): Promise<ExistingProposal[]> {
  const op = '[loadExistingProposals]';
  const allProposals: ExistingProposal[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('proposals')
      .select('id, proposal_number, lead_id')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`${op} Failed to load proposals:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load existing proposals: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    allProposals.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`${op} Loaded ${allProposals.length} existing proposals`);
  return allProposals;
}

/**
 * Resolve employee IDs for deal owners and system user.
 */
async function resolveEmployeeIds(supabase: SupabaseClient): Promise<void> {
  const op = '[resolveEmployeeIds]';

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true);

  if (error) {
    console.warn(`${op} Could not load employees:`, { code: error.code, message: error.message });
    return;
  }

  if (!employees || employees.length === 0) {
    console.warn(`${op} No employees found — will use null for assigned_to`);
    return;
  }

  for (const emp of employees) {
    const fullName = emp.full_name ?? '';

    // Try to match deal owners
    if (fullName.toLowerCase().includes('prem')) {
      DEAL_OWNER_MAP['Prem .'] = emp.id;
      DEAL_OWNER_MAP['Prem'] = emp.id;
    }
    if (fullName.toLowerCase().includes('vivek')) {
      DEAL_OWNER_MAP['Vivek Sridhar'] = emp.id;
      DEAL_OWNER_MAP['Vivek'] = emp.id;
      // Vivek is also the system/founder user for prepared_by
      SYSTEM_EMPLOYEE_ID = emp.id;
    }
  }

  // Fallback: use the first employee if no Vivek found
  if (!SYSTEM_EMPLOYEE_ID && employees.length > 0) {
    SYSTEM_EMPLOYEE_ID = employees[0].id;
    console.warn(`${op} No 'Vivek' found — using ${employees[0].full_name} as system user`);
  }

  console.log(`${op} Resolved employee IDs — system user: ${SYSTEM_EMPLOYEE_ID ? 'found' : 'NOT FOUND'}`);
}

// ---------------------------------------------------------------------------
// Dedup Logic
// ---------------------------------------------------------------------------

interface DedupResult {
  existingLeadId: string | null;
  existingProjectId: string | null;
  matchMethod: 'hubspot_deal_id' | 'pv_number' | 'customer_name' | 'none';
}

function findExistingMatch(
  deal: HubSpotDeal,
  existingLeads: ExistingLead[],
  existingProjects: ExistingProject[],
  pvInfo: ParsedPV | null,
): DedupResult {
  const dealId = deal['Record ID']?.trim();
  const dealName = deal['Deal Name']?.trim();
  const dealSizeKwp = parseFloat(deal['Project Size'] || '0') || null;

  // 1. Match by hubspot_deal_id
  if (dealId) {
    const leadMatch = existingLeads.find(l => l.hubspot_deal_id === dealId);
    if (leadMatch) {
      return { existingLeadId: leadMatch.id, existingProjectId: null, matchMethod: 'hubspot_deal_id' };
    }
  }

  // 2. Match by customer_name + system_size (for existing projects from Google Drive)
  if (dealName) {
    for (const proj of existingProjects) {
      if (namesMatch(dealName, proj.customer_name)) {
        // If both have size, check they're similar (within 20%)
        if (dealSizeKwp && proj.system_size_kwp) {
          const ratio = Math.abs(dealSizeKwp - proj.system_size_kwp) / Math.max(dealSizeKwp, proj.system_size_kwp);
          if (ratio <= 0.2) {
            return { existingLeadId: proj.lead_id, existingProjectId: proj.id, matchMethod: 'customer_name' };
          }
        } else {
          // No size to compare — name match alone is enough
          return { existingLeadId: proj.lead_id, existingProjectId: proj.id, matchMethod: 'customer_name' };
        }
      }
    }
  }

  // 3. Match by customer_name against existing leads (for non-won deals)
  if (dealName) {
    const leadMatch = existingLeads.find(l => namesMatch(dealName, l.customer_name));
    if (leadMatch) {
      return { existingLeadId: leadMatch.id, existingProjectId: null, matchMethod: 'customer_name' };
    }
  }

  return { existingLeadId: null, existingProjectId: null, matchMethod: 'none' };
}

// ---------------------------------------------------------------------------
// Generate Next Project Number
// ---------------------------------------------------------------------------

/**
 * Determine the next project number by checking existing max.
 * Format: SHIROI/PROJ/2025-26/NNNN
 */
async function getNextProjectNumber(supabase: SupabaseClient): Promise<{ generate: () => string; currentMax: number }> {
  const op = '[getNextProjectNumber]';
  const fy = getFinancialYear(new Date());

  const { data, error } = await supabase
    .from('projects')
    .select('project_number')
    .like('project_number', `SHIROI/PROJ/${fy}/%`)
    .order('project_number', { ascending: false })
    .limit(1);

  let currentMax = 0;
  if (!error && data && data.length > 0) {
    const match = data[0].project_number.match(/(\d+)$/);
    if (match) currentMax = parseInt(match[1], 10);
  }

  console.log(`${op} Current max project number: SHIROI/PROJ/${fy}/${String(currentMax).padStart(4, '0')}`);

  let counter = currentMax;
  return {
    currentMax,
    generate: () => {
      counter++;
      return `SHIROI/PROJ/${fy}/${String(counter).padStart(4, '0')}`;
    },
  };
}

/**
 * Determine the next proposal number by checking existing max.
 * Format: SHIROI/PROP/2025-26/NNNN
 */
async function getNextProposalNumber(supabase: SupabaseClient): Promise<{ generate: () => string }> {
  const op = '[getNextProposalNumber]';
  const fy = getFinancialYear(new Date());

  const { data, error } = await supabase
    .from('proposals')
    .select('proposal_number')
    .like('proposal_number', `SHIROI/PROP/${fy}/%`)
    .order('proposal_number', { ascending: false })
    .limit(1);

  let currentMax = 0;
  if (!error && data && data.length > 0) {
    const match = data[0].proposal_number.match(/(\d+)$/);
    if (match) currentMax = parseInt(match[1], 10);
  }

  console.log(`${op} Current max proposal number: SHIROI/PROP/${fy}/${String(currentMax).padStart(4, '0')}`);

  let counter = currentMax;
  return {
    generate: () => {
      counter++;
      return `SHIROI/PROP/${fy}/${String(counter).padStart(4, '0')}`;
    },
  };
}

/**
 * Generate next receipt number for payments.
 * Format: SHIROI/REC/2025-26/NNNN
 */
async function getNextReceiptNumber(supabase: SupabaseClient): Promise<{ generate: () => string }> {
  const op = '[getNextReceiptNumber]';
  const fy = getFinancialYear(new Date());

  const { data, error } = await supabase
    .from('customer_payments')
    .select('receipt_number')
    .like('receipt_number', `SHIROI/REC/${fy}/%`)
    .order('receipt_number', { ascending: false })
    .limit(1);

  let currentMax = 0;
  if (!error && data && data.length > 0) {
    const match = data[0].receipt_number.match(/(\d+)$/);
    if (match) currentMax = parseInt(match[1], 10);
  }

  console.log(`${op} Current max receipt number: SHIROI/REC/${fy}/${String(currentMax).padStart(4, '0')}`);

  let counter = currentMax;
  return {
    generate: () => {
      counter++;
      return `SHIROI/REC/${fy}/${String(counter).padStart(4, '0')}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Deals Migration
// ---------------------------------------------------------------------------

async function migrateDeals(): Promise<void> {
  const op = '[migrate-hubspot:deals]';
  const dryRun = isDryRun();

  console.log(`\n${op} Starting deals migration...`);

  // Read CSV
  if (!existsSync(DEALS_CSV)) {
    console.error(`${op} CSV file not found: ${DEALS_CSV}`);
    console.error(`${op} Export from HubSpot and place at: scripts/data/hubspot-deals.csv`);
    process.exit(1);
  }

  const csvContent = readFileSync(DEALS_CSV, 'utf-8');
  const records = parseCSVRobust(csvContent) as HubSpotDeal[];
  logMigrationStart('HubSpot Deals Migration', records.length);

  // Analyze the data first
  const stageBreakdown = new Map<string, number>();
  const categoryBreakdown = new Map<string, number>();
  let withPV = 0;
  let withSize = 0;
  let withProjectValue = 0;

  for (const deal of records) {
    const stage = deal['Deal Stage']?.trim() || 'EMPTY';
    stageBreakdown.set(stage, (stageBreakdown.get(stage) ?? 0) + 1);

    const cat = deal['Category']?.trim() || 'EMPTY';
    categoryBreakdown.set(cat, (categoryBreakdown.get(cat) ?? 0) + 1);

    if (parsePVNumber(deal['Quote ID'])) withPV++;
    if (parseFloat(deal['Project Size'] || '0') > 0) withSize++;
    if (parseAmount(deal['Total Project Value'])) withProjectValue++;
  }

  console.log(`\n${op} --- Deal Stage Breakdown ---`);
  for (const [stage, count] of [...stageBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    const mapped = mapDealStage(stage);
    console.log(`  ${stage}: ${count} → status: ${mapped.status}${mapped.isWon ? ' [CREATE PROJECT]' : ''}${mapped.isLost ? ' [LOST]' : ''}`);
  }

  console.log(`\n${op} --- Category Breakdown ---`);
  for (const [cat, count] of [...categoryBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count} → segment: ${mapSegment(cat)}`);
  }

  console.log(`\n${op} --- Data Coverage ---`);
  console.log(`  With PV number:      ${withPV}/${records.length} (${((withPV / records.length) * 100).toFixed(1)}%)`);
  console.log(`  With Project Size:   ${withSize}/${records.length} (${((withSize / records.length) * 100).toFixed(1)}%)`);
  console.log(`  With Project Value:  ${withProjectValue}/${records.length} (${((withProjectValue / records.length) * 100).toFixed(1)}%)`);

  // Sample first 5 records
  console.log(`\n${op} --- Sample Records ---`);
  for (const deal of records.slice(0, 5)) {
    const pv = parsePVNumber(deal['Quote ID']);
    console.log(`  Record ID: ${deal['Record ID']}`);
    console.log(`    Name: ${deal['Deal Name']}`);
    console.log(`    Stage: ${deal['Deal Stage']} → ${mapDealStage(deal['Deal Stage']).status}`);
    console.log(`    Category: ${deal['Category']} → ${mapSegment(deal['Category'])}`);
    console.log(`    PV: ${pv ? `PV${pv.pvNumber}/${pv.fy}` : '(none)'}`);
    console.log(`    Size: ${deal['Project Size'] || '(none)'} kWp`);
    console.log(`    Created: ${deal['Create Date']}`);
    console.log('');
  }

  if (dryRun) {
    const wonCount = records.filter(d => mapDealStage(d['Deal Stage']).isWon).length;
    const lostCount = records.filter(d => mapDealStage(d['Deal Stage']).isLost).length;
    const openCount = records.length - wonCount - lostCount;

    console.log(`\n${op} DRY RUN SUMMARY:`);
    console.log(`  Total deals:     ${records.length}`);
    console.log(`  Won (→ lead+proposal+project): ${wonCount}`);
    console.log(`  Lost (→ lead only):            ${lostCount}`);
    console.log(`  Open (→ lead only):            ${openCount}`);
    console.log(`  Would create up to ${records.length} leads, ${wonCount} proposals, ${wonCount} projects`);
    console.log(`  (Minus dedup matches — run live to see exact numbers)`);

    logMigrationEnd('HubSpot Deals Migration (DRY RUN)', {
      processed: records.length,
      inserted: 0,
      skipped: 0,
      errors: 0,
    });
    return;
  }

  // ----- LIVE RUN -----
  const supabase = initSupabase();
  await resolveEmployeeIds(supabase);

  if (!SYSTEM_EMPLOYEE_ID) {
    console.error(`${op} Cannot proceed without a system employee ID for prepared_by field`);
    process.exit(1);
  }

  // Load existing data for dedup
  const existingLeads = await loadExistingLeads(supabase);
  const existingProjects = await loadExistingProjects(supabase);

  // Build dedup indexes
  const hubspotIdIndex = new Map<string, string>();
  for (const lead of existingLeads) {
    if (lead.hubspot_deal_id) {
      hubspotIdIndex.set(lead.hubspot_deal_id, lead.id);
    }
  }

  // Get number generators
  const projNumGen = await getNextProjectNumber(supabase);
  const propNumGen = await getNextProposalNumber(supabase);

  const stats: MigrationStats = {
    processed: 0,
    leadsInserted: 0,
    leadsSkipped: 0,
    proposalsInserted: 0,
    proposalsSkipped: 0,
    projectsInserted: 0,
    projectsSkipped: 0,
    paymentsInserted: 0,
    paymentsSkipped: 0,
    errors: 0,
    warnings: [],
  };

  // Track inserted hubspot IDs this run (for within-run dedup)
  const insertedDealIds = new Set<string>();

  for (const deal of records) {
    stats.processed++;
    const dealId = deal['Record ID']?.trim();
    const dealName = deal['Deal Name']?.trim();

    if (!dealName) {
      stats.warnings.push(`Record ${dealId}: No deal name, skipping`);
      stats.leadsSkipped++;
      continue;
    }

    // Within-run dedup
    if (dealId && insertedDealIds.has(dealId)) {
      stats.leadsSkipped++;
      continue;
    }

    try {
      const pvInfo = parsePVNumber(deal['Quote ID']);
      const { status, isWon, isLost } = mapDealStage(deal['Deal Stage']);
      const segment = mapSegment(deal['Category']);

      // Check dedup
      const dedup = findExistingMatch(deal, existingLeads, existingProjects, pvInfo);

      if (dedup.existingLeadId) {
        // Already exists — update hubspot_deal_id if missing
        if (dealId) {
          const existingLead = existingLeads.find(l => l.id === dedup.existingLeadId);
          if (existingLead && !existingLead.hubspot_deal_id) {
            const { error } = await supabase
              .from('leads')
              .update({ hubspot_deal_id: dealId })
              .eq('id', dedup.existingLeadId);

            if (error) {
              console.warn(`${op} Could not update hubspot_deal_id for lead ${dedup.existingLeadId}:`, error.message);
            } else {
              existingLead.hubspot_deal_id = dealId; // update in-memory
            }
          }
        }

        stats.leadsSkipped++;
        if (isWon) {
          stats.proposalsSkipped++;
          stats.projectsSkipped++;
        }
        if (stats.processed % 100 === 0) {
          console.log(`${op} Progress: ${stats.processed}/${records.length} (skipped: ${dedup.matchMethod})`);
        }
        continue;
      }

      // --- Create Lead ---
      const leadId = crypto.randomUUID();
      const createdAt = parseHubSpotDate(deal['Create Date']) ?? new Date().toISOString();
      const notes = buildNotes(deal);
      const sizeKwp = parseFloat(deal['Project Size'] || '0') || null;
      const dealOwner = deal['Deal owner']?.trim();
      const assignedTo = dealOwner ? (DEAL_OWNER_MAP[dealOwner] ?? null) : null;

      // Generate a dummy phone for HubSpot deals (phone not in deals export)
      // Use Record ID as placeholder since HubSpot deals don't have phone numbers
      const placeholderPhone = `9999${dealId?.padStart(6, '0').slice(-6) ?? '000000'}`;

      const leadInsert = {
        id: leadId,
        customer_name: dealName,
        phone: placeholderPhone,
        segment: segment,
        source: 'website' as LeadSource, // HubSpot deals don't specify source
        status: status,
        estimated_size_kwp: sizeKwp,
        hubspot_deal_id: dealId || null,
        notes: notes,
        assigned_to: assignedTo,
        city: 'Chennai',
        state: 'Tamil Nadu',
        created_at: createdAt,
        converted_to_project: isWon,
        converted_at: isWon ? (parseHubSpotDate(deal['Close Date']) ?? createdAt) : null,
      };

      const { error: leadError } = await supabase.from('leads').insert(leadInsert);

      if (leadError) {
        // Check for phone uniqueness violation
        if (leadError.code === '23505' && leadError.message.includes('phone')) {
          // Phone conflict — try with a different placeholder
          const altPhone = `9998${dealId?.padStart(6, '0').slice(-6) ?? '000000'}`;
          leadInsert.phone = altPhone;
          const { error: retryError } = await supabase.from('leads').insert(leadInsert);
          if (retryError) {
            console.error(`${op} Lead insert failed (retry) for "${dealName}":`, {
              code: retryError.code, message: retryError.message,
            });
            stats.errors++;
            continue;
          }
        } else {
          console.error(`${op} Lead insert failed for "${dealName}":`, {
            code: leadError.code, message: leadError.message,
          });
          stats.errors++;
          continue;
        }
      }

      stats.leadsInserted++;
      if (dealId) insertedDealIds.add(dealId);

      // Add to existing leads for subsequent dedup
      existingLeads.push({
        id: leadId,
        customer_name: dealName,
        hubspot_deal_id: dealId || null,
        estimated_size_kwp: sizeKwp,
      });

      // --- For Won Deals: Create Proposal + Project ---
      if (isWon) {
        const proposalId = crypto.randomUUID();
        const proposalNumber = propNumGen.generate();
        const closeDate = parseHubSpotDate(deal['Close Date']) ?? createdAt;
        let totalProjectValue = parseAmount(deal['Total Project Value']) ?? 0;
        const systemSizeKwp = sizeKwp ?? 5; // Default 5 kWp if unknown

        // Sanity check: HubSpot's Total Project Value is unreliable for some deals.
        // Anything > ₹5L/kWp is implausible. Drop the value and note it; the row
        // will surface in the UI banner as "needs re-quote".
        const MAX_PLAUSIBLE_PER_KWP = 500_000;
        let droppedTpvNote: string | null = null;
        if (totalProjectValue > systemSizeKwp * MAX_PLAUSIBLE_PER_KWP) {
          droppedTpvNote = `Original HubSpot TPV ₹${totalProjectValue} dropped — implausible for ${systemSizeKwp} kWp.`;
          console.warn(`${op} ${droppedTpvNote} Deal: "${dealName}" (${dealId})`);
          totalProjectValue = 0;
        }
        const validUntil = new Date(new Date(closeDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const proposalInsert = {
          id: proposalId,
          lead_id: leadId,
          proposal_number: proposalNumber,
          system_size_kwp: systemSizeKwp,
          system_type: 'on_grid' as SystemType, // Default — HubSpot doesn't specify
          status: 'accepted' as ProposalStatus,
          prepared_by: SYSTEM_EMPLOYEE_ID!,
          valid_until: validUntil,
          total_before_discount: totalProjectValue,
          total_after_discount: totalProjectValue,
          shiroi_revenue: totalProjectValue,
          created_at: createdAt,
          hubspot_deal_id: dealId || null,
          notes: [
            `[HubSpot Migration] Won deal imported. PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'N/A'}`,
            droppedTpvNote ? `[Sanity check] ${droppedTpvNote}` : null,
          ].filter(Boolean).join(' | '),
        };

        const { error: propError } = await supabase.from('proposals').insert(proposalInsert);

        if (propError) {
          console.error(`${op} Proposal insert failed for "${dealName}":`, {
            code: propError.code, message: propError.message,
          });
          stats.errors++;
          // Still try to create project
        } else {
          stats.proposalsInserted++;
        }

        // --- Create Project ---
        const projectId = crypto.randomUUID();
        const projectNumber = projNumGen.generate();
        const contractedValue = totalProjectValue > 0 ? totalProjectValue : 0;

        const projectInsert = {
          id: projectId,
          lead_id: leadId,
          proposal_id: proposalId,
          project_number: projectNumber,
          customer_name: dealName,
          customer_phone: leadInsert.phone,
          system_size_kwp: systemSizeKwp,
          system_type: 'on_grid' as SystemType,
          contracted_value: contractedValue,
          advance_amount: 0,
          advance_received_at: closeDate,
          status: 'completed' as ProjectStatus, // Won deals → already completed
          site_address_line1: 'Address pending — HubSpot migration',
          site_city: 'Chennai',
          site_state: 'Tamil Nadu',
          panel_count: 0, // Unknown from HubSpot
          created_at: createdAt,
          notes: `[HubSpot Migration] Won deal imported as completed project. PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'N/A'}`,
        };

        const { error: projError } = await supabase.from('projects').insert(projectInsert);

        if (projError) {
          console.error(`${op} Project insert failed for "${dealName}":`, {
            code: projError.code, message: projError.message,
          });
          stats.errors++;
        } else {
          stats.projectsInserted++;

          // Add to existing projects for subsequent dedup
          existingProjects.push({
            id: projectId,
            project_number: projectNumber,
            customer_name: dealName,
            system_size_kwp: systemSizeKwp,
            lead_id: leadId,
          });
        }
      }

      if (stats.processed % 100 === 0) {
        console.log(`${op} Progress: ${stats.processed}/${records.length} — leads: +${stats.leadsInserted}, projects: +${stats.projectsInserted}, errors: ${stats.errors}`);
      }
    } catch (err) {
      console.error(`${op} Unexpected error for "${dealName}" (Record ID: ${dealId}):`, {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      stats.errors++;
    }
  }

  // Print warnings
  if (stats.warnings.length > 0) {
    console.log(`\n${op} --- Warnings (${stats.warnings.length}) ---`);
    for (const w of stats.warnings.slice(0, 20)) {
      console.log(`  ${w}`);
    }
    if (stats.warnings.length > 20) {
      console.log(`  ... and ${stats.warnings.length - 20} more`);
    }
  }

  console.log(`\n${op} --- Final Stats ---`);
  console.log(`  Leads inserted:     ${stats.leadsInserted}`);
  console.log(`  Leads skipped:      ${stats.leadsSkipped} (dedup)`);
  console.log(`  Proposals inserted: ${stats.proposalsInserted}`);
  console.log(`  Proposals skipped:  ${stats.proposalsSkipped}`);
  console.log(`  Projects inserted:  ${stats.projectsInserted}`);
  console.log(`  Projects skipped:   ${stats.projectsSkipped}`);
  console.log(`  Errors:             ${stats.errors}`);

  logMigrationEnd('HubSpot Deals Migration', {
    processed: stats.processed,
    inserted: stats.leadsInserted + stats.proposalsInserted + stats.projectsInserted,
    skipped: stats.leadsSkipped + stats.proposalsSkipped + stats.projectsSkipped,
    errors: stats.errors,
  });
}

// ---------------------------------------------------------------------------
// Phase 2: Payments Migration
// ---------------------------------------------------------------------------

async function migratePayments(): Promise<void> {
  const op = '[migrate-hubspot:payments]';
  const dryRun = isDryRun();

  console.log(`\n${op} Starting payments migration...`);

  // Read CSV
  if (!existsSync(PAYMENTS_CSV)) {
    console.error(`${op} CSV file not found: ${PAYMENTS_CSV}`);
    console.error(`${op} Export from HubSpot and place at: scripts/data/hubspot-payments-pending.csv`);
    process.exit(1);
  }

  const csvContent = readFileSync(PAYMENTS_CSV, 'utf-8');
  const records = parseCSVRobust(csvContent) as HubSpotPayment[];
  logMigrationStart('HubSpot Payments Migration', records.length);

  // Analyze
  const stageBreakdown = new Map<string, number>();
  let withAmount = 0;
  let withPV = 0;

  for (const rec of records) {
    const stage = rec['Deal Stage']?.trim() || 'EMPTY';
    stageBreakdown.set(stage, (stageBreakdown.get(stage) ?? 0) + 1);

    if (parseAmount(rec['Amount'])) withAmount++;
    if (parsePVNumber(rec['Quote ID'])) withPV++;
  }

  console.log(`\n${op} --- Payment Stage Breakdown ---`);
  for (const [stage, count] of [...stageBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage}: ${count}`);
  }

  console.log(`\n${op} --- Data Coverage ---`);
  console.log(`  With Amount:     ${withAmount}/${records.length}`);
  console.log(`  With PV number:  ${withPV}/${records.length}`);

  // Sample records
  console.log(`\n${op} --- Sample Records ---`);
  for (const rec of records.slice(0, 5)) {
    const pv = parsePVNumber(rec['Quote ID']);
    console.log(`  Record ID: ${rec['Record ID']}`);
    console.log(`    Name: ${rec['Deal Name']}`);
    console.log(`    Stage: ${rec['Deal Stage']}`);
    console.log(`    Amount: ${rec['Amount'] || '(none)'}`);
    console.log(`    PV: ${pv ? `PV${pv.pvNumber}/${pv.fy}` : '(none)'}`);
    console.log('');
  }

  if (dryRun) {
    console.log(`\n${op} DRY RUN SUMMARY:`);
    console.log(`  Total payment records: ${records.length}`);
    console.log(`  With amounts: ${withAmount}`);
    console.log(`  With PV for project matching: ${withPV}`);
    console.log(`  Would attempt to match each to existing projects and create payment tracking entries.`);

    logMigrationEnd('HubSpot Payments Migration (DRY RUN)', {
      processed: records.length,
      inserted: 0,
      skipped: 0,
      errors: 0,
    });
    return;
  }

  // ----- LIVE RUN -----
  const supabase = initSupabase();
  await resolveEmployeeIds(supabase);

  if (!SYSTEM_EMPLOYEE_ID) {
    console.error(`${op} Cannot proceed without a system employee ID for recorded_by field`);
    process.exit(1);
  }

  const existingProjects = await loadExistingProjects(supabase);
  const existingLeads = await loadExistingLeads(supabase);
  const receiptNumGen = await getNextReceiptNumber(supabase);

  /** Map payment deal stage to milestone type */
  const STAGE_TO_MILESTONE: Record<string, { label: string; isAdvance: boolean }> = {
    'Advance': { label: 'Advance payment', isAdvance: true },
    'Installation payment': { label: 'Installation payment', isAdvance: false },
    'Supply payment': { label: 'Supply/material payment', isAdvance: false },
    'Commissioning payment': { label: 'Commissioning payment', isAdvance: false },
    'Retention': { label: 'Retention/final payment', isAdvance: false },
  };

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let noProjectMatch = 0;
  const warnings: string[] = [];

  for (const rec of records) {
    processed++;
    const dealId = rec['Record ID']?.trim();
    const dealName = rec['Deal Name']?.trim();
    const stage = rec['Deal Stage']?.trim() || '';
    const amount = parseAmount(rec['Amount']);
    const pvInfo = parsePVNumber(rec['Quote ID']);

    if (!dealName) {
      warnings.push(`Record ${dealId}: No deal name, skipping`);
      skipped++;
      continue;
    }

    try {
      // Find matching project
      let matchedProjectId: string | null = null;
      let matchMethod = 'none';

      // Try PV number match against existing project names
      if (pvInfo && !matchedProjectId) {
        for (const proj of existingProjects) {
          if (namesMatch(dealName, proj.customer_name)) {
            matchedProjectId = proj.id;
            matchMethod = 'customer_name_from_payment';
            break;
          }
        }
      }

      // Try customer name match
      if (!matchedProjectId) {
        for (const proj of existingProjects) {
          if (namesMatch(dealName, proj.customer_name)) {
            matchedProjectId = proj.id;
            matchMethod = 'customer_name';
            break;
          }
        }
      }

      if (!matchedProjectId) {
        noProjectMatch++;
        warnings.push(`Record ${dealId} "${dealName}": No matching project found (PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'none'})`);
        skipped++;
        continue;
      }

      if (!amount || amount <= 0) {
        // No amount — record as a note on the project instead
        const milestoneInfo = STAGE_TO_MILESTONE[stage] ?? { label: stage, isAdvance: false };
        const noteText = `[HubSpot Payment Migration] ${milestoneInfo.label} pending — no amount specified. Deal: ${dealName}, Record ID: ${dealId}`;

        // Update project notes
        const { data: proj } = await supabase
          .from('projects')
          .select('notes')
          .eq('id', matchedProjectId)
          .single();

        const existingNotes = proj?.notes ?? '';
        const updatedNotes = existingNotes
          ? `${existingNotes}\n${noteText}`
          : noteText;

        const { error: updateError } = await supabase
          .from('projects')
          .update({ notes: updatedNotes })
          .eq('id', matchedProjectId);

        if (updateError) {
          console.warn(`${op} Could not update project notes for ${matchedProjectId}:`, updateError.message);
        }

        skipped++;
        continue;
      }

      // Create customer_payment entry
      const milestoneInfo = STAGE_TO_MILESTONE[stage] ?? { label: stage || 'Payment', isAdvance: false };
      const receiptNumber = receiptNumGen.generate();

      const paymentInsert = {
        id: crypto.randomUUID(),
        project_id: matchedProjectId,
        amount: amount,
        payment_date: new Date().toISOString().split('T')[0], // Today — actual date unknown from HubSpot
        payment_method: 'bank_transfer',
        receipt_number: receiptNumber,
        is_advance: milestoneInfo.isAdvance,
        recorded_by: SYSTEM_EMPLOYEE_ID!,
        notes: `[HubSpot Payment Migration] ${milestoneInfo.label}. Deal: ${dealName}, Record ID: ${dealId}, PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'N/A'}. Matched by: ${matchMethod}`,
      };

      const { error: payError } = await supabase
        .from('customer_payments')
        .insert(paymentInsert);

      if (payError) {
        console.error(`${op} Payment insert failed for "${dealName}":`, {
          code: payError.code, message: payError.message,
        });
        errors++;
      } else {
        inserted++;
      }
    } catch (err) {
      console.error(`${op} Unexpected error for "${dealName}" (Record ID: ${dealId}):`, {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      errors++;
    }
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log(`\n${op} --- Warnings (${warnings.length}) ---`);
    for (const w of warnings.slice(0, 30)) {
      console.log(`  ${w}`);
    }
    if (warnings.length > 30) {
      console.log(`  ... and ${warnings.length - 30} more`);
    }
  }

  console.log(`\n${op} --- Final Stats ---`);
  console.log(`  Payments inserted:   ${inserted}`);
  console.log(`  Skipped (no match):  ${noProjectMatch}`);
  console.log(`  Skipped (other):     ${skipped - noProjectMatch}`);
  console.log(`  Errors:              ${errors}`);

  logMigrationEnd('HubSpot Payments Migration', {
    processed,
    inserted,
    skipped,
    errors,
  });
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const op = '[migrate-hubspot]';

  // Parse --phase flag
  const phaseIndex = process.argv.indexOf('--phase');
  if (phaseIndex === -1 || !process.argv[phaseIndex + 1]) {
    console.error(`${op} Missing --phase flag. Usage:`);
    console.error(`  npx tsx scripts/migrate-hubspot.ts --dry-run --phase deals`);
    console.error(`  npx tsx scripts/migrate-hubspot.ts --phase deals`);
    console.error(`  npx tsx scripts/migrate-hubspot.ts --dry-run --phase payments`);
    console.error(`  npx tsx scripts/migrate-hubspot.ts --phase payments`);
    process.exit(1);
  }

  const phase = process.argv[phaseIndex + 1];
  const dryRun = isDryRun();

  console.log(`${op} Phase: ${phase}`);
  console.log(`${op} Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${op} Started at: ${new Date().toISOString()}`);

  switch (phase) {
    case 'deals':
      await migrateDeals();
      break;
    case 'payments':
      await migratePayments();
      break;
    default:
      console.error(`${op} Unknown phase: "${phase}". Must be "deals" or "payments".`);
      process.exit(1);
  }

  console.log(`\n${op} Finished at: ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error('[migrate-hubspot] Fatal error:', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});
