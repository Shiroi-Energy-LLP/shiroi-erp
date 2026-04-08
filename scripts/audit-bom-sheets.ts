/**
 * Audit: Download Excel files and report sheet names + header rows.
 * Finds why BOM extraction missed valid costing sheets.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function inspectExcel(buffer: Buffer, fileName: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const result: any = { fileName, sheets: [] };

  for (const sheet of workbook.worksheets) {
    const sheetInfo: any = {
      name: sheet.name,
      rowCount: sheet.rowCount,
      colCount: sheet.columnCount,
      headerCandidates: [],
    };

    // Scan first 20 rows for potential headers
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(sheet.columnCount, 15); c++) {
        const val = row.getCell(c).value;
        if (val !== null && val !== undefined) {
          cells.push(String(val).trim().substring(0, 40));
        }
      }
      if (cells.length >= 3) {
        // Check if this looks like a header row
        const hasDesc = cells.some(c => /desc|particular|item|material|component/i.test(c));
        const hasQty = cells.some(c => /qty|quantity|nos|number/i.test(c));
        const hasAmount = cells.some(c => /amount|total|cost|rate|price|value/i.test(c));
        if (hasDesc || (hasQty && hasAmount)) {
          sheetInfo.headerCandidates.push({ row: r, cells, hasDesc, hasQty, hasAmount });
        }
      }
    }

    result.sheets.push(sheetInfo);
  }

  return result;
}

async function main() {
  // Specific test: Sagas
  const sagasLeadId = 'd2b29fe0-b8ca-4b8f-b2e3-e29366aacb42';
  console.log('=== SAGAS INSPECTION ===');
  const { data: sagasFiles } = await supabase.storage.from('proposal-files').list(sagasLeadId, { limit: 50 });
  const xlsxFiles = (sagasFiles ?? []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
  console.log('Excel files:', xlsxFiles.map(f => f.name));

  for (const f of xlsxFiles) {
    const { data } = await supabase.storage.from('proposal-files').download(`${sagasLeadId}/${f.name}`);
    if (!data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    const info = await inspectExcel(buffer, f.name);
    console.log(`\n  File: ${f.name}`);
    for (const s of info.sheets) {
      console.log(`    Sheet: "${s.name}" (${s.rowCount} rows, ${s.colCount} cols)`);
      for (const h of s.headerCandidates) {
        console.log(`      Row ${h.row}: [${h.cells.join(' | ')}]`);
        console.log(`        desc=${h.hasDesc} qty=${h.hasQty} amt=${h.hasAmount}`);
      }
      if (s.headerCandidates.length === 0) console.log('      (no header-like rows found in first 20 rows)');
    }
  }

  // Now sample 10 projects that SHOULD have BOM but DON'T
  console.log('\n\n=== SAMPLING 10 PROJECTS WITHOUT BOM ===');

  // Get projects with proposals but no BOM
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, proposal_id')
    .not('proposal_id', 'is', null);

  const { data: bomProposals } = await supabase
    .from('proposal_bom_lines')
    .select('proposal_id')
    .limit(1000);
  const bomProposalIds = new Set((bomProposals ?? []).map(b => b.proposal_id));

  const projectsWithoutBom = (projects ?? []).filter(p => !bomProposalIds.has(p.proposal_id));
  console.log(`Projects without BOM: ${projectsWithoutBom.length} of ${(projects ?? []).length}`);

  // Sample 10 and inspect their Excel files
  let inspected = 0;
  for (const proj of projectsWithoutBom.slice(0, 20)) {
    if (inspected >= 10) break;
    const leadId = proj.lead_id;
    if (!leadId) continue;

    const { data: files } = await supabase.storage.from('proposal-files').list(leadId, { limit: 50 });
    const xlsx = (files ?? []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length === 0) continue;

    const { data: leadData } = await supabase.from('leads').select('customer_name').eq('id', leadId).single();

    console.log(`\n  Project: ${leadData?.customer_name || leadId} (${xlsx.length} xlsx files)`);

    // Inspect first xlsx
    const { data: fileData } = await supabase.storage.from('proposal-files').download(`${leadId}/${xlsx[0].name}`);
    if (!fileData) continue;
    const buffer = Buffer.from(await fileData.arrayBuffer());
    try {
      const info = await inspectExcel(buffer, xlsx[0].name);
      for (const s of info.sheets) {
        console.log(`    Sheet: "${s.name}" (${s.rowCount}r × ${s.colCount}c)`);
        for (const h of s.headerCandidates) {
          console.log(`      Row ${h.row}: [${h.cells.join(' | ')}]`);
        }
        if (s.headerCandidates.length === 0) console.log('      (no header found)');
      }
      inspected++;
    } catch (e: any) {
      console.log(`    Parse error: ${e.message}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
