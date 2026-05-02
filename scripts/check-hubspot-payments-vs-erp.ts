/**
 * Cross-check: HubSpot Payments-pending CSV vs ERP receivables.
 *
 * For each unique HubSpot deal in payments CSV:
 *   - Find the matching ERP project (via hubspot_deal_id on lead)
 *   - Read project_cash_positions.total_outstanding
 *
 * For each ERP project with total_outstanding > 0:
 *   - Check if its lead.hubspot_deal_id is in the payments CSV
 *
 * Reports:
 *   A. Payments CSV deals with NO matching ERP project
 *   B. Payments CSV deals matched, but ERP outstanding is 0 (gap — invoice not raised yet)
 *   C. ERP projects with outstanding > 0 but NOT in payments CSV (likely Zoho-tracked only)
 *   D. Sample of healthy matches (in both)
 *
 * Read-only. Usage:
 *   npx tsx scripts/check-hubspot-payments-vs-erp.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const CSV_PATH = path.resolve(
  __dirname,
  '../scripts/data/hubspot-exports/hubspot-deals-payments-2026-05-02.csv',
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

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

function parseAmount(s: string): number {
  if (!s || !s.trim()) return 0;
  const cleaned = s.replace(/[₹$,\s]/g, '').replace(/INR/gi, '').trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

interface PaymentRow {
  recordId: string;
  dealName: string;
  dealStage: string;
  amount: number;
  projectSize: string;
  quoteId: string;
}

async function main() {
  const op = '[check-payments]';
  console.log(`${op} CSV: ${CSV_PATH}`);

  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(text);
  const header = rows[0];
  const idx = (n: string) => header.findIndex(h => h === n);
  const I = {
    recordId: idx('Record ID'),
    dealName: idx('Deal Name'),
    dealStage: idx('Deal Stage'),
    amount: idx('Amount'),
    projectSize: idx('Project Size'),
    quoteId: idx('Quote ID'),
  };

  const csvDeals = new Map<string, { dealName: string; payments: PaymentRow[] }>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const recordId = (row[I.recordId] || '').trim();
    if (!recordId || !/^\d+$/.test(recordId)) continue; // skip malformed rows
    const p: PaymentRow = {
      recordId,
      dealName: (row[I.dealName] || '').trim(),
      dealStage: (row[I.dealStage] || '').trim(),
      amount: parseAmount(row[I.amount] || ''),
      projectSize: (row[I.projectSize] || '').trim(),
      quoteId: (row[I.quoteId] || '').trim(),
    };
    if (!csvDeals.has(recordId)) csvDeals.set(recordId, { dealName: p.dealName, payments: [] });
    csvDeals.get(recordId)!.payments.push(p);
  }
  console.log(`${op} CSV: ${csvDeals.size} unique deals with pending payments`);

  // The Payments pipeline uses DIFFERENT Record IDs than the Sales pipeline,
  // so hubspot_deal_id matching won't work. Match by exact normalized deal name
  // against ALL existing projects.
  const normalizeName = (s: string) =>
    s.toLowerCase()
      .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?)\s+/i, '')
      .replace(/^m\/s\.?\s+/i, '')
      .replace(/\s+(llp|pvt|pvt\.|private|ltd|ltd\.|limited)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  // Load ALL non-deleted projects and build a name index
  const allProjects: { id: string; project_number: string; customer_name: string; lead_id: string | null }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_number, customer_name, lead_id')
      .is('deleted_at', null)
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allProjects.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const projByName = new Map<string, typeof allProjects[number][]>();
  for (const p of allProjects) {
    const k = normalizeName(p.customer_name);
    if (!projByName.has(k)) projByName.set(k, []);
    projByName.get(k)!.push(p);
  }

  // Build per-deal projection: which ERP project does each CSV deal map to?
  const projByLead = new Map<string, { id: string; project_number: string; customer_name: string; lead_id: string | null }>();
  const leadByHsId = new Map<string, { id: string; customer_name: string }>(); // synthetic
  for (const [recordId, deal] of csvDeals) {
    const matches = projByName.get(normalizeName(deal.dealName));
    if (matches && matches.length === 1) {
      const match = matches[0];
      const fakeLeadId = match.lead_id ?? `synthetic-${recordId}`;
      leadByHsId.set(recordId, { id: fakeLeadId, customer_name: deal.dealName });
      projByLead.set(fakeLeadId, match);
    }
  }
  console.log(`${op} matched ${leadByHsId.size}/${csvDeals.size} CSV deals to ERP projects by exact name`);

  const projIds = [...projByLead.values()].map(p => p.id);
  const { data: cash } = projIds.length
    ? await supabase
        .from('project_cash_positions')
        .select('project_id, total_invoiced, total_outstanding')
        .in('project_id', projIds)
    : { data: [] };
  const cashByProj = new Map<string, { total_invoiced: number; total_outstanding: number }>();
  for (const c of cash ?? []) cashByProj.set(c.project_id, { total_invoiced: Number(c.total_invoiced), total_outstanding: Number(c.total_outstanding) });

  // ── Bucket A: Payments CSV deals with NO matching ERP project ────────────
  const noProject: { recordId: string; dealName: string; expected: number }[] = [];
  // ── Bucket B: Matched but outstanding=0 in ERP ────────────────────────────
  const matchedNoOutstanding: { recordId: string; dealName: string; expected: number; project: string; invoiced: number }[] = [];
  // ── Bucket D: Healthy matches ─────────────────────────────────────────────
  const healthyMatch: { recordId: string; dealName: string; expected: number; project: string; outstanding: number }[] = [];

  for (const [recordId, deal] of csvDeals) {
    const expected = deal.payments.reduce((sum, p) => sum + p.amount, 0);
    const lead = leadByHsId.get(recordId);
    if (!lead) {
      noProject.push({ recordId, dealName: deal.dealName, expected });
      continue;
    }
    const proj = projByLead.get(lead.id);
    if (!proj) {
      noProject.push({ recordId, dealName: deal.dealName, expected });
      continue;
    }
    const c = cashByProj.get(proj.id);
    const outstanding = c?.total_outstanding ?? 0;
    const invoiced = c?.total_invoiced ?? 0;
    if (outstanding > 0) {
      healthyMatch.push({ recordId, dealName: deal.dealName, expected, project: proj.project_number, outstanding });
    } else {
      matchedNoOutstanding.push({ recordId, dealName: deal.dealName, expected, project: proj.project_number, invoiced });
    }
  }

  console.log(`\n${op} BUCKET A — payments CSV deals with NO matching ERP project: ${noProject.length}`);
  for (const x of noProject) console.log(`  ${x.recordId.padEnd(13)} ${x.dealName.padEnd(40).slice(0, 40)} | expected ₹${x.expected.toLocaleString('en-IN')}`);

  console.log(`\n${op} BUCKET B — payments CSV matched to ERP project, but outstanding=0: ${matchedNoOutstanding.length}`);
  for (const x of matchedNoOutstanding) console.log(`  ${x.project.padEnd(28)} ${x.dealName.padEnd(40).slice(0, 40)} | CSV expected ₹${x.expected.toLocaleString('en-IN')} | ERP invoiced ₹${x.invoiced.toLocaleString('en-IN')}`);

  console.log(`\n${op} BUCKET D — healthy matches (in CSV AND has ERP outstanding): ${healthyMatch.length}`);
  for (const x of healthyMatch.slice(0, 20)) console.log(`  ${x.project.padEnd(28)} ${x.dealName.padEnd(40).slice(0, 40)} | CSV expected ₹${x.expected.toLocaleString('en-IN')} | ERP outstanding ₹${x.outstanding.toLocaleString('en-IN')}`);
  if (healthyMatch.length > 20) console.log(`  ... and ${healthyMatch.length - 20} more`);

  // ── Bucket C: ERP projects with outstanding > 0 NOT in payments CSV ───────
  const csvDealIdSet = new Set(csvDeals.keys());
  const { data: outstandingProjs } = await supabase
    .from('project_cash_positions')
    .select('project_id, total_outstanding')
    .gt('total_outstanding', 0);
  const outstandingByProjId = new Map<string, number>();
  for (const r of outstandingProjs ?? []) outstandingByProjId.set(r.project_id, Number(r.total_outstanding));

  const outstandingProjIds = [...outstandingByProjId.keys()];
  const { data: erpProjsWithOut } = outstandingProjIds.length
    ? await supabase
        .from('projects')
        .select('id, project_number, customer_name, lead_id, contracted_value, leads(hubspot_deal_id)')
        .in('id', outstandingProjIds)
        .is('deleted_at', null)
    : { data: [] };

  const erpOnly: { proj: string; name: string; outstanding: number; hsId: string | null }[] = [];
  let totalErpOutstanding = 0;
  let totalCsvCovered = 0;
  for (const p of (erpProjsWithOut ?? [])) {
    const hs = (p as any).leads?.hubspot_deal_id ?? null;
    const out = outstandingByProjId.get(p.id) ?? 0;
    totalErpOutstanding += out;
    if (hs && csvDealIdSet.has(hs)) {
      totalCsvCovered += out;
    } else {
      erpOnly.push({ proj: p.project_number, name: p.customer_name, outstanding: out, hsId: hs });
    }
  }
  console.log(`\n${op} BUCKET C — ERP projects with outstanding > 0 NOT in HubSpot payments CSV: ${erpOnly.length}`);
  console.log(`  Sample (top 30 by outstanding amount):`);
  for (const x of erpOnly.sort((a, b) => b.outstanding - a.outstanding).slice(0, 30)) {
    console.log(`  ${x.proj.padEnd(28)} ${x.name.padEnd(40).slice(0, 40)} | outstanding ₹${x.outstanding.toLocaleString('en-IN')} | hs_id=${x.hsId ?? 'none'}`);
  }
  if (erpOnly.length > 30) console.log(`  ... and ${erpOnly.length - 30} more`);

  // ── Summary totals ────────────────────────────────────────────────────────
  const totalCsvExpected = [...csvDeals.values()].flatMap(d => d.payments).reduce((s, p) => s + p.amount, 0);
  console.log(`\n${op} === TOTALS ===`);
  console.log(`  HubSpot payments-pending CSV unique deals:    ${csvDeals.size}`);
  console.log(`  HubSpot payments-pending CSV total expected: ₹${totalCsvExpected.toLocaleString('en-IN')}`);
  console.log(`  ERP projects with outstanding > 0:            ${outstandingProjIds.length}`);
  console.log(`  ERP total outstanding:                        ₹${totalErpOutstanding.toLocaleString('en-IN')}`);
  console.log(`  ERP outstanding covered by HubSpot CSV:       ₹${totalCsvCovered.toLocaleString('en-IN')} (${(totalCsvCovered / totalErpOutstanding * 100).toFixed(1)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); });
