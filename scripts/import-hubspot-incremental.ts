/**
 * Incremental HubSpot import — 2026-05-02 export.
 *
 * Imports only deals that are NOT already linked to a lead/proposal/project in the
 * ERP. Filters out junk-tier 'To check' stage. Mirrors migrate-hubspot.ts patterns
 * but is targeted at the May 2 CSV at scripts/data/hubspot-exports/.
 *
 * What it does per missing deal:
 *   - Insert a row into `leads` (always)
 *   - For Closed Won: also insert into `proposals` (status=accepted) + `projects` (status=completed)
 *   - For Closed Lost / Closed Later: lead.status = 'lost'
 *   - For all others: lead.status maps from Deal Stage
 *
 * Safety flags set on imported proposals:
 *   - financials_invalidated = TRUE when CSV TPV is missing OR implausible (>₹5L/kWp)
 *   - system_size_uncertain  = TRUE when CSV Project Size is missing
 *
 * Idempotent: re-running is safe — only inserts missing deals.
 *
 * Usage:
 *   npx tsx scripts/import-hubspot-incremental.ts                # dry-run
 *   npx tsx scripts/import-hubspot-incremental.ts --apply        # write
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const APPLY = process.argv.includes('--apply');
const CSV_PATH = path.resolve(
  __dirname,
  '../scripts/data/hubspot-exports/hubspot-deals-2026-05-02.csv',
);
const JUNK_STAGES = new Set<string>(['To check']);
const MAX_PLAUSIBLE_PER_KWP = 500_000;
const DEFAULT_SIZE_KWP = 5;

type LeadStatus = 'new' | 'contacted' | 'site_survey_scheduled' | 'site_survey_done' | 'proposal_sent' | 'negotiation' | 'won' | 'lost' | 'on_hold' | 'disqualified';
type CustomerSegment = 'residential' | 'commercial' | 'industrial';
type LeadSource = 'referral' | 'website' | 'builder_tie_up' | 'channel_partner' | 'cold_call' | 'exhibition' | 'social_media' | 'walkin';

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

const CATEGORY_TO_SEGMENT: Record<string, CustomerSegment> = {
  'Individual': 'residential',
  'Indivdiual': 'residential',
  'Residential': 'residential',
  'Real Estate': 'commercial',
  'Real Estate / Construction': 'commercial',
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

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {} // skip
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseAmount(s: string): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/[₹$,\s]/g, '').replace(/INR/gi, '').trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

function parsePVRef(s: string): string | null {
  if (!s) return null;
  const stripped = s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim();
  const match = stripped.match(/\b(?:SE\/)?PV\s*\/?\s*(\d{1,4})\s*\/\s*(\d{2}(?:-\d{2})?)/i);
  if (!match) return null;
  return `PV${match[1]}/${match[2]}`.toUpperCase();
}

function parseDateISO(s: string): string | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function getFinancialYear(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (m >= 3) return `${y}-${String(y + 1).slice(2)}`;
  return `${y - 1}-${String(y).slice(2)}`;
}

function mapDealStage(stage: string): { status: LeadStatus; isWon: boolean; isLost: boolean } {
  const norm = (stage || '').trim();
  const status: LeadStatus = STAGE_TO_STATUS[norm] ?? 'new';
  const isWon = norm === 'Closed Won';
  const isLost = ['Closed Lost to Competition','Closed Didnt do','Closed Later','Closed lost to competition','Closed didnt do','Closed later'].includes(norm);
  return { status, isWon, isLost };
}

function mapSegment(category: string): CustomerSegment {
  return CATEGORY_TO_SEGMENT[(category || '').trim()] ?? 'residential';
}

function extractDriveOrUrl(desc: string): string | null {
  if (!desc) return null;
  const cleaned = desc.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const drive = cleaned.match(/https?:\/\/drive\.google\.com[^\s)"]*/);
  if (drive) return `[Google Drive] ${drive[0]}`;
  const url = cleaned.match(/https?:\/\/[^\s)"]+/);
  if (url) return `[Link] ${url[0]}`;
  return cleaned.length <= 500 ? cleaned : cleaned.slice(0, 497) + '...';
}

