/**
 * Extract BOM from confirmed project Google Sheets in Google Drive.
 *
 * Each confirmed project folder has a Google Spreadsheet with a "Bill of items"
 * tab containing: Category | Items | Make | Qty | Units | Status | Rate | Amount | Gst | T.Amount | Vendor
 *
 * This script:
 *   1. Scans all confirmed project folders (2024-25, 2025-26, 2026-27)
 *   2. Reads "Bill of items" tab from each spreadsheet
 *   3. Matches folder name to project/proposal in DB
 *   4. Inserts BOM lines for projects that don't have them yet
 *
 * Usage:
 *   npx tsx scripts/extract-bom-from-gdrive.ts --dry-run
 *   npx tsx scripts/extract-bom-from-gdrive.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { google, sheets_v4, drive_v3 } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const DRY_RUN = process.argv.includes('--dry-run');
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Category Classification ───
const CATEGORY_PATTERNS: [RegExp, string, 'supply' | 'works_contract'][] = [
  [/solar\s*panel|photovoltaic|module|dcr\s*panel|mono.*perc|bi.*facial/i, 'panel', 'supply'],
  [/inverter|grid\s*tie|on.*grid.*inv|hybrid.*inv/i, 'inverter', 'supply'],
  [/mounting\s*structure|mms|module\s*mount|gi\s*tube|base\s*plate|channel|purlin|clamp|rafter|l.?angle|mid.*clamp|end.*clamp/i, 'structure', 'supply'],
  [/dc\s*wire|dc\s*cable|solar\s*cable|1c.*sq/i, 'dc_cable', 'supply'],
  [/ac\s*cable|ac.*wire|4c.*sq|xlpe|lt\s*cable|armoured.*cable/i, 'ac_cable', 'supply'],
  [/dcdb|dc\s*distribution/i, 'dcdb', 'supply'],
  [/acdb|ac\s*distribution/i, 'acdb', 'supply'],
  [/earth|grounding|gi\s*strip|earthing|copper.*rod/i, 'earthing', 'supply'],
  [/lightning|la\b|surge/i, 'lightning_arrestor', 'supply'],
  [/mc4|connector/i, 'connector', 'supply'],
  [/junction\s*box|ajb/i, 'junction_box', 'supply'],
  [/conduit|tray|pipe|upvc|pvc.*pipe/i, 'conduit', 'supply'],
  [/monitor|data\s*logger|wifi|communication/i, 'monitoring', 'supply'],
  [/net\s*meter|ceig|tneb/i, 'net_meter', 'works_contract'],
  [/civil|trench|foundation|concrete/i, 'civil_work', 'works_contract'],
  [/install|erect|commission|labour|labor/i, 'installation_labour', 'works_contract'],
  [/transport|freight|delivery/i, 'transport', 'works_contract'],
  [/battery|storage/i, 'battery', 'supply'],
];

function classifyItem(description: string): { category: string; gst_type: 'supply' | 'works_contract' } {
  for (const [pattern, category, gst_type] of CATEGORY_PATTERNS) {
    if (pattern.test(description)) return { category, gst_type };
  }
  return { category: 'other', gst_type: 'supply' };
}

function parseNumber(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[₹,\s%]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseGstRate(val: string): number {
  if (!val) return 12;
  const n = parseFloat(val.replace(/[₹,\s%]/g, ''));
  if (isNaN(n)) return 12;
  if (n > 0 && n <= 1) return n * 100; // 0.18 → 18
  return n;
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension', 'service', 'work'].includes(t));
}

function fuzzyMatch(name1: string, name2: string): number {
  const t1 = tokenize(name1);
  const t2 = tokenize(name2);
  if (t1.length === 0 || t2.length === 0) return 0;
  let matches = 0;
  for (const t of t1) {
    if (t2.some(t2t => t2t.includes(t) || t.includes(t2t))) matches++;
  }
  return matches / Math.max(t1.length, t2.length);
}

async function main() {
  const op = '[bom-gdrive]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Auth ═══
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  const drive = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  // ═══ Step 1: Get proposals without BOM from DB ═══
  console.log(`${op} Loading DB state...`);
  const bomProposalIds = new Set<string>();
  let bomOffset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('proposal_bom_lines')
      .select('proposal_id')
      .range(bomOffset, bomOffset + 999);
    if (!batch || batch.length === 0) break;
    batch.forEach(b => bomProposalIds.add(b.proposal_id));
    bomOffset += batch.length;
    if (batch.length < 1000) break;
  }
  console.log(`${op} ${bomProposalIds.size} proposals already have BOM`);

  // Get all projects with proposals and leads
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, proposal_id, status');

  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .is('deleted_at', null);

  const leadNameMap = new Map<string, string>();
  (leads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  // Build: customer_name → { project_id, proposal_id, lead_id, status }
  type Target = { project_id: string; proposal_id: string; lead_id: string; customer_name: string; status: string };
  const targets: Target[] = [];
  for (const pr of (projects ?? [])) {
    if (pr.proposal_id && pr.lead_id) {
      targets.push({
        project_id: pr.id,
        proposal_id: pr.proposal_id,
        lead_id: pr.lead_id,
        customer_name: leadNameMap.get(pr.lead_id) || '',
        status: pr.status,
      });
    }
  }

  // ═══ Step 2: Scan Google Drive ═══
  console.log(`\n${op} Scanning confirmed project folders...`);

  // Find year folders
  const rootRes = await drive.files.list({
    q: `'1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id,name)',
  });
  const yearFolders = (rootRes.data.files || [])
    .filter(f => /confirmed/i.test(f.name || ''))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`${op} Year folders: ${yearFolders.map(f => f.name).join(', ')}`);

  let stats = {
    folders: 0, sheets: 0, bomParsed: 0, matched: 0, inserted: 0, linesInserted: 0,
    alreadyHasBom: 0, noSheet: 0, emptyBom: 0, noMatch: 0, errors: 0,
  };

  for (const yearFolder of yearFolders) {
    console.log(`\n${op} === ${yearFolder.name} ===`);

    // List project folders
    const projRes = await drive.files.list({
      q: `'${yearFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name)',
      pageSize: 200,
    });
    const projectFolders = projRes.data.files || [];
    console.log(`${op} ${projectFolders.length} project folders`);

    for (const folder of projectFolders) {
      stats.folders++;
      const folderName = folder.name || '';

      // Find spreadsheet in folder
      const filesRes = await drive.files.list({
        q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id,name)',
      });
      const spreadsheet = (filesRes.data.files || [])[0];
      if (!spreadsheet) { stats.noSheet++; continue; }
      stats.sheets++;

      // Match folder name to DB project
      let bestTarget: Target | null = null;
      let bestScore = 0;
      for (const target of targets) {
        const score = fuzzyMatch(folderName, target.customer_name);
        if (score > bestScore) {
          bestScore = score;
          bestTarget = target;
        }
      }

      if (!bestTarget || bestScore < 0.4) {
        if (DRY_RUN) console.log(`  NO MATCH: ${folderName} (best: ${bestTarget?.customer_name} @ ${bestScore.toFixed(2)})`);
        stats.noMatch++;
        continue;
      }

      // Skip if already has BOM
      if (bomProposalIds.has(bestTarget.proposal_id)) {
        stats.alreadyHasBom++;
        continue;
      }

      // Read "Bill of items" tab
      let bomRows: string[][] = [];
      try {
        // Try both "Bill of items" and "Bill of items " (with trailing space)
        for (const tabName of ['Bill of items', 'Bill of items ']) {
          try {
            const data = await sheetsApi.spreadsheets.values.get({
              spreadsheetId: spreadsheet.id!,
              range: `'${tabName}'!A1:K100`,
            });
            bomRows = (data.data.values || []) as string[][];
            if (bomRows.length > 3) break;
          } catch { /* tab doesn't exist */ }
        }
      } catch (e: any) {
        stats.errors++;
        continue;
      }

      if (bomRows.length < 5) { stats.emptyBom++; continue; }
      stats.bomParsed++;

      // Parse BOM rows
      // Header is typically row 5: Category | Items | Make | Qty | Units | Status | Rate | Amount | Gst | T.Amount | Vendor
      let headerRow = -1;
      for (let r = 0; r < Math.min(bomRows.length, 10); r++) {
        const row = bomRows[r];
        if (row && row.some(c => /category/i.test(c || '')) && row.some(c => /item/i.test(c || ''))) {
          headerRow = r;
          break;
        }
      }

      if (headerRow === -1) {
        stats.emptyBom++;
        continue;
      }

      // Map header columns
      const header = bomRows[headerRow].map(h => (h || '').toLowerCase().trim());
      const catIdx = header.findIndex(h => /category/i.test(h));
      const itemIdx = header.findIndex(h => /item/i.test(h));
      const makeIdx = header.findIndex(h => /make|brand/i.test(h));
      const qtyIdx = header.findIndex(h => /qty|quantity/i.test(h));
      const unitIdx = header.findIndex(h => /unit/i.test(h));
      const rateIdx = header.findIndex(h => /rate|price/i.test(h));
      const amountIdx = header.findIndex(h => /^amount/i.test(h));
      const gstIdx = header.findIndex(h => /gst/i.test(h));
      const totalIdx = header.findIndex(h => /t\.?amount|total/i.test(h));

      if (itemIdx === -1) { stats.emptyBom++; continue; }

      // Parse data rows
      const bomLines: Array<{
        line_number: number;
        item_category: string;
        item_description: string;
        brand: string | null;
        quantity: number;
        unit: string;
        unit_price: number;
        total_price: number;
        gst_rate: number;
        gst_type: 'supply' | 'works_contract';
      }> = [];

      let lineNum = 0;
      for (let r = headerRow + 1; r < bomRows.length; r++) {
        const row = bomRows[r];
        if (!row || row.length < 3) continue;

        const itemDesc = (row[itemIdx] || '').trim();
        if (!itemDesc || itemDesc.length < 2) continue;
        if (/^(total|grand\s*total|sub\s*total|gst|cgst|sgst|igst)/i.test(itemDesc)) continue;

        lineNum++;
        const category = catIdx >= 0 ? (row[catIdx] || '').trim() : '';
        const { category: classifiedCategory, gst_type } = classifyItem(itemDesc + ' ' + category);
        const qty = qtyIdx >= 0 ? parseNumber(row[qtyIdx] || '') : 1;
        const rate = rateIdx >= 0 ? parseNumber(row[rateIdx] || '') : 0;
        const amount = amountIdx >= 0 ? parseNumber(row[amountIdx] || '') : (qty * rate);
        const gstRate = gstIdx >= 0 ? parseGstRate(row[gstIdx] || '') : 12;

        if (qty === 0 && rate === 0 && amount === 0) continue;

        bomLines.push({
          line_number: lineNum,
          item_category: classifiedCategory,
          item_description: itemDesc,
          brand: makeIdx >= 0 ? (row[makeIdx] || '').trim() || null : null,
          quantity: qty || 1,
          unit: unitIdx >= 0 ? (row[unitIdx] || 'Nos').trim() : 'Nos',
          unit_price: rate,
          total_price: amount || (qty * rate),
          gst_rate: gstRate,
          gst_type,
        });
      }

      if (bomLines.length === 0) { stats.emptyBom++; continue; }

      stats.matched++;
      const isCompleted = bestTarget.status === 'completed' ? ' [COMPLETED]' : '';
      console.log(`  ${folderName} → ${bestTarget.customer_name}${isCompleted} = ${bomLines.length} BOM lines (score: ${bestScore.toFixed(2)})`);

      if (DRY_RUN) {
        stats.inserted++;
        stats.linesInserted += bomLines.length;
        bomProposalIds.add(bestTarget.proposal_id);
        continue;
      }

      // Insert BOM lines
      const rows = bomLines.map(line => ({
        proposal_id: bestTarget!.proposal_id,
        line_number: line.line_number,
        item_category: line.item_category,
        item_description: line.item_description,
        brand: line.brand,
        hsn_code: null,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        total_price: line.total_price,
        gst_rate: line.gst_rate,
        gst_type: line.gst_type,
        gst_amount: Math.round(line.total_price * (line.gst_rate / 100) * 100) / 100,
        scope_owner: 'shiroi' as const,
        notes: `[EXTRACTED] From Google Drive "${folderName}" Bill of items`,
      }));

      const { error: insertErr } = await supabase
        .from('proposal_bom_lines')
        .insert(rows);

      if (insertErr) {
        console.error(`  Insert error: ${insertErr.message}`);
        stats.errors++;
        await sleep(2000);
        continue;
      }

      stats.inserted++;
      stats.linesInserted += rows.length;
      bomProposalIds.add(bestTarget.proposal_id);
      await sleep(300);
    }

    await sleep(500);
  }

  console.log(`\n${op} ═══ Results ═══`);
  console.log(`  Folders scanned:   ${stats.folders}`);
  console.log(`  Spreadsheets:      ${stats.sheets}`);
  console.log(`  BOMs parsed:       ${stats.bomParsed}`);
  console.log(`  Matched to DB:     ${stats.matched}`);
  console.log(`  Proposals updated: ${stats.inserted}`);
  console.log(`  BOM lines:         ${stats.linesInserted}`);
  console.log(`  Already has BOM:   ${stats.alreadyHasBom}`);
  console.log(`  No spreadsheet:    ${stats.noSheet}`);
  console.log(`  Empty/no BOM tab:  ${stats.emptyBom}`);
  console.log(`  No match in DB:    ${stats.noMatch}`);
  console.log(`  Errors:            ${stats.errors}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
