/**
 * Extract BOM from ALL Excel files, matching by Project Name INSIDE the sheet.
 *
 * Shiroi's costing sheets have BOM tabs with "Project Name: <customer>" in the header.
 * This script reads that field and matches to projects/proposals by customer name.
 *
 * Also handles: direct lead_id folder match, filename match, folder lead name match.
 *
 * Usage:
 *   npx tsx scripts/extract-bom-by-sheet-name.ts --dry-run
 *   npx tsx scripts/extract-bom-by-sheet-name.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet } from './excel-parser';
import ExcelJS from 'exceljs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const DRY_RUN = process.argv.includes('--dry-run');
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function cellToString(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object' && 'result' in (val as any)) {
    return String((val as any).result ?? '');
  }
  return String(val).trim();
}

/** Extract project names from BOM sheet headers */
function extractProjectNames(workbook: ExcelJS.Workbook): string[] {
  const names: string[] = [];
  for (const ws of workbook.worksheets) {
    // Check first 10 rows for "Project Name" field
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= Math.min(ws.columnCount, 10); c++) {
        const text = cellToString(row.getCell(c)).toLowerCase();
        if (/project\s*name|client\s*name|customer\s*name/i.test(text)) {
          // The value is in the next cell(s)
          for (let nc = c + 1; nc <= Math.min(ws.columnCount, c + 3); nc++) {
            const val = cellToString(row.getCell(nc));
            if (val && val.length > 2 && !/rev|date|0|null/i.test(val)) {
              names.push(val.trim());
            }
          }
        }
      }
    }
  }
  return [...new Set(names)];
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'rev', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension', 'kw'].includes(t));
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
  const op = '[bom-by-sheet]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Step 1: Get proposals without BOM ═══
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

  // ═══ Step 2: Build name → proposal map for ALL proposals without BOM ═══
  const { data: allProposals } = await supabase
    .from('proposals')
    .select('id, lead_id')
    .not('lead_id', 'is', null);

  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .is('deleted_at', null);

  const leadNameMap = new Map<string, string>();
  (allLeads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  // proposal_id → { lead_id, customer_name }
  const proposalInfo = new Map<string, { lead_id: string; customer_name: string }>();
  (allProposals ?? []).forEach(p => {
    if (p.lead_id) {
      proposalInfo.set(p.id, {
        lead_id: p.lead_id,
        customer_name: leadNameMap.get(p.lead_id) || '',
      });
    }
  });

  // lead_id → proposal_id (first match)
  const proposalByLeadId = new Map<string, string>();
  (allProposals ?? []).forEach(p => {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p.id);
    }
  });

  // customer_name → proposal_ids (for fuzzy matching from sheet project names)
  // Only for proposals without BOM
  type ProposalTarget = { proposal_id: string; lead_id: string; customer_name: string };
  const noBomTargets: ProposalTarget[] = [];
  for (const [pid, info] of proposalInfo) {
    if (!bomProposalIds.has(pid)) {
      noBomTargets.push({ proposal_id: pid, ...info });
    }
  }
  console.log(`${op} ${noBomTargets.length} proposals need BOM`);

  // Get projects for priority ordering
  const { data: projects } = await supabase
    .from('projects')
    .select('id, proposal_id, status');

  const projectByProposalId = new Map<string, { id: string; status: string }>();
  (projects ?? []).forEach(p => {
    if (p.proposal_id) projectByProposalId.set(p.proposal_id, { id: p.id, status: p.status });
  });

  // ═══ Step 3: Scan ALL Excel files ═══
  console.log(`\n${op} Scanning all Excel files...`);

  const leadIds = Array.from(new Set((allLeads ?? []).map(l => l.id)));
  type FileInfo = { path: string; folder_id: string; filename: string };
  const allFiles: FileInfo[] = [];

  let scanned = 0;
  for (const leadId of leadIds) {
    scanned++;
    if (scanned % 100 === 0) process.stdout.write(`\r${op} Scanning: ${scanned}/${leadIds.length}...`);

    const { data: files } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 100 });
    if (!files) continue;

    for (const f of files) {
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        allFiles.push({ path: `${leadId}/${f.name}`, folder_id: leadId, filename: f.name });
      }
    }
    if (scanned % 50 === 0) await sleep(100);
  }
  console.log(`\n${op} Found ${allFiles.length} Excel files`);

  // ═══ Step 4: Download, parse, match by project name inside sheet ═══
  console.log(`\n${op} Processing files...`);

  let stats = {
    downloaded: 0, parsed: 0, bomInserted: 0, linesInserted: 0,
    emptyParse: 0, alreadyHasBom: 0, noMatch: 0,
    matchDirect: 0, matchSheetName: 0, matchFilename: 0, matchFolderName: 0,
    downloadErr: 0, parseErr: 0, insertErr: 0,
  };

  // Skip non-BOM files
  const SKIP_PATTERNS = /roi|gantt|shading|load.*vs|payback|generation.*pattern|irr|string.*calc|untitled/i;

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];

    if (i % 50 === 0) {
      console.log(`${op} [${i}/${allFiles.length}] inserted=${stats.bomInserted} lines=${stats.linesInserted} (direct=${stats.matchDirect} sheet=${stats.matchSheetName} file=${stats.matchFilename} folder=${stats.matchFolderName})`);
    }

    // Skip obviously non-BOM files
    if (SKIP_PATTERNS.test(file.filename)) continue;

    // Download
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(file.path);
    if (dlErr || !fileData) { stats.downloadErr++; continue; }
    stats.downloaded++;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await fileData.arrayBuffer());
    } catch { stats.downloadErr++; continue; }

    // Parse BOM
    let parsed;
    let workbook: ExcelJS.Workbook | null = null;
    try {
      parsed = await parseCostingSheet(buffer);
      stats.parsed++;
    } catch { stats.parseErr++; continue; }

    if (parsed.bom_lines.length === 0) { stats.emptyParse++; continue; }

    // Also load workbook to extract project names
    let sheetProjectNames: string[] = [];
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      sheetProjectNames = extractProjectNames(workbook);
    } catch { /* ok, fall through to other matching */ }

    // ─── Match to a proposal ───
    let matchedProposalId: string | null = null;
    let matchStrategy = '';

    // Strategy 1: Direct lead_id match (folder is the lead)
    const directProposalId = proposalByLeadId.get(file.folder_id);
    if (directProposalId && !bomProposalIds.has(directProposalId)) {
      matchedProposalId = directProposalId;
      matchStrategy = 'direct';
    }

    // Strategy 2: Project name INSIDE the sheet matches a target
    if (!matchedProposalId && sheetProjectNames.length > 0) {
      for (const sheetName of sheetProjectNames) {
        let bestScore = 0;
        let bestTarget: ProposalTarget | null = null;

        for (const target of noBomTargets) {
          if (bomProposalIds.has(target.proposal_id)) continue;
          const score = fuzzyMatch(sheetName, target.customer_name);
          if (score > bestScore && score >= 0.4) {
            bestScore = score;
            bestTarget = target;
          }
        }

        if (bestTarget) {
          matchedProposalId = bestTarget.proposal_id;
          matchStrategy = `sheet_name("${sheetName}"→"${bestTarget.customer_name}")`;
          break;
        }
      }
    }

    // Strategy 3: Filename matches a target
    if (!matchedProposalId) {
      for (const target of noBomTargets) {
        if (bomProposalIds.has(target.proposal_id)) continue;
        const score = fuzzyMatch(file.filename, target.customer_name);
        if (score >= 0.5) {
          matchedProposalId = target.proposal_id;
          matchStrategy = `filename("${file.filename}"→"${target.customer_name}")`;
          break;
        }
      }
    }

    // Strategy 4: Folder lead name matches a target
    if (!matchedProposalId) {
      const folderLeadName = leadNameMap.get(file.folder_id);
      if (folderLeadName) {
        for (const target of noBomTargets) {
          if (bomProposalIds.has(target.proposal_id)) continue;
          const score = fuzzyMatch(folderLeadName, target.customer_name);
          if (score >= 0.5) {
            matchedProposalId = target.proposal_id;
            matchStrategy = `folder_name("${folderLeadName}"→"${target.customer_name}")`;
            break;
          }
        }
      }
    }

    if (!matchedProposalId) { stats.noMatch++; continue; }
    if (bomProposalIds.has(matchedProposalId)) { stats.alreadyHasBom++; continue; }

    // Determine priority
    const project = projectByProposalId.get(matchedProposalId);
    const targetName = proposalInfo.get(matchedProposalId)?.customer_name || '?';

    if (DRY_RUN) {
      const isCompleted = project?.status === 'completed' ? ' [COMPLETED]' : '';
      console.log(`  ${matchStrategy.split('(')[0]}: ${file.filename} → ${targetName}${isCompleted} = ${parsed.bom_lines.length} lines`);
      bomProposalIds.add(matchedProposalId);
      stats.bomInserted++;
      stats.linesInserted += parsed.bom_lines.length;
      if (matchStrategy.startsWith('direct')) stats.matchDirect++;
      else if (matchStrategy.startsWith('sheet')) stats.matchSheetName++;
      else if (matchStrategy.startsWith('filename')) stats.matchFilename++;
      else if (matchStrategy.startsWith('folder')) stats.matchFolderName++;
      continue;
    }

    // Insert BOM lines
    const rows = parsed.bom_lines.map(line => {
      const totalPrice = line.total_price || (line.quantity * line.unit_price) || 0;
      const gstRate = line.gst_rate || (line.gst_type === 'works_contract' ? 18 : 12);
      const gstAmount = totalPrice * (gstRate / 100);
      return {
        proposal_id: matchedProposalId!,
        line_number: line.line_number,
        item_category: line.item_category,
        item_description: line.item_description || 'Unnamed item',
        brand: line.brand,
        hsn_code: line.hsn_code,
        quantity: line.quantity || 1,
        unit: line.unit || 'LS',
        unit_price: line.unit_price || 0,
        total_price: totalPrice,
        gst_rate: gstRate,
        gst_type: line.gst_type || 'supply',
        gst_amount: Math.round(gstAmount * 100) / 100,
        scope_owner: line.scope_owner || 'shiroi',
        notes: `[EXTRACTED] From ${file.filename} via ${matchStrategy.split('(')[0]} match`,
      };
    });

    const { error: insertErr } = await supabase
      .from('proposal_bom_lines')
      .insert(rows);

    if (insertErr) {
      console.error(`  Insert error for ${targetName}: ${insertErr.message}`);
      stats.insertErr++;
      await sleep(2000);
      continue;
    }

    bomProposalIds.add(matchedProposalId);
    stats.bomInserted++;
    stats.linesInserted += rows.length;
    if (matchStrategy.startsWith('direct')) stats.matchDirect++;
    else if (matchStrategy.startsWith('sheet')) stats.matchSheetName++;
    else if (matchStrategy.startsWith('filename')) stats.matchFilename++;
    else if (matchStrategy.startsWith('folder')) stats.matchFolderName++;

    // Update proposal financials if gaps exist
    if (parsed.summary.total_cost || parsed.summary.supply_cost) {
      const { data: prop } = await supabase
        .from('proposals')
        .select('total_after_discount, subtotal_supply, subtotal_works')
        .eq('id', matchedProposalId)
        .single();
      if (prop) {
        const updates: Record<string, any> = {};
        if (parsed.summary.supply_cost && (!prop.subtotal_supply || Number(prop.subtotal_supply) === 0))
          updates.subtotal_supply = parsed.summary.supply_cost;
        if (parsed.summary.installation_cost && (!prop.subtotal_works || Number(prop.subtotal_works) === 0))
          updates.subtotal_works = parsed.summary.installation_cost;
        if (parsed.summary.total_cost && (!prop.total_after_discount || Number(prop.total_after_discount) === 0)) {
          updates.total_after_discount = parsed.summary.total_cost;
          updates.total_before_discount = parsed.summary.total_cost;
        }
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await supabase.from('proposals').update(updates).eq('id', matchedProposalId);
        }
      }
    }

    await sleep(300);
  }

  console.log(`\n${op} ═══ Results ═══`);
  console.log(`  Downloaded:      ${stats.downloaded}`);
  console.log(`  Parsed OK:       ${stats.parsed}`);
  console.log(`  BOM inserted:    ${stats.bomInserted} proposals`);
  console.log(`  BOM lines:       ${stats.linesInserted}`);
  console.log(`  Match direct:    ${stats.matchDirect}`);
  console.log(`  Match sheet:     ${stats.matchSheetName}`);
  console.log(`  Match filename:  ${stats.matchFilename}`);
  console.log(`  Match folder:    ${stats.matchFolderName}`);
  console.log(`  Empty parse:     ${stats.emptyParse}`);
  console.log(`  Already has BOM: ${stats.alreadyHasBom}`);
  console.log(`  No match:        ${stats.noMatch}`);
  console.log(`  Download errors: ${stats.downloadErr}`);
  console.log(`  Parse errors:    ${stats.parseErr}`);
  console.log(`  Insert errors:   ${stats.insertErr}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