function buildNotes(d: CsvDeal, pvRef: string | null): string | null {
  const parts: string[] = [];
  const drive = extractDriveOrUrl(d.dealDescription);
  if (drive) parts.push(drive);
  if (d.priority) parts.push(`Priority: ${d.priority}`);
  if (d.nextStep) parts.push(`Next step: ${d.nextStep}`);
  if (pvRef) parts.push(`HubSpot PV: ${pvRef}`);
  const tpv = parseAmount(d.totalProjectValue);
  if (tpv && tpv > 0) parts.push(`HubSpot Total Project Value: ₹${tpv.toLocaleString('en-IN')}`);
  const ra = parseAmount(d.receivedAmount);
  if (ra && ra > 0) parts.push(`HubSpot Received Amount: ₹${ra.toLocaleString('en-IN')}`);
  return parts.length === 0 ? null : `[HubSpot Migration ${new Date().toISOString().slice(0, 10)}] ${parts.join(' | ')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CsvDeal {
  recordId: string;
  dealName: string;
  dealStage: string;
  category: string;
  totalProjectValue: string;
  receivedAmount: string;
  projectSize: string;
  quoteId: string;
  closeDate: string;
  createDate: string;
  isClosedWon: string;
  dealOwner: string;
  priority: string;
  nextStep: string;
  dealDescription: string;
}

interface ExistingLead { id: string; customer_name: string; hubspot_deal_id: string | null; estimated_size_kwp: number | null; }
interface ExistingProject { id: string; project_number: string; customer_name: string; system_size_kwp: number | null; lead_id: string | null; }

interface PlannedAction {
  recordId: string;
  customerName: string;
  pvRef: string | null;
  size: number | null;
  tpv: number | null;
  isWon: boolean;
  status: LeadStatus;
  segment: CustomerSegment;
  systemSizeUncertain: boolean;
  financialsInvalidated: boolean;
  contractedValue: number;
  matchType: 'new' | 'matched-existing-project';
  existingProjectId?: string;
  existingLeadId?: string;
}

// ─── Name matching ────────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?)\s+/i, '')
    .replace(/^m\/s\.?\s+/i, '')           // strip "M/s." / "M/s "
    .replace(/\s+(llp|pvt|pvt\.|private|ltd|ltd\.|limited)\b/gi, '')  // strip company suffixes
    .replace(/\s+/g, ' ')
    .trim();
}
function namesMatch(a: string, b: string, sizeA: number | null, sizeB: number | null): boolean {
  // STRICT: exact normalized name match required.
  // If both sizes present, require within 20% as additional signal — a different size strongly suggests different project.
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb || na !== nb) return false;
  if (sizeA !== null && sizeB !== null && sizeA > 0 && sizeB > 0) {
    const ratio = Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB);
    if (ratio > 0.2) return false;  // names match but sizes diverge — likely different projects
  }
  return true;
}

// ─── Loaders ──────────────────────────────────────────────────────────────────

async function loadAll<T>(supabase: SupabaseClient, table: string, select: string, extra?: (q: any) => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    let q = supabase.from(table).select(select);
    if (extra) q = extra(q);
    q = q.range(offset, offset + pageSize - 1);
    const { data, error } = await q;
    if (error) throw new Error(`load ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function getNextSerial(supabase: SupabaseClient, table: string, column: string, prefix: string): Promise<{ generate: () => string }> {
  const { data } = await supabase.from(table).select(column).like(column, `${prefix}%`).order(column, { ascending: false }).limit(1);
  let counter = 0;
  if (data && data.length > 0) {
    const m = (data[0] as Record<string, string>)[column].match(/(\d+)$/);
    if (m) counter = parseInt(m[1], 10);
  }
  console.log(`  next ${table}.${column} starts after ${prefix}${String(counter).padStart(4, '0')}`);
  return { generate: () => { counter++; return `${prefix}${String(counter).padStart(4, '0')}`; } };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const op = '[import-hubspot-inc]';
  console.log(`${op} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}  csv=${CSV_PATH}`);

  if (!fs.existsSync(CSV_PATH)) { console.error(`${op} CSV not found`); process.exit(1); }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Resolve system employee (for prepared_by) ──────────────────────────────
  const { data: emps } = await supabase.from('employees').select('id, full_name').eq('is_active', true);
  let systemEmployeeId: string | null = null;
  for (const e of emps ?? []) if ((e.full_name || '').toLowerCase().includes('vivek')) systemEmployeeId = e.id;
  if (!systemEmployeeId && (emps?.length ?? 0) > 0) systemEmployeeId = emps![0].id;
  if (!systemEmployeeId) { console.error(`${op} no system employee found`); process.exit(1); }
  console.log(`${op} system employee: ${systemEmployeeId}`);

  // ── Load CSV ──────────────────────────────────────────────────────────────
  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf-8'));
  const header = rows[0];
  const idx = (n: string) => header.findIndex(h => h === n);
  const I = {
    recordId: idx('Record ID'), dealName: idx('Deal Name'), dealStage: idx('Deal Stage'),
    category: idx('Category'), totalProjectValue: idx('Total Project Value'), receivedAmount: idx('Received Amount'),
    projectSize: idx('Project Size'), quoteId: idx('Quote ID'), closeDate: idx('Close Date'),
    createDate: idx('Create Date'), isClosedWon: idx('Is Closed Won'), dealOwner: idx('Deal owner'),
    priority: idx('Priority'), nextStep: idx('Next step'), dealDescription: idx('Deal Description'),
  };
  for (const [k, v] of Object.entries(I)) if (v < 0) { console.error(`${op} missing column: ${k}`); process.exit(1); }

  const byRecord = new Map<string, CsvDeal>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const recordId = (row[I.recordId] || '').trim();
    if (!recordId) continue;
    const candidate: CsvDeal = {
      recordId,
      dealName: (row[I.dealName] || '').trim(),
      dealStage: (row[I.dealStage] || '').trim(),
      category: (row[I.category] || '').trim(),
      totalProjectValue: (row[I.totalProjectValue] || '').trim(),
      receivedAmount: (row[I.receivedAmount] || '').trim(),
      projectSize: (row[I.projectSize] || '').trim(),
      quoteId: (row[I.quoteId] || '').trim(),
      closeDate: (row[I.closeDate] || '').trim(),
      createDate: (row[I.createDate] || '').trim(),
      isClosedWon: (row[I.isClosedWon] || '').trim(),
      dealOwner: (row[I.dealOwner] || '').trim(),
      priority: (row[I.priority] || '').trim(),
      nextStep: (row[I.nextStep] || '').trim(),
      dealDescription: (row[I.dealDescription] || '').trim(),
    };
    const prev = byRecord.get(recordId);
    if (!prev) byRecord.set(recordId, candidate);
    else {
      const prevTpv = parseAmount(prev.totalProjectValue) ?? 0;
      const newTpv = parseAmount(candidate.totalProjectValue) ?? 0;
      if (newTpv > prevTpv) byRecord.set(recordId, candidate);
    }
  }
  console.log(`${op} CSV: ${byRecord.size} unique deals`);

  // ── Load existing leads + projects ────────────────────────────────────────
  const existingLeads = await loadAll<ExistingLead>(supabase, 'leads',
    'id, customer_name, hubspot_deal_id, estimated_size_kwp', q => q.is('deleted_at', null));
  const existingProjects = await loadAll<ExistingProject>(supabase, 'projects',
    'id, project_number, customer_name, system_size_kwp, lead_id', q => q.is('deleted_at', null));
  const existingProposalsHsIds = new Set<string>();
  {
    const { data } = await supabase.from('proposals').select('hubspot_deal_id').not('hubspot_deal_id', 'is', null);
    for (const p of data ?? []) if (p.hubspot_deal_id) existingProposalsHsIds.add(p.hubspot_deal_id);
  }
  const existingLeadHsIds = new Set<string>();
  for (const l of existingLeads) if (l.hubspot_deal_id) existingLeadHsIds.add(l.hubspot_deal_id);
  console.log(`${op} DB: ${existingLeads.length} leads, ${existingProjects.length} projects, ${existingLeadHsIds.size + existingProposalsHsIds.size} hubspot-linked rows`);

  // ── Plan: which CSV deals need to be imported ─────────────────────────────
  const plan: PlannedAction[] = [];
  let skippedJunk = 0;
  let skippedAlreadyImported = 0;
  let skippedNoName = 0;
  const allDbHsIds = new Set([...existingLeadHsIds, ...existingProposalsHsIds]);

  // Pre-pass: count how many CSV deals would match each project, so we can
  // detect ambiguous "Mr Sairam" / "Mr Saravanan" cases where >1 deal collides
  // on the same DB project. Ambiguous → don't auto-link any.
  const projectMatchCount = new Map<string, number>();
  for (const deal of byRecord.values()) {
    if (allDbHsIds.has(deal.recordId)) continue;
    if (!deal.dealName || JUNK_STAGES.has(deal.dealStage)) continue;
    const sizeRaw = parseFloat(deal.projectSize || '0');
    const size = sizeRaw > 0 ? sizeRaw : null;
    for (const proj of existingProjects) {
      if (namesMatch(deal.dealName, proj.customer_name, size, proj.system_size_kwp)) {
        projectMatchCount.set(proj.id, (projectMatchCount.get(proj.id) ?? 0) + 1);
      }
    }
  }

  for (const deal of byRecord.values()) {
    if (allDbHsIds.has(deal.recordId)) { skippedAlreadyImported++; continue; }
    if (!deal.dealName) { skippedNoName++; continue; }
    if (JUNK_STAGES.has(deal.dealStage)) { skippedJunk++; continue; }

    const { status, isWon } = mapDealStage(deal.dealStage);
    const segment = mapSegment(deal.category);
    const sizeRaw = parseFloat(deal.projectSize || '0');
    const size = sizeRaw > 0 ? sizeRaw : null;
    const tpv = parseAmount(deal.totalProjectValue);
    const pvRef = parsePVRef(deal.quoteId);

    // Match by EXACT name to existing project. With size signal when both available.
    let existingProjectId: string | undefined;
    let existingLeadId: string | undefined;
    let matchType: 'new' | 'matched-existing-project' = 'new';
    let multipleMatches = false;
    let firstMatch: ExistingProject | null = null;
    for (const proj of existingProjects) {
      if (namesMatch(deal.dealName, proj.customer_name, size, proj.system_size_kwp)) {
        if (firstMatch) { multipleMatches = true; break; }
        firstMatch = proj;
      }
    }
    // Don't auto-link when: (a) one CSV deal matches multiple DB projects, or
    // (b) one DB project is matched by multiple CSV deals (ambiguous mass-name).
    if (firstMatch && !multipleMatches && (projectMatchCount.get(firstMatch.id) ?? 0) === 1) {
      existingProjectId = firstMatch.id;
      existingLeadId = firstMatch.lead_id ?? undefined;
      matchType = 'matched-existing-project';
    }

    // Sanity check on TPV
    let financialsInvalidated = false;
    let contractedValue = 0;
    const effectiveSize = size ?? DEFAULT_SIZE_KWP;
    if (tpv && tpv > 0) {
      const perKwp = tpv / effectiveSize;
      if (perKwp > MAX_PLAUSIBLE_PER_KWP) {
        financialsInvalidated = true;
        contractedValue = 0;
      } else {
        contractedValue = tpv;
      }
    } else {
      financialsInvalidated = true; // missing TPV
    }

    plan.push({
      recordId: deal.recordId,
      customerName: deal.dealName,
      pvRef,
      size: size ?? null,
      tpv: tpv ?? null,
      isWon,
      status,
      segment,
      systemSizeUncertain: size === null,
      financialsInvalidated,
      contractedValue,
      matchType,
      existingProjectId,
      existingLeadId,
    });
  }

  console.log(`\n${op} === PLAN ===`);
  console.log(`  unique deals in CSV:           ${byRecord.size}`);
  console.log(`  skipped (already in DB):       ${skippedAlreadyImported}`);
  console.log(`  skipped (junk 'To check'):     ${skippedJunk}`);
  console.log(`  skipped (no deal name):        ${skippedNoName}`);
  console.log(`  to import:                     ${plan.length}`);

  const wonCount = plan.filter(p => p.isWon).length;
  const lostCount = plan.filter(p => p.status === 'lost').length;
  const matchedExisting = plan.filter(p => p.matchType === 'matched-existing-project').length;
  console.log(`    └ closed won:                ${wonCount} (${plan.filter(p => p.isWon && p.matchType === 'new').length} new, ${plan.filter(p => p.isWon && p.matchType === 'matched-existing-project').length} link-only)`);
  console.log(`    └ lost:                      ${lostCount}`);
  console.log(`    └ in-flight:                 ${plan.length - wonCount - lostCount}`);
  console.log(`    └ matched existing project:  ${matchedExisting}`);
  console.log(`    └ TPV missing/implausible:   ${plan.filter(p => p.financialsInvalidated).length}`);
  console.log(`    └ size missing (default 5):  ${plan.filter(p => p.systemSizeUncertain).length}`);

  // Stage histogram
  const planByStage = new Map<string, number>();
  for (const p of plan) planByStage.set(p.status, (planByStage.get(p.status) ?? 0) + 1);
  console.log(`  Stage distribution:`);
  for (const [s, n] of [...planByStage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(20)} ${n}`);
  }

  // Show matched-existing cases for human review
  const matched = plan.filter(p => p.matchType === 'matched-existing-project');
  if (matched.length > 0) {
    console.log(`\n${op} MATCHED-EXISTING-PROJECT cases (${matched.length}) — verify these are correct:`);
    for (const m of matched) {
      const proj = existingProjects.find(p => p.id === m.existingProjectId);
      console.log(`  CSV[${m.recordId}] ${m.customerName.padEnd(35).slice(0,35)} | size=${m.size ?? '?'}  ↔  DB[${proj?.project_number}] ${proj?.customer_name.padEnd(35).slice(0,35)} | size=${proj?.system_size_kwp}`);
    }
  }

  // Show new-import won deals (will create lead+proposal+project)
  const newWon = plan.filter(p => p.isWon && p.matchType === 'new');
  if (newWon.length > 0) {
    console.log(`\n${op} NEW Closed-Won deals (${newWon.length}) — will create lead+proposal+project:`);
    for (const w of newWon) {
      console.log(`  ${w.recordId.padEnd(13)} ${w.customerName.padEnd(35).slice(0,35)} | size=${w.size ?? '?'}  PV=${w.pvRef ?? 'none'} | TPV=${w.tpv ?? 'missing'}`);
    }
  }

  // Show in-flight + lost (lead only)
  const newOpen = plan.filter(p => !p.isWon && p.matchType === 'new');
  if (newOpen.length > 0) {
    console.log(`\n${op} NEW non-won deals (${newOpen.length}) — will create lead only:`);
    for (const w of newOpen) {
      console.log(`  ${w.recordId.padEnd(13)} [${w.status.padEnd(15)}] ${w.customerName.padEnd(35).slice(0,35)} | size=${w.size ?? '?'}`);
    }
  }

  if (!APPLY) {
    console.log(`\n${op} DRY RUN — no inserts. Re-run with --apply to write.`);
    return;
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  const projNumGen = await getNextSerial(supabase, 'projects', 'project_number', `SHIROI/PROJ/${getFinancialYear(new Date())}/`);
  const propNumGen = await getNextSerial(supabase, 'proposals', 'proposal_number', `SHIROI/PROP/${getFinancialYear(new Date())}/`);

  let leadsInserted = 0, proposalsInserted = 0, projectsInserted = 0;
  let leadsLinked = 0, proposalsLinked = 0, projectsLinked = 0;
  let errors = 0;

  for (const p of plan) {
    const deal = byRecord.get(p.recordId)!;
    const createdAt = parseDateISO(deal.createDate) ?? new Date().toISOString();
    const closeDate = parseDateISO(deal.closeDate) ?? createdAt;
    const closeDateOnly = closeDate.slice(0, 10);
    const notes = buildNotes(deal, p.pvRef);
    const effectiveSize = p.size ?? DEFAULT_SIZE_KWP;

    let leadId: string;

    if (p.matchType === 'matched-existing-project' && p.existingLeadId) {
      // Just link hubspot_deal_id on the existing lead + project
      leadId = p.existingLeadId;
      const { error: lupErr } = await supabase.from('leads')
        .update({ hubspot_deal_id: deal.recordId })
        .eq('id', leadId)
        .is('hubspot_deal_id', null);
      if (!lupErr) leadsLinked++;
      // Optional: link project too via hubspot_deal_id? Schema check showed projects has no hubspot_deal_id column — skip.
      // But we should still note it. Add to existing lead's notes? Lower priority; the lead row update is enough trail.
      projectsLinked++;
      continue;
    }

    // Insert new lead
    leadId = crypto.randomUUID();
    const placeholderPhone = `9999${deal.recordId.padStart(6, '0').slice(-6)}`;
    const leadRow = {
      id: leadId,
      customer_name: deal.dealName,
      phone: placeholderPhone,
      segment: p.segment,
      source: 'website' as LeadSource,
      status: p.status,
      estimated_size_kwp: p.size,
      hubspot_deal_id: deal.recordId,
      notes,
      city: 'Chennai',
      state: 'Tamil Nadu',
      created_at: createdAt,
      converted_to_project: p.isWon,
      converted_at: p.isWon ? closeDate : null,
    };
    const { error: lerr } = await supabase.from('leads').insert(leadRow);
    if (lerr) {
      // Phone uniqueness retry
      if (lerr.code === '23505' && lerr.message.includes('phone')) {
        leadRow.phone = `9998${deal.recordId.padStart(6, '0').slice(-6)}`;
        const { error: retry } = await supabase.from('leads').insert(leadRow);
        if (retry) {
          // Last resort: use a random suffix
          leadRow.phone = `9997${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
          const { error: retry2 } = await supabase.from('leads').insert(leadRow);
          if (retry2) { console.error(`${op} lead insert failed for ${deal.dealName}: ${retry2.message}`); errors++; continue; }
        }
      } else {
        console.error(`${op} lead insert failed for ${deal.dealName}: ${lerr.message}`);
        errors++; continue;
      }
    }
    leadsInserted++;

    // Track in memory so subsequent name dedup checks see it
    existingLeads.push({
      id: leadId,
      customer_name: deal.dealName,
      hubspot_deal_id: deal.recordId,
      estimated_size_kwp: p.size,
    });

    if (!p.isWon) continue;

    // Decide project status + duplicate-likelihood flag based on age.
    // Old (>365 days) Won deals are likely already in DB as Drive/Zoho-imported projects;
    // we'll create new project rows but flag them for reconciliation.
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
    const isOld = ageDays > 365;
    const projectStatus = isOld ? 'completed' : 'order_received';
    const dupFlag = isOld ? '[Likely-Duplicate-Reconcile]' : null;

    // ── Insert proposal ──
    const proposalId = crypto.randomUUID();
    const proposalNumber = propNumGen.generate();
    const validUntil = new Date(new Date(closeDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const proposalRow = {
      id: proposalId,
      lead_id: leadId,
      proposal_number: proposalNumber,
      system_size_kwp: effectiveSize,
      system_type: 'on_grid',
      status: 'accepted',
      prepared_by: systemEmployeeId,
      valid_until: validUntil,
      total_before_discount: p.financialsInvalidated ? 0 : p.contractedValue,
      total_after_discount: p.financialsInvalidated ? 0 : p.contractedValue,
      shiroi_revenue: p.financialsInvalidated ? 0 : p.contractedValue,
      created_at: createdAt,
      hubspot_deal_id: deal.recordId,
      financials_invalidated: p.financialsInvalidated,
      system_size_uncertain: p.systemSizeUncertain,
      notes: [
        `[HubSpot Migration ${new Date().toISOString().slice(0, 10)}] Won deal imported. PV: ${p.pvRef ?? 'N/A'}`,
        dupFlag,
        p.financialsInvalidated ? `[FLAG] financials_invalidated — CSV TPV missing or > ₹5L/kWp` : null,
        p.systemSizeUncertain ? `[FLAG] system_size_uncertain — CSV size missing, defaulted to ${DEFAULT_SIZE_KWP} kWp` : null,
      ].filter(Boolean).join(' | '),
    };
    const { error: perr } = await supabase.from('proposals').insert(proposalRow);
    if (perr) {
      console.error(`${op} proposal insert failed for ${deal.dealName}: ${perr.message}`);
      errors++;
    } else {
      proposalsInserted++;
    }

    // ── Insert project ──
    const projectId = crypto.randomUUID();
    const projectNumber = projNumGen.generate();
    const projectRow = {
      id: projectId,
      lead_id: leadId,
      proposal_id: proposalId,
      project_number: projectNumber,
      customer_name: deal.dealName,
      customer_phone: leadRow.phone,
      system_size_kwp: effectiveSize,
      system_type: 'on_grid',
      contracted_value: p.contractedValue,
      advance_amount: 0,
      advance_received_at: closeDateOnly,
      status: projectStatus,
      site_address_line1: 'Address pending — HubSpot migration',
      site_city: 'Chennai',
      site_state: 'Tamil Nadu',
      panel_count: 0,
      created_at: createdAt,
      notes: [
        `[HubSpot Migration ${new Date().toISOString().slice(0, 10)}] Won deal → ${projectStatus} project. PV: ${p.pvRef ?? 'N/A'}`,
        dupFlag,
      ].filter(Boolean).join(' | '),
    };
    const { error: prerr } = await supabase.from('projects').insert(projectRow);
    if (prerr) {
      console.error(`${op} project insert failed for ${deal.dealName}: ${prerr.message}`);
      errors++;
    } else {
      projectsInserted++;
      existingProjects.push({
        id: projectId,
        project_number: projectNumber,
        customer_name: deal.dealName,
        system_size_kwp: effectiveSize,
        lead_id: leadId,
      });
    }
  }

  console.log(`\n${op} === RESULT ===`);
  console.log(`  leads inserted:       ${leadsInserted}`);
  console.log(`  leads linked-only:    ${leadsLinked}`);
  console.log(`  proposals inserted:   ${proposalsInserted}`);
  console.log(`  projects inserted:    ${projectsInserted}`);
  console.log(`  projects link-only:   ${projectsLinked}`);
  console.log(`  errors:               ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
