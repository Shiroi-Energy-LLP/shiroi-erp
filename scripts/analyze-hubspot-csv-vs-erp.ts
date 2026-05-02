/**
 * Read-only analysis: compare 2026-05-02 HubSpot CSV vs current ERP state.
 *
 * Reports:
 *   - Total unique deals in CSV
 *   - DB hubspot_deal_id coverage in leads + proposals
 *   - Deals in CSV but NOT in DB (the "missing" set), broken down by Deal Stage
 *   - Deals in DB but NOT in latest CSV (likely deleted/merged in HubSpot)
 *   - Sample rows for each bucket
 *
 * Usage: npx tsx scripts/analyze-hubspot-csv-vs-erp.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const CSV_PATH = path.resolve(
  __dirname,
  '../scripts/data/hubspot-exports/hubspot-deals-2026-05-02.csv',
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

interface CsvDeal {
  recordId: string;
  dealName: string;
  dealStage: string;
  totalProjectValue: string;
  amount: string;
  projectSize: string;
  closeDate: string;
  createDate: string;
  isClosedWon: string;
  quoteId: string;
  category: string;
  dealOwner: string;
  pipeline: string;
}

async function main() {
  const op = '[analyze-hubspot]';

  // ── Load CSV ──────────────────────────────────────────────────────────────
  const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(csvText);
  const header = rows[0];
  const I = {
    recordId: header.findIndex(h => h === 'Record ID'),
    dealName: header.findIndex(h => h === 'Deal Name'),
    dealStage: header.findIndex(h => h === 'Deal Stage'),
    totalProjectValue: header.findIndex(h => h === 'Total Project Value'),
    amount: header.findIndex(h => h === 'Amount'),
    projectSize: header.findIndex(h => h === 'Project Size'),
    closeDate: header.findIndex(h => h === 'Close Date'),
    createDate: header.findIndex(h => h === 'Create Date'),
    isClosedWon: header.findIndex(h => h === 'Is Closed Won'),
    quoteId: header.findIndex(h => h === 'Quote ID'),
    category: header.findIndex(h => h === 'Category'),
    dealOwner: header.findIndex(h => h === 'Deal owner'),
    pipeline: header.findIndex(h => h === 'Pipeline'),
  };

  const byRecord = new Map<string, CsvDeal>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const recordId = (row[I.recordId] || '').trim();
    if (!recordId) continue;
    const deal: CsvDeal = {
      recordId,
      dealName: (row[I.dealName] || '').trim(),
      dealStage: (row[I.dealStage] || '').trim(),
      totalProjectValue: (row[I.totalProjectValue] || '').trim(),
      amount: (row[I.amount] || '').trim(),
      projectSize: (row[I.projectSize] || '').trim(),
      closeDate: (row[I.closeDate] || '').trim(),
      createDate: (row[I.createDate] || '').trim(),
      isClosedWon: (row[I.isClosedWon] || '').trim(),
      quoteId: (row[I.quoteId] || '').trim(),
      category: (row[I.category] || '').trim(),
      dealOwner: (row[I.dealOwner] || '').trim(),
      pipeline: (row[I.pipeline] || '').trim(),
    };
    // Prefer rows with TPV
    const prev = byRecord.get(recordId);
    if (!prev || (prev.totalProjectValue === '' && deal.totalProjectValue !== '')) {
      byRecord.set(recordId, deal);
    }
  }
  console.log(`${op} CSV: ${byRecord.size} unique deals`);

  // Distribution by pipeline
  const byPipeline = new Map<string, number>();
  for (const d of byRecord.values()) {
    byPipeline.set(d.pipeline || '<no pipeline>', (byPipeline.get(d.pipeline || '<no pipeline>') ?? 0) + 1);
  }
  console.log(`${op} CSV pipeline breakdown:`);
  for (const [p, n] of [...byPipeline.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(40)} ${n}`);
  }

  // ── Load DB IDs ────────────────────────────────────────────────────────────
  // Page through leads to get all hubspot_deal_id (>1k rows)
  const dbLeadIds = new Set<string>();
  const leadIdToRecord = new Map<string, { id: string; customer_name: string; status: string; created_at: string }>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, customer_name, status, created_at, hubspot_deal_id')
      .not('hubspot_deal_id', 'is', null)
      .is('deleted_at', null)
      .range(offset, offset + pageSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const l of data) {
      if (l.hubspot_deal_id) {
        dbLeadIds.add(l.hubspot_deal_id);
        leadIdToRecord.set(l.hubspot_deal_id, l);
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  console.log(`${op} DB leads with hubspot_deal_id: ${dbLeadIds.size}`);

  // proposals (also 144 rows)
  const dbProposalIds = new Set<string>();
  {
    const { data, error } = await supabase
      .from('proposals')
      .select('hubspot_deal_id')
      .not('hubspot_deal_id', 'is', null);
    if (error) { console.error(error); process.exit(1); }
    for (const p of data ?? []) {
      if (p.hubspot_deal_id) dbProposalIds.add(p.hubspot_deal_id);
    }
  }
  console.log(`${op} DB proposals with hubspot_deal_id: ${dbProposalIds.size}`);

  // Combined
  const dbAllIds = new Set<string>([...dbLeadIds, ...dbProposalIds]);
  console.log(`${op} DB combined unique hubspot_deal_id: ${dbAllIds.size}`);

  // ── Find missing (in CSV but not in DB) ─────────────────────────────────────
  const missing: CsvDeal[] = [];
  for (const [id, deal] of byRecord) {
    if (!dbAllIds.has(id)) missing.push(deal);
  }
  console.log(`\n${op} ✗ Deals in CSV but NOT in ERP: ${missing.length}`);

  // Group missing by Deal Stage
  const byStage = new Map<string, CsvDeal[]>();
  for (const d of missing) {
    const s = d.dealStage || '<no stage>';
    if (!byStage.has(s)) byStage.set(s, []);
    byStage.get(s)!.push(d);
  }
  console.log(`${op} Missing deals broken down by Deal Stage:`);
  for (const [stage, deals] of [...byStage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${stage.padEnd(40)} ${deals.length}`);
  }

  // Group missing by Pipeline
  const missingByPipeline = new Map<string, CsvDeal[]>();
  for (const d of missing) {
    const p = d.pipeline || '<no pipeline>';
    if (!missingByPipeline.has(p)) missingByPipeline.set(p, []);
    missingByPipeline.get(p)!.push(d);
  }
  console.log(`${op} Missing deals broken down by Pipeline:`);
  for (const [pipe, deals] of [...missingByPipeline.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${pipe.padEnd(40)} ${deals.length}`);
  }

  // Sample 15 missing rows (recently created) for human review
  const recentMissing = [...missing].sort((a, b) => (b.createDate || '').localeCompare(a.createDate || '')).slice(0, 15);
  console.log(`\n${op} Sample of 15 most-recent missing deals:`);
  for (const d of recentMissing) {
    console.log(`  [${d.recordId}] ${d.dealName.padEnd(35).slice(0, 35)} | stage=${d.dealStage.padEnd(25).slice(0, 25)} | created=${d.createDate.slice(0, 10)} | TPV=${d.totalProjectValue} | size=${d.projectSize}`);
  }

  // ── Find DB IDs not in latest CSV (potentially deleted/merged in HubSpot) ───
  const csvIds = new Set([...byRecord.keys()]);
  const dbOnly = [...dbAllIds].filter(id => !csvIds.has(id));
  console.log(`\n${op} Deals in DB but NOT in latest CSV: ${dbOnly.length}`);
  console.log(`  (these could be: HubSpot-side deletes, merges, or filters applied in the CSV export)`);
  if (dbOnly.length > 0 && dbOnly.length <= 20) {
    console.log(`  IDs: ${dbOnly.join(', ')}`);
  } else if (dbOnly.length > 20) {
    console.log(`  First 20 IDs: ${dbOnly.slice(0, 20).join(', ')}`);
    // Try to get names for first 5
    const sample = dbOnly.slice(0, 5);
    const samples = sample.map(id => leadIdToRecord.get(id)).filter(Boolean);
    console.log(`  Sample with names:`);
    for (const s of samples) {
      console.log(`    [${(s as any).hubspot_deal_id ?? 'n/a'}] ${(s as any)?.customer_name?.slice(0, 40) ?? ''}`);
    }
  }

  // ── Won deals in CSV missing from DB (highest priority) ─────────────────────
  const wonMissing = missing.filter(d =>
    d.isClosedWon.toLowerCase() === 'true' || d.dealStage.toLowerCase() === 'closed won'
  );
  console.log(`\n${op} *** Won deals in CSV missing from DB: ${wonMissing.length} ***`);
  for (const d of wonMissing.slice(0, 20)) {
    console.log(`  [${d.recordId}] ${d.dealName.padEnd(35).slice(0, 35)} | TPV=${d.totalProjectValue} | size=${d.projectSize} | quoteId="${d.quoteId.slice(0, 30)}"`);
  }
  if (wonMissing.length > 20) console.log(`  ... and ${wonMissing.length - 20} more`);

  console.log(`\n${op} Done.`);
}

main().catch(e => { console.error(e); process.exit(1); });
