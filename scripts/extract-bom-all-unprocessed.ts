/**
 * Extract BOM from ALL unprocessed Excel files in Supabase Storage.
 *
 * Previous scripts only matched files where folder UUID = lead_id of a proposal.
 * This script processes ALL Excel files and uses multiple matching strategies:
 *   1. Direct: folder UUID matches a lead with a proposal
 *   2. Filename: file name contains customer name from a completed project
 *   3. Lead name: the folder's lead customer_name matches a project customer
 *
 * Priority: completed projects without BOM first.
 *
 * Usage:
 *   npx tsx scripts/extract-bom-all-unprocessed.ts --dry-run
 *   npx tsx scripts/extract-bom-all-unprocessed.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet } from './excel-parser';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const DRY_RUN = process.argv.includes('--dry-run');
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ProjectTarget {
  project_id: string;
  lead_id: string;
  proposal_id: string;
  customer_name: string;
  name_tokens: string[];  // lowercase tokens for matching
}

interface ExcelFile {
  path: string;         // full storage path: "uuid/filename.xlsx"
  folder_id: string;    // the lead UUID folder
  filename: string;     // just the filename
  folder_lead_name: string | null; // customer_name of the folder's lead
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
    // Remove generic words that cause false matches
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'rev', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension'].includes(t));
}

function matchScore(fileTokens: string[], targetTokens: string[]): number {
  if (targetTokens.length === 0 || fileTokens.length === 0) return 0;
  let matches = 0;
  for (const t of targetTokens) {
    if (fileTokens.some(ft => ft.includes(t) || t.includes(ft))) matches++;
  }
  // Require at least 2 matching tokens or 1 if it's a long distinctive name
  if (matches === 0) return 0;
  if (matches === 1 && targetTokens.length > 1) {
    // Single match only counts if the matching token is distinctive (6+ chars)
    const matchedToken = targetTokens.find(t => fileTokens.some(ft => ft.includes(t) || t.includes(ft)));
    if (!matchedToken || matchedToken.length < 6) return 0;
  }
  return matches / Math.max(targetTokens.length, 1);
}

async function main() {
  const op = '[bom-all-unprocessed]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Step 1: Get completed projects without BOM ═══
  console.log(`\n${op} Step 1: Finding completed projects without BOM...`);

  // Get all proposal IDs that have BOM lines — paginate through all rows
  // Supabase default limit is 1000 rows per request
  const bomProposalIds = new Set<string>();
  let bomOffset = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: batch } = await supabase
      .from('proposal_bom_lines')
      .select('proposal_id')
      .range(bomOffset, bomOffset + PAGE_SIZE - 1);
    if (!batch || batch.length === 0) break;
    batch.forEach(b => bomProposalIds.add(b.proposal_id));
    bomOffset += batch.length;
    if (batch.length < PAGE_SIZE) break;
  }
  console.log(`${op} ${bomProposalIds.size} proposals already have BOM (scanned ${bomOffset} rows)`);

  // Get all projects with their proposals
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, proposal_id, status')
    .not('proposal_id', 'is', null)
    .not('lead_id', 'is', null);

  // Get all leads for name lookup
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .is('deleted_at', null);

  const leadNameMap = new Map<string, string>();
  (allLeads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  // Get all proposals
  const { data: allProposals } = await supabase
    .from('proposals')
    .select('id, lead_id')
    .not('lead_id', 'is', null);

  const proposalByLeadId = new Map<string, string>();
  (allProposals ?? []).forEach(p => {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p.id);
    }
  });

  // Build target list: completed projects without BOM
  const targets: ProjectTarget[] = [];
  for (const pr of (projects ?? [])) {
    if (!bomProposalIds.has(pr.proposal_id)) {
      const name = leadNameMap.get(pr.lead_id) || '';
      targets.push({
        project_id: pr.id,
        lead_id: pr.lead_id,
        proposal_id: pr.proposal_id,
        customer_name: name,
        name_tokens: tokenize(name),
      });
    }
  }

  const completedTargets = targets.filter(t =>
    (projects ?? []).find(p => p.id === t.project_id)?.status === 'completed'
  );
  const otherTargets = targets.filter(t =>
    (projects ?? []).find(p => p.id === t.project_id)?.status !== 'completed'
  );

  console.log(`${op} ${completedTargets.length} completed projects without BOM`);
  console.log(`${op} ${otherTargets.length} other projects without BOM`);

  // ═══ Step 2: Get ALL unprocessed Excel files ═══
  console.log(`\n${op} Step 2: Listing all Excel files in proposal-files...`);

  const excelFiles: ExcelFile[] = [];
  const leadIds = Array.from(new Set((allLeads ?? []).map(l => l.id)));

  // Scan all lead folders for Excel files
  let scanned = 0;
  for (const leadId of leadIds) {
    scanned++;
    if (scanned % 100 === 0) process.stdout.write(`\r${op} Scanning folders: ${scanned}/${leadIds.length}...`);

    const { data: files } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 100 });

    if (!files) continue;

    for (const f of files) {
      const fname = f.name.toLowerCase();
      if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
        excelFiles.push({
          path: `${leadId}/${f.name}`,
          folder_id: leadId,
          filename: f.name,
          folder_lead_name: leadNameMap.get(leadId) || null,
        });
      }
    }
    // Small delay every 50 folders to avoid rate limits
    if (scanned % 50 === 0) await sleep(200);
  }
  console.log(`\n${op} Found ${excelFiles.length} total Excel files`);

  // ═══ Step 3: For each target, find the best Excel file ═══
  console.log(`\n${op} Step 3: Matching Excel files to projects...`);

  type Match = { target: ProjectTarget; file: ExcelFile; strategy: string; score: number };
  const matches: Match[] = [];

  const allTargets = [...completedTargets, ...otherTargets];

  for (const target of allTargets) {
    let bestMatch: Match | null = null;

    for (const file of excelFiles) {
      // Strategy 1: Direct lead_id match (folder = project's lead)
      if (file.folder_id === target.lead_id) {
        // Prefer costing/BOM files
        const isCostingFile = /costing|bom|cost/i.test(file.filename);
        const score = isCostingFile ? 1.0 : 0.8;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { target, file, strategy: 'direct_lead', score };
        }
        continue;
      }

      // Strategy 2: Filename matches customer name
      const fileTokens = tokenize(file.filename);
      const nameScore = matchScore(fileTokens, target.name_tokens);
      if (nameScore >= 0.5) {
        const score = 0.7 * nameScore;
        if (!bestMatch || (bestMatch.strategy !== 'direct_lead' && score > bestMatch.score)) {
          bestMatch = { target, file, strategy: 'filename_match', score };
        }
        continue;
      }

      // Strategy 3: Folder lead name matches target customer name
      if (file.folder_lead_name) {
        const folderTokens = tokenize(file.folder_lead_name);
        const folderNameScore = matchScore(folderTokens, target.name_tokens);
        if (folderNameScore >= 0.5) {
          // Check if this folder's files have a costing sheet
          const isCostingFile = /costing|bom|cost/i.test(file.filename);
          const score = 0.6 * folderNameScore + (isCostingFile ? 0.1 : 0);
          if (!bestMatch || (bestMatch.strategy !== 'direct_lead' && score > bestMatch.score)) {
            bestMatch = { target, file, strategy: 'folder_name_match', score };
          }
        }
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
    }
  }

  console.log(`${op} ${matches.length} matches found out of ${allTargets.length} targets`);

  // Show match breakdown
  const byStrategy = { direct_lead: 0, filename_match: 0, folder_name_match: 0 };
  matches.forEach(m => {
    byStrategy[m.strategy as keyof typeof byStrategy]++;
  });
  console.log(`${op} By strategy: direct=${byStrategy.direct_lead}, filename=${byStrategy.filename_match}, folder_name=${byStrategy.folder_name_match}`);

  // ═══ Step 4: Also process unmatched Excel files that have proposals without BOM ═══
  // These are the 914 files that weren't in processing_jobs
  const matchedPaths = new Set(matches.map(m => m.file.path));
  const unmatched: ExcelFile[] = excelFiles.filter(f => {
    if (matchedPaths.has(f.path)) return false;
    // Does this folder's lead have a proposal without BOM?
    const proposalId = proposalByLeadId.get(f.folder_id);
    if (proposalId && !bomProposalIds.has(proposalId)) return true;
    return false;
  });
  console.log(`${op} ${unmatched.length} additional files for proposals without BOM (not matched to projects)`);

  // ═══ Step 5: Process matches ═══
  console.log(`\n${op} Step 5: Processing ${matches.length} matched files + ${unmatched.length} unmatched...`);

  let stats = {
    downloaded: 0, parsed: 0, matched_inserted: 0, lines_inserted: 0,
    empty_parse: 0, download_errors: 0, parse_errors: 0, insert_errors: 0,
  };

  // Process matches (projects without BOM) first
  for (let i = 0; i < matches.length; i++) {
    const { target, file, strategy, score } = matches[i];

    if (i % 20 === 0) {
      console.log(`${op} Progress: ${i}/${matches.length} (inserted: ${stats.matched_inserted}, lines: ${stats.lines_inserted})`);
    }

    // Double-check BOM doesn't already exist (another file might have been processed)
    if (bomProposalIds.has(target.proposal_id)) continue;

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(file.path);

    if (dlErr || !fileData) { stats.download_errors++; continue; }
    stats.downloaded++;

    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const parsed = await parseCostingSheet(buffer);
      stats.parsed++;

      if (parsed.bom_lines.length === 0) {
        stats.empty_parse++;
        if (DRY_RUN) console.log(`  EMPTY: ${file.filename} → ${target.customer_name} [${strategy}]`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  MATCH: ${file.filename} → ${target.customer_name} [${strategy}] = ${parsed.bom_lines.length} lines`);
        stats.matched_inserted++;
        stats.lines_inserted += parsed.bom_lines.length;
        bomProposalIds.add(target.proposal_id);
        continue;
      }

      // Insert BOM lines
      const rows = parsed.bom_lines.map(line => {
        const totalPrice = line.total_price || (line.quantity * line.unit_price) || 0;
        const gstRate = line.gst_rate || (line.gst_type === 'works_contract' ? 18 : 12);
        const gstAmount = totalPrice * (gstRate / 100);
        return {
          proposal_id: target.proposal_id,
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
          notes: `[EXTRACTED] From ${file.filename} via ${strategy} match`,
        };
      });

      const { error: insertErr } = await supabase
        .from('proposal_bom_lines')
        .insert(rows);

      if (insertErr) {
        console.error(`  Insert error for ${target.customer_name}: ${insertErr.message}`);
        stats.insert_errors++;
        await sleep(2000);
        continue;
      }

      stats.matched_inserted++;
      stats.lines_inserted += rows.length;
      bomProposalIds.add(target.proposal_id);

      // Update proposal financials if gaps exist
      if (parsed.summary.total_cost || parsed.summary.supply_cost) {
        const { data: prop } = await supabase
          .from('proposals')
          .select('total_after_discount, subtotal_supply, subtotal_works')
          .eq('id', target.proposal_id)
          .single();

        if (prop) {
          const updates: Record<string, any> = {};
          if (parsed.summary.supply_cost && (!prop.subtotal_supply || Number(prop.subtotal_supply) === 0)) {
            updates.subtotal_supply = parsed.summary.supply_cost;
          }
          if (parsed.summary.installation_cost && (!prop.subtotal_works || Number(prop.subtotal_works) === 0)) {
            updates.subtotal_works = parsed.summary.installation_cost;
          }
          if (parsed.summary.total_cost && (!prop.total_after_discount || Number(prop.total_after_discount) === 0)) {
            updates.total_after_discount = parsed.summary.total_cost;
            updates.total_before_discount = parsed.summary.total_cost;
          }
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from('proposals').update(updates).eq('id', target.proposal_id);
          }
        }
      }

      await sleep(500);
    } catch (e: any) {
      stats.parse_errors++;
    }
  }

  // Process unmatched files (proposals without BOM, direct lead match)
  console.log(`\n${op} Processing ${unmatched.length} unmatched files (direct lead→proposal)...`);
  for (let i = 0; i < unmatched.length; i++) {
    const file = unmatched[i];
    const proposalId = proposalByLeadId.get(file.folder_id);
    if (!proposalId || bomProposalIds.has(proposalId)) continue;

    // Skip non-costing files (ROI, gantt, shading, load analysis)
    if (/roi|gantt|shading|load.*vs|payback|generation.*pattern/i.test(file.filename)) continue;

    if (i % 20 === 0) {
      console.log(`${op} Unmatched progress: ${i}/${unmatched.length}`);
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(file.path);

    if (dlErr || !fileData) { stats.download_errors++; continue; }
    stats.downloaded++;

    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const parsed = await parseCostingSheet(buffer);
      stats.parsed++;

      if (parsed.bom_lines.length === 0) { stats.empty_parse++; continue; }

      if (DRY_RUN) {
        console.log(`  UNMATCHED: ${file.filename} → proposal ${proposalId.substring(0, 8)} (${file.folder_lead_name}) = ${parsed.bom_lines.length} lines`);
        stats.matched_inserted++;
        stats.lines_inserted += parsed.bom_lines.length;
        bomProposalIds.add(proposalId);
        continue;
      }

      const rows = parsed.bom_lines.map(line => {
        const totalPrice = line.total_price || (line.quantity * line.unit_price) || 0;
        const gstRate = line.gst_rate || (line.gst_type === 'works_contract' ? 18 : 12);
        const gstAmount = totalPrice * (gstRate / 100);
        return {
          proposal_id: proposalId,
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
          notes: `[EXTRACTED] From ${file.filename} via direct_lead match`,
        };
      });

      const { error: insertErr } = await supabase
        .from('proposal_bom_lines')
        .insert(rows);

      if (insertErr) {
        stats.insert_errors++;
        await sleep(2000);
        continue;
      }

      stats.matched_inserted++;
      stats.lines_inserted += rows.length;
      bomProposalIds.add(proposalId);
      await sleep(500);
    } catch (e: any) {
      stats.parse_errors++;
    }
  }

  // ═══ Final stats ═══
  console.log(`\n${op} ═══ Results ═══`);
  console.log(`  Downloaded:      ${stats.downloaded}`);
  console.log(`  Parsed OK:       ${stats.parsed}`);
  console.log(`  BOM inserted:    ${stats.matched_inserted} proposals`);
  console.log(`  BOM lines:       ${stats.lines_inserted}`);
  console.log(`  Empty parse:     ${stats.empty_parse}`);
  console.log(`  Download errors: ${stats.download_errors}`);
  console.log(`  Parse errors:    ${stats.parse_errors}`);
  console.log(`  Insert errors:   ${stats.insert_errors}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
