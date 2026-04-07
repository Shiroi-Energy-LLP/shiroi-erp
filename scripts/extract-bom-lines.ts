/**
 * Phase 2.3-2.4: Extract BOM lines from Excel files in Supabase Storage
 *
 * For each Excel file in proposal-files bucket:
 *   1. Download from Supabase Storage
 *   2. Parse with excel-parser (deterministic, no AI)
 *   3. Match to proposal via lead_id (folder UUID)
 *   4. Insert BOM lines into proposal_bom_lines
 *   5. Update proposal financials (supply/install/GST totals)
 *   6. Log in processing_jobs for audit
 *
 * Concurrency: 5 parallel downloads/parses (Supabase rate limits)
 *
 * Usage:
 *   npx tsx scripts/extract-bom-lines.ts --dry-run    # preview
 *   npx tsx scripts/extract-bom-lines.ts              # live
 *   npx tsx scripts/extract-bom-lines.ts --limit=50   # process first 50
 */

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet, ParsedBOM } from './excel-parser';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Concurrency limiter (simple p-queue replacement) ───

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    const currentIdx = idx++;
    if (currentIdx >= items.length) return;
    results[currentIdx] = await fn(items[currentIdx], currentIdx);
    return next();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ─── Main ───

async function main() {
  const op = '[extract-bom-lines]';
  const dry = isDryRun();
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}, Limit: ${limit === Infinity ? 'ALL' : limit}`);

  // ═══ Step 1: List all Excel files via direct DB query (much faster than storage API) ═══
  console.log(`\n${op} Fetching Excel file list from storage.objects...`);

  let excelFiles: { name: string; size: number; mime_type: string }[] = [];

  // Query storage.objects directly — returns all xlsx files in one query
  const { data: storageRows, error: storageError } = await supabase
    .from('storage_objects_view' as any)
    .select('*')
    .limit(1); // This won't work, we need raw SQL

  // Use the Supabase admin to query storage.objects
  // Since we can't query storage.objects via the REST API directly,
  // we'll use the storage API but do it more efficiently
  // by pre-fetching the list of lead folders that have proposals

  // Get all lead IDs that have proposals (only process those folders)
  const { data: leadsWithProposals } = await supabase
    .from('proposals')
    .select('lead_id')
    .not('lead_id', 'is', null);

  const leadIdsWithProposals = new Set(
    (leadsWithProposals ?? []).map((p) => p.lead_id).filter(Boolean)
  );
  console.log(`${op} ${leadIdsWithProposals.size} leads have proposals — only scanning those folders`);

  // List files only in folders that have proposals
  let totalFiles = 0;
  const leadIds = Array.from(leadIdsWithProposals);

  for (const leadId of leadIds) {
    const { data: folderFiles } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 500 });

    if (!folderFiles) continue;

    for (const f of folderFiles) {
      const fname = f.name.toLowerCase();
      if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
        const meta = f.metadata as Record<string, any> | null;
        excelFiles.push({
          name: `${leadId}/${f.name}`,
          size: meta?.size ?? 0,
          mime_type: meta?.mimetype ?? '',
        });
        totalFiles++;
      }
    }

    if (totalFiles > 0 && totalFiles % 50 === 0) {
      process.stdout.write(`\r${op} Found ${totalFiles} Excel files so far...`);
    }
  }
  console.log(`\n${op} Total Excel files found: ${excelFiles.length}`);


  // Apply limit
  if (excelFiles.length > limit) {
    excelFiles = excelFiles.slice(0, limit);
    console.log(`${op} Limited to first ${limit} files`);
  }

  logMigrationStart('extract-bom-lines', excelFiles.length);

  // ═══ Step 2: Build lead → proposal mapping ═══
  console.log(`${op} Building lead → proposal mapping...`);

  const { data: proposals, error: propError } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, subtotal_supply, subtotal_works')
    .order('revision_number', { ascending: false });

  if (propError || !proposals) {
    console.error(`${op} Failed to fetch proposals:`, propError?.message);
    return;
  }

  // Map lead_id → latest proposal (highest revision)
  const proposalByLeadId = new Map<string, typeof proposals[0]>();
  for (const p of proposals) {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p);
    }
  }
  console.log(`${op} ${proposalByLeadId.size} leads with proposals`);

  // Check existing BOM lines to avoid duplicates
  const { data: existingBom } = await supabase
    .from('proposal_bom_lines')
    .select('proposal_id')
    .limit(10000);

  const proposalsWithBom = new Set((existingBom ?? []).map((b) => b.proposal_id));
  console.log(`${op} ${proposalsWithBom.size} proposals already have BOM lines`);

  // ═══ Step 3: Process Excel files ═══
  let stats = {
    processed: 0,
    parsed: 0,
    matched: 0,
    inserted: 0,
    bomLinesInserted: 0,
    skippedHasBom: 0,
    skippedNoProposal: 0,
    skippedEmpty: 0,
    errors: 0,
  };

  const CONCURRENCY = 5;

  await processInBatches(excelFiles, CONCURRENCY, async (file, idx) => {
    stats.processed++;
    const leadId = file.name.split('/')[0];
    const fileName = file.name.split('/').pop() ?? '';

    // Progress every 50 files
    if (stats.processed % 50 === 0) {
      console.log(`${op} Progress: ${stats.processed}/${excelFiles.length} (matched: ${stats.matched}, BOM lines: ${stats.bomLinesInserted})`);
    }

    // Check if lead has a proposal
    const proposal = proposalByLeadId.get(leadId);
    if (!proposal) {
      stats.skippedNoProposal++;
      return;
    }

    // Skip if proposal already has BOM lines
    if (proposalsWithBom.has(proposal.id)) {
      stats.skippedHasBom++;
      return;
    }

    // Download file
    const { data: fileData, error: dlError } = await supabase.storage
      .from('proposal-files')
      .download(file.name);

    if (dlError || !fileData) {
      stats.errors++;
      return;
    }

    // Parse
    let parsed: ParsedBOM;
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      parsed = await parseCostingSheet(buffer);
      stats.parsed++;
    } catch (e) {
      stats.errors++;
      // Log failed parse
      if (!dry) {
        await supabase.from('processing_jobs').upsert({
          bucket_id: 'proposal-files',
          file_path: file.name,
          file_size: file.size,
          mime_type: file.mime_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          detected_type: 'xlsx',
          status: 'failed',
          parse_method: 'xlsx_deterministic',
          entity_type: 'proposal',
          entity_id: proposal.id,
          error_message: (e as Error).message.substring(0, 500),
        }, { onConflict: 'bucket_id,file_path' });
      }
      return;
    }

    if (parsed.bom_lines.length === 0) {
      stats.skippedEmpty++;
      // Log skipped
      if (!dry) {
        await supabase.from('processing_jobs').upsert({
          bucket_id: 'proposal-files',
          file_path: file.name,
          file_size: file.size,
          mime_type: file.mime_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          detected_type: 'xlsx',
          status: 'skipped',
          parse_method: 'xlsx_deterministic',
          entity_type: 'proposal',
          entity_id: proposal.id,
          extracted_data: { parse_quality: parsed.parse_quality, system_size_kwp: parsed.system_size_kwp },
        }, { onConflict: 'bucket_id,file_path' });
      }
      return;
    }

    stats.matched++;

    if (dry) {
      console.log(`  ${fileName.substring(0, 50).padEnd(52)} → proposal ${proposal.id.substring(0, 8)} | ${parsed.bom_lines.length} lines | ${parsed.parse_quality} | ${parsed.system_size_kwp ?? '?'} kWp`);
      stats.bomLinesInserted += parsed.bom_lines.length;
      return;
    }

    // ─── Insert BOM lines ───
    const bomRows = parsed.bom_lines.map((line) => ({
      proposal_id: proposal.id,
      line_number: line.line_number,
      item_category: line.item_category,
      item_description: line.item_description,
      brand: line.brand,
      model: line.model,
      hsn_code: line.hsn_code,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      total_price: line.total_price,
      gst_rate: line.gst_rate,
      gst_amount: line.total_price * (line.gst_rate / 100),
      gst_type: line.gst_type,
      scope_owner: 'shiroi' as const,
      notes: `[EXTRACTED] From ${fileName} via xlsx_deterministic parser`,
    }));

    const { error: insertError } = await supabase
      .from('proposal_bom_lines')
      .insert(bomRows);

    if (insertError) {
      console.error(`  Insert error for ${fileName}: ${insertError.message}`);
      stats.errors++;
    } else {
      stats.bomLinesInserted += bomRows.length;
      stats.inserted++;
      proposalsWithBom.add(proposal.id); // Prevent re-processing

      // ─── Update proposal financials (fill gaps only) ───
      const updates: Record<string, number | string> = {};

      if (parsed.summary.supply_cost && (!proposal.subtotal_supply || proposal.subtotal_supply === 0)) {
        updates.subtotal_supply = parsed.summary.supply_cost;
      }
      if (parsed.summary.installation_cost && (!proposal.subtotal_works || proposal.subtotal_works === 0)) {
        updates.subtotal_works = parsed.summary.installation_cost;
      }
      if (parsed.summary.total_cost && (!proposal.total_after_discount || proposal.total_after_discount === 0)) {
        updates.total_after_discount = parsed.summary.total_cost;
        updates.total_before_discount = parsed.summary.total_cost;
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabase.from('proposals').update(updates).eq('id', proposal.id);
      }
    }

    // ─── Log processing job ───
    await supabase.from('processing_jobs').upsert({
      bucket_id: 'proposal-files',
      file_path: file.name,
      file_size: file.size,
      mime_type: file.mime_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      detected_type: 'xlsx',
      status: 'completed',
      parse_method: 'xlsx_deterministic',
      entity_type: 'proposal',
      entity_id: proposal.id,
      extracted_data: {
        parse_quality: parsed.parse_quality,
        system_size_kwp: parsed.system_size_kwp,
        bom_line_count: parsed.bom_lines.length,
        summary: parsed.summary,
      },
      confidence_score: parsed.parse_quality === 'high' ? 0.95 : parsed.parse_quality === 'medium' ? 0.75 : 0.5,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'bucket_id,file_path' });
  });

  // ═══ Final stats ═══
  console.log(`\n${op} Results:`);
  console.log(`  Processed:         ${stats.processed}`);
  console.log(`  Parsed OK:         ${stats.parsed}`);
  console.log(`  Matched proposal:  ${stats.matched}`);
  console.log(`  BOM lines:         ${stats.bomLinesInserted}`);
  console.log(`  Proposals updated: ${stats.inserted}`);
  console.log(`  Skip (has BOM):    ${stats.skippedHasBom}`);
  console.log(`  Skip (no proposal):${stats.skippedNoProposal}`);
  console.log(`  Skip (empty parse):${stats.skippedEmpty}`);
  console.log(`  Errors:            ${stats.errors}`);

  logMigrationEnd('extract-bom-lines', {
    processed: stats.processed,
    inserted: stats.bomLinesInserted,
    skipped: stats.skippedNoProposal + stats.skippedEmpty + stats.skippedHasBom,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[extract-bom-lines] Fatal error:', err);
  process.exit(1);
});
