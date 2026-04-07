/**
 * Extract data from 112 PPTX commercial proposals.
 * Uses JSZip to parse slide XML for text content.
 * Updates existing proposals or creates new ones.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const isDryRun = process.argv.includes('--dry-run');

function extractFromSlideText(text: string): Record<string, any> {
  const result: Record<string, any> = {};

  // System size
  const sizePatterns = [
    /(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW|MWp)\s*/i,
    /(?:capacity|system)[:\s]*(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|MWp)/i,
  ];
  for (const pat of sizePatterns) {
    const m = text.match(pat);
    if (m) {
      let val = parseFloat(m[1]);
      if (text.toLowerCase().includes('mwp') && val < 100) val *= 1000; // Convert MWp to kWp
      if (val > 0 && val < 100000) { result.system_size_kwp = val; break; }
    }
  }

  // Total cost
  const totalPatterns = [
    /Total\s*(?:Cost|Investment|Amount)[^0-9]*(\d[\d,]+)/i,
    /(?:Rs\.?|INR|\u20B9)\s*(\d[\d,]+)\s*(?:Lakhs?|Lacs?)/i,
    /(\d[\d,]+)\s*(?:Lakhs?|Lacs?)/i,
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      if (/Lakh|Lac/i.test(m[0])) val *= 100000;
      if (val > 10000) { result.total_after_discount = val; result.total_before_discount = val; break; }
    }
  }

  // System type
  if (/hybrid/i.test(text)) result.system_type = 'hybrid';
  else if (/off[- ]?grid/i.test(text)) result.system_type = 'off_grid';
  else result.system_type = 'on_grid';

  // Date
  const dateMatch = text.match(/(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i);
  if (dateMatch) {
    const parsed = new Date(dateMatch[1].replace(/(\d+)(?:st|nd|rd|th)/, '$1'));
    if (!isNaN(parsed.getTime())) result.sent_at = parsed.toISOString().split('T')[0];
  }

  // Panel / inverter brands
  const panelBrands = ['Trina', 'Adani', 'Waaree', 'JA Solar', 'Canadian Solar', 'Longi', 'Renewsys', 'Pixon', 'Jinko'];
  for (const b of panelBrands) { if (text.includes(b)) { result.panel_brand = b; break; } }
  const invBrands = ['Goodwe', 'Growatt', 'Deye', 'Sungrow', 'ABB', 'SMA', 'Schneider', 'Solar Edge', 'Huawei'];
  for (const b of invBrands) { if (text.toLowerCase().includes(b.toLowerCase())) { result.inverter_brand = b; break; } }

  return result;
}

async function main() {
  const op = '[extract-pptx]';
  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  const JSZip = (await import('jszip')).default;

  // Get all PPTX files
  const { data: folders } = await supabase.storage.from('proposal-files').list('', { limit: 2000 });
  const pptxFiles: { leadId: string; name: string }[] = [];

  for (const folder of (folders ?? []).filter(f => !f.id)) {
    const { data: files } = await supabase.storage.from('proposal-files').list(folder.name, { limit: 100 });
    if (!files) continue;
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.pptx')) {
        pptxFiles.push({ leadId: folder.name, name: f.name });
      }
    }
  }
  console.log(`${op} Found ${pptxFiles.length} PPTX files`);

  // Get existing proposals
  const { data: proposals } = await supabase.from('proposals').select('id, lead_id, total_after_discount, system_size_kwp, sent_at, panel_brand, inverter_brand').not('lead_id', 'is', null);
  const proposalByLead = new Map<string, any>();
  for (const p of proposals ?? []) {
    if (p.lead_id && !proposalByLead.has(p.lead_id)) proposalByLead.set(p.lead_id, p);
  }

  let stats = { processed: 0, updated: 0, created: 0, errors: 0, noData: 0 };

  for (let i = 0; i < pptxFiles.length; i++) {
    const { leadId, name } = pptxFiles[i];
    const filePath = `${leadId}/${name}`;

    if (i % 10 === 0) console.log(`${op} ${i + 1}/${pptxFiles.length}: ${name.substring(0, 50)}`);

    const { data: fileData, error: dlErr } = await supabase.storage.from('proposal-files').download(filePath);
    if (dlErr || !fileData) { stats.errors++; continue; }

    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      const slideFiles = Object.keys(zip.files)
        .filter(f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
        .sort();
      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async('text');
        const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g);
        if (matches) texts.push(matches.map(m => m.replace(/<a:t>|<\/a:t>/g, '')).join(' '));
      }
      text = texts.join('\n\n').trim();
    } catch { stats.errors++; continue; }

    if (text.length < 50) { stats.noData++; continue; }
    stats.processed++;

    const extracted = extractFromSlideText(text);
    if (!extracted.system_size_kwp && !extracted.total_after_discount) { stats.noData++; continue; }

    const existing = proposalByLead.get(leadId);

    if (existing) {
      // Update gaps
      const updates: Record<string, any> = {};
      if (extracted.total_after_discount && (!existing.total_after_discount || existing.total_after_discount === 0)) {
        updates.total_after_discount = extracted.total_after_discount;
        updates.total_before_discount = extracted.total_after_discount;
      }
      if (extracted.sent_at && !existing.sent_at) updates.sent_at = extracted.sent_at;
      if (extracted.panel_brand && !existing.panel_brand) updates.panel_brand = extracted.panel_brand;
      if (extracted.inverter_brand && !existing.inverter_brand) updates.inverter_brand = extracted.inverter_brand;

      if (Object.keys(updates).length > 0) {
        if (!isDryRun) {
          updates.updated_at = new Date().toISOString();
          await supabase.from('proposals').update(updates).eq('id', existing.id);
        }
        stats.updated++;
      }
    } else {
      // Create new proposal
      if (!isDryRun) {
        await supabase.from('proposals').insert({
          lead_id: leadId,
          system_size_kwp: extracted.system_size_kwp || 5,
          system_type: extracted.system_type || 'on_grid',
          total_after_discount: extracted.total_after_discount || null,
          total_before_discount: extracted.total_before_discount || null,
          sent_at: extracted.sent_at || null,
          panel_brand: extracted.panel_brand || null,
          inverter_brand: extracted.inverter_brand || null,
          status: 'sent',
          prepared_by: '01905444-3fec-4993-af84-a2ccdc348ffd',
        });
      }
      stats.created++;
    }
  }

  console.log(`\n${op} Results:`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Updated: ${stats.updated}`);
  console.log(`  Created: ${stats.created}`);
  console.log(`  No data: ${stats.noData}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
