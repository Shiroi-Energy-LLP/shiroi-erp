/**
 * Create proposal records for leads that have storage files but no proposal in DB.
 * Downloads latest revision Word/PDF, extracts data, inserts proposal record.
 *
 * Usage:
 *   npx tsx scripts/create-proposals-from-docs.ts --offset=0 --batch=200
 *   npx tsx scripts/create-proposals-from-docs.ts --offset=0 --batch=200 --dry-run
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const isDryRun = process.argv.includes('--dry-run');
function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

function getBaseName(filename: string): string {
  return filename.replace(/\.(docx|pdf|pptx?)$/i, '').replace(/_?Rev_?\d+/i, '').trim().toLowerCase();
}
function getRevisionNumber(filename: string): number {
  const match = filename.match(/Rev_?(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

function extractFromText(text: string): Record<string, any> {
  const result: Record<string, any> = {};

  // System size
  const sizePatterns = [
    /(?:supply\s*and\s*installation\s*of\s*(?:a\s*)?)(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(?:system\s*size|capacity|Total\s*Capacity)[:\s\u2013-]*(?:Total\s*Capacity\s*[\u2013-]?\s*)?(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(?:Quotation\s*(?:For|for)\s*)(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(\d+(?:\.\d+)?)\s*(?:kWp|KWp)\s*(?:on[- ]?grid|hybrid|off[- ]?grid|solar)/i,
  ];
  for (const pat of sizePatterns) {
    const m = text.match(pat);
    if (m) { const v = parseFloat(m[1]); if (v > 0 && v < 10000) { result.system_size_kwp = v; break; } }
  }

  // System type
  if (/hybrid/i.test(text.substring(0, 3000))) result.system_type = 'hybrid';
  else if (/off[- ]?grid/i.test(text.substring(0, 3000))) result.system_type = 'off_grid';
  else result.system_type = 'on_grid';

  // Total cost
  const totalPatterns = [
    /Total\s*Cost\s*including\s*taxes\s*\(?INR\)?\s*[\n\s]*(\d[\d,]+)/i,
    /Total\s*investment[^\u20B9\d]*(?:Rs\.?\s*|\u20B9\s*|INR\s*)?(\d[\d,]+)\s*\/?[\u2013-]?/i,
    /total\s*(?:cost|amount|value)[^\u20B9\d]*(?:Rs\.?\s*|\u20B9\s*|INR\s*)?(\d[\d,]+)/i,
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > 1000) { result.total_after_discount = v; result.total_before_discount = v; break; } }
  }

  // Supply / services / GST
  const supplyMatch = text.match(/Supply\s*Cost\s*\(?INR\)?\s*[\n\s]*(\d[\d,]+)/i);
  if (supplyMatch) result.subtotal_supply = parseFloat(supplyMatch[1].replace(/,/g, ''));
  const servicesMatch = text.match(/Services?\s*Cost\s*\(?INR\)?[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (servicesMatch) result.subtotal_works = parseFloat(servicesMatch[1].replace(/,/g, ''));
  const gstSupply = text.match(/GST\s*@?\s*12%\s*(?:of\s*)?Supply[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (gstSupply) result.gst_supply_amount = parseFloat(gstSupply[1].replace(/,/g, ''));
  const gstWorks = text.match(/GST\s*@?\s*18%\s*(?:of\s*)?Service[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (gstWorks) result.gst_works_amount = parseFloat(gstWorks[1].replace(/,/g, ''));

  // Date
  const topText = text.substring(0, 1000);
  const dateMatch = topText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i);
  if (dateMatch) {
    const parsed = new Date(dateMatch[1].replace(/(\d+)(?:st|nd|rd|th)/, '$1'));
    if (!isNaN(parsed.getTime())) result.sent_at = parsed.toISOString().split('T')[0];
  }

  // Reference number
  const refMatch = text.match(/Reference\s*number[:\s]*([^\n]+)/i);
  if (refMatch) result.proposal_number = refMatch[1].trim();

  // Panel/inverter/structure
  const panelBrands = ['Trina', 'Adani', 'Waaree', 'JA Solar', 'Canadian Solar', 'Longi', 'Renewsys', 'Pixon', 'Evvo', 'Jinko'];
  for (const b of panelBrands) { if (text.includes(b)) { result.panel_brand = b; break; } }
  const invBrands = ['Goodwe', 'Growatt', 'Deye', 'Sungrow', 'ABB', 'SMA', 'Schneider', 'Solar Edge', 'Soluna', 'Huawei', 'Fronius'];
  for (const b of invBrands) { if (text.toLowerCase().includes(b.toLowerCase())) { result.inverter_brand = b; break; } }
  const panelW = text.match(/(\d{3,4})\s*(?:Wp|W)\s*(?:Mono|Poly|Solar|PV|Module|Panel)/i);
  if (panelW) result.panel_wattage = parseInt(panelW[1]);
  const panelC = text.match(/(\d+)\s*(?:Nos?|nos?|Numbers?)\s*(?:\d{3,4}\s*Wp|.*?Panel|.*?Module)/i);
  if (panelC) result.panel_count = parseInt(panelC[1]);
  if (/elevated|raised?\s*structure/i.test(text)) result.structure_type = 'elevated_ms';
  else if (/flush\s*mount|roof\s*mount/i.test(text)) result.structure_type = 'flush_mount';
  else if (/ground\s*mount/i.test(text)) result.structure_type = 'ground_mount';

  return result;
}

async function main() {
  const offset = parseInt(getArg('offset') ?? '0', 10);
  const batch = parseInt(getArg('batch') ?? '200', 10);
  const op = '[create-proposals]';
  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Get leads WITHOUT proposals
  const { data: leads1 } = await supabase.from('leads')
    .select('id, customer_name, estimated_size_kwp')
    .is('deleted_at', null).range(0, 999);
  const { data: leads2 } = await supabase.from('leads')
    .select('id, customer_name, estimated_size_kwp')
    .is('deleted_at', null).range(1000, 1999);
  const allLeads = [...(leads1 ?? []), ...(leads2 ?? [])];
  const leadById = new Map(allLeads.map(l => [l.id, l]));

  const { data: existingProposals } = await supabase.from('proposals')
    .select('lead_id').not('lead_id', 'is', null);
  const leadsWithProposals = new Set((existingProposals ?? []).map(p => p.lead_id));

  // Get storage folders
  const { data: folders } = await supabase.storage.from('proposal-files').list('', { limit: 2000 });
  const leadFolders = (folders ?? []).filter(f => f.id === null).map(f => f.name)
    .filter(name => leadById.has(name) && !leadsWithProposals.has(name));

  console.log(`${op} ${leadFolders.length} leads with files but no proposal`);
  const targets = leadFolders.slice(offset, offset + batch);
  console.log(`${op} Processing ${offset}–${offset + batch} (${targets.length} leads)`);

  let stats = { created: 0, skippedNoDoc: 0, skippedNoData: 0, errors: 0 };

  for (let i = 0; i < targets.length; i++) {
    const leadId = targets[i];
    const lead = leadById.get(leadId)!;

    if (i % 20 === 0) console.log(`${op} ${i + 1}/${targets.length}: ${lead.customer_name}`);

    // List files
    const { data: files } = await supabase.storage.from('proposal-files').list(leadId, { limit: 100 });
    if (!files) continue;

    // Find best doc (prefer docx, latest revision, skip PDF duplicates)
    const docxFiles = files.filter(f => f.name.toLowerCase().endsWith('.docx'));
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const docxBases = new Set(docxFiles.map(f => getBaseName(f.name)));
    const uniquePdfs = pdfFiles.filter(f => !docxBases.has(getBaseName(f.name)));

    const candidates = [
      ...docxFiles.map(f => ({ name: f.name, ext: 'docx' as const })),
      ...uniquePdfs.map(f => ({ name: f.name, ext: 'pdf' as const })),
    ];

    // Pick latest revision
    const byBase = new Map<string, typeof candidates[0]>();
    for (const f of candidates) {
      const base = getBaseName(f.name);
      const rev = getRevisionNumber(f.name);
      const existing = byBase.get(base);
      if (!existing || getRevisionNumber(existing.name) < rev) byBase.set(base, f);
    }

    const best = [...byBase.values()].sort((a, b) => getRevisionNumber(b.name) - getRevisionNumber(a.name));
    if (best.length === 0) { stats.skippedNoDoc++; continue; }

    const targetFile = best[0];
    const filePath = `${leadId}/${targetFile.name}`;

    // Download and extract text
    const { data: fileData, error: dlErr } = await supabase.storage.from('proposal-files').download(filePath);
    if (dlErr || !fileData) { stats.errors++; continue; }

    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (targetFile.ext === 'docx') {
        text = (await mammoth.extractRawText({ buffer })).value.trim();
      } else {
        // pdf-parse v2: class-based API
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          text = (result.text ?? '').trim();
        } finally {
          await parser.destroy();
        }
      }
    } catch { stats.errors++; continue; }

    if (text.length < 100) { stats.skippedNoData++; continue; }

    const extracted = extractFromText(text);

    // Create proposal record
    // Generate proposal number: SHIROI/PRP/YYYY-YY/NNNN
    const year = extracted.sent_at ? new Date(extracted.sent_at).getFullYear() : 2024;
    const fyEnd = year < 2025 ? year + 1 : year;
    const seqNum = String(offset + i + 1).padStart(4, '0');

    const proposal = {
      lead_id: leadId,
      proposal_number: extracted.proposal_number || `SHIROI/PRP/${fyEnd - 1}-${String(fyEnd).slice(-2)}/${seqNum}`,
      revision_number: 0,
      system_size_kwp: extracted.system_size_kwp || lead.estimated_size_kwp || 5,
      system_type: extracted.system_type || 'on_grid',
      total_after_discount: extracted.total_after_discount || 0,
      total_before_discount: extracted.total_before_discount || 0,
      subtotal_supply: extracted.subtotal_supply || 0,
      subtotal_works: extracted.subtotal_works || 0,
      gst_supply_amount: extracted.gst_supply_amount || 0,
      gst_works_amount: extracted.gst_works_amount || 0,
      sent_at: extracted.sent_at || null,
      panel_brand: extracted.panel_brand || null,
      panel_wattage: extracted.panel_wattage || null,
      panel_count: extracted.panel_count || null,
      inverter_brand: extracted.inverter_brand || null,
      structure_type: extracted.structure_type || null,
      status: 'sent',
      prepared_by: '01905444-3fec-4993-af84-a2ccdc348ffd', // Premkumar
      valid_until: extracted.sent_at ? new Date(new Date(extracted.sent_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };

    if (isDryRun) {
      console.log(`  CREATE: ${lead.customer_name} → ${extracted.system_size_kwp || '?'}kWp, ₹${extracted.total_after_discount || '?'}`);
    } else {
      const { error } = await supabase.from('proposals').insert(proposal);
      if (error) {
        if (i < 5) console.error(`  Error: ${error.message}`);
        stats.errors++;
        continue;
      }
    }
    stats.created++;
  }

  console.log(`\n${op} Results:`);
  console.log(`  Created: ${stats.created}`);
  console.log(`  Skipped (no doc): ${stats.skippedNoDoc}`);
  console.log(`  Skipped (no data): ${stats.skippedNoData}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
