/**
 * Extract BOM from Excel files for proposals that don't have BOM yet.
 * Simpler version that processes one file at a time to avoid DB overload.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet } from './excel-parser';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const op = '[bom-remaining]';

  // Get proposals without BOM
  const { data: allProposals, error: propErr } = await supabase
    .from('proposals')
    .select('id, lead_id')
    .not('lead_id', 'is', null)
    .range(0, 999);

  if (propErr) {
    console.error(`${op} Failed to fetch proposals:`, propErr.message);
    // Retry after delay
    await sleep(5000);
    const { data: retry, error: retryErr } = await supabase
      .from('proposals')
      .select('id, lead_id')
      .not('lead_id', 'is', null)
      .range(0, 999);
    if (retryErr) { console.error(`${op} Retry failed:`, retryErr.message); return; }
    allProposals?.push(...(retry ?? []));
  }

  console.log(`${op} ${(allProposals ?? []).length} proposals fetched`);

  // Get existing BOM proposal IDs (paginate to get all)
  const bomIds: string[] = [];
  let bomOffset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('proposal_bom_lines')
      .select('proposal_id')
      .range(bomOffset, bomOffset + 4999);
    if (!batch || batch.length === 0) break;
    bomIds.push(...batch.map(b => b.proposal_id));
    bomOffset += batch.length;
    if (batch.length < 5000) break;
  }
  const hasBom = new Set(bomIds);
  console.log(`${op} ${hasBom.size} proposals already have BOM`);

  const missing = (allProposals ?? []).filter(p => !hasBom.has(p.id) && p.lead_id);
  console.log(`${op} ${missing.length} proposals missing BOM — checking for Excel files`);

  let stats = { processed: 0, matched: 0, lines: 0, noFile: 0, empty: 0, errors: 0 };

  for (let i = 0; i < missing.length; i++) {
    const { id: proposalId, lead_id: leadId } = missing[i];

    // Find xlsx files for this lead
    const { data: files } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 50 });

    const xlsx = (files ?? []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length === 0) { stats.noFile++; continue; }

    // Process the first xlsx (usually the costing sheet)
    const targetFile = xlsx.sort((a, b) => {
      // Prefer files with 'costing' or 'bom' in name
      const scoreA = /costing|bom|cost/i.test(a.name) ? 10 : 0;
      const scoreB = /costing|bom|cost/i.test(b.name) ? 10 : 0;
      return scoreB - scoreA;
    })[0];

    stats.processed++;
    if (i % 10 === 0) console.log(`${op} ${i + 1}/${missing.length} (matched: ${stats.matched}, lines: ${stats.lines})`);

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(`${leadId}/${targetFile.name}`);

    if (dlErr || !fileData) { stats.errors++; continue; }

    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const parsed = await parseCostingSheet(buffer);

      if (parsed.bom_lines.length === 0) { stats.empty++; continue; }

      // Insert BOM lines
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
        };
      });

      const { error: insertErr } = await supabase
        .from('proposal_bom_lines')
        .insert(rows);

      if (insertErr) {
        console.error(`  Insert error for ${targetFile.name}: ${insertErr.message}`);
        stats.errors++;
        // Back off on errors
        await sleep(2000);
        continue;
      }

      stats.matched++;
      stats.lines += rows.length;

      // Small delay between inserts to be gentle on DB
      await sleep(500);
    } catch (e: any) {
      stats.errors++;
    }
  }

  console.log(`\n${op} Results:`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Matched: ${stats.matched}`);
  console.log(`  BOM lines inserted: ${stats.lines}`);
  console.log(`  No xlsx file: ${stats.noFile}`);
  console.log(`  Empty parse: ${stats.empty}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
