/**
 * Process proposal docs locally in Claude Code session.
 * Extracts: customer name, system size, location, date, pricing, reference number.
 * Updates leads and proposals with gap-fill-only strategy.
 *
 * Usage:
 *   npx tsx scripts/process-proposals-local.ts --offset=0 --batch=50
 *   npx tsx scripts/process-proposals-local.ts --offset=0 --batch=50 --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}
const isDryRun = process.argv.includes('--dry-run');

function getBaseName(filename: string): string {
  return filename
    .replace(/\.(docx|pdf|pptx?)$/i, '')
    .replace(/_?Rev_?\d+/i, '')
    .trim()
    .toLowerCase();
}

function getRevisionNumber(filename: string): number {
  const match = filename.match(/Rev_?(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

// ─── Extraction logic ───

interface ExtractedData {
  customerName?: string;
  referenceNumber?: string;
  proposalDate?: string;
  proposalDateParsed?: string; // ISO date
  location?: string;
  city?: string;
  systemSizeKwp?: number;
  systemType?: 'on_grid' | 'hybrid' | 'off_grid';
  totalCost?: number;
  supplyCost?: number;
  servicesCost?: number;
  gstSupply?: number;
  gstServices?: number;
  pricePerWatt?: number;
  sanctionedLoadKw?: number;
  connectionType?: 'single_phase' | 'three_phase';
  electricityBillNumber?: string;
  panelBrand?: string;
  panelWattage?: number;
  panelCount?: number;
  inverterBrand?: string;
  inverterCapacity?: string;
  structureType?: string;
  paybackYears?: number;
  annualGenerationKwh?: number;
  monthlyGenerationUnits?: number;
}

function extractFromText(text: string): ExtractedData {
  const result: ExtractedData = {};

  // Customer name
  const clientMatch = text.match(/Client[:\s]*(.+?)(?:\n|Reference|Rev\s)/i);
  if (clientMatch) {
    let name = clientMatch[1].trim();
    // Clean up common suffixes
    name = name.replace(/[-–]\s*\d+(?:\.\d+)?\s*(?:KW|kWp).*$/i, '').trim();
    name = name.replace(/\s*\d+(?:\.\d+)?\s*(?:KW|kWp).*$/i, '').trim();
    if (name.length > 2 && name !== '.') result.customerName = name;
  }

  // Reference number
  const refMatch = text.match(/Reference\s*number[:\s]*([^\n]+)/i);
  if (refMatch) result.referenceNumber = refMatch[1].trim();

  // Date - near the top of document
  const topText = text.substring(0, 1000);
  const datePatterns = [
    /(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i,
    /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/,
  ];
  for (const pat of datePatterns) {
    const m = topText.match(pat);
    if (m) {
      result.proposalDate = m[1];
      // Try to parse to ISO
      const parsed = new Date(m[1].replace(/(\d+)(?:st|nd|rd|th)/, '$1'));
      if (!isNaN(parsed.getTime())) {
        result.proposalDateParsed = parsed.toISOString().split('T')[0];
      }
      break;
    }
  }

  // Location
  const locMatch = text.match(/Location[:\s]*(.+?)(?:\n|Reference|Rev\s)/i);
  if (locMatch) {
    const loc = locMatch[1].trim();
    // Skip obviously bad location values
    const badLocations = ['to be decided', 'tbd', 'allotted', 'client', 'site', 'na', 'n/a'];
    const isGoodLocation = loc.length > 2 && !badLocations.some(b => loc.toLowerCase().includes(b));
    if (isGoodLocation) {
      result.location = loc;
    }
  }
  // Extract city from full text regardless of location field
  const knownCities = ['Chennai', 'Coimbatore', 'Madurai', 'Trichy', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Pondicherry', 'Puducherry', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Hosur', 'Kochi', 'Cochin', 'Tirupur', 'Ooty', 'Nagercoil', 'Thanjavur', 'Dindigul', 'Cuddalore'];
  for (const city of knownCities) {
    if (text.toLowerCase().includes(city.toLowerCase())) {
      result.city = city;
      break;
    }
  }

  // System size
  const sizePatterns = [
    /(?:supply\s*and\s*installation\s*of\s*(?:a\s*)?)(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(?:system\s*size|capacity|Total\s*Capacity)[:\s–-]*(?:Total\s*Capacity\s*[–-]?\s*)?(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(?:Quotation\s*(?:For|for)\s*)(\d+(?:\.\d+)?)\s*(?:kWp|KWp|KW|kW)/i,
    /(\d+(?:\.\d+)?)\s*(?:kWp|KWp)\s*(?:on[- ]?grid|hybrid|off[- ]?grid|solar)/i,
  ];
  for (const pat of sizePatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 0 && val < 10000) { // Sanity check
        result.systemSizeKwp = val;
        break;
      }
    }
  }

  // System type
  if (/hybrid/i.test(text.substring(0, 3000))) result.systemType = 'hybrid';
  else if (/off[- ]?grid/i.test(text.substring(0, 3000))) result.systemType = 'off_grid';
  else result.systemType = 'on_grid';

  // Total cost - look for "Total Cost including taxes" pattern
  const totalCostPatterns = [
    /Total\s*Cost\s*including\s*taxes\s*\(?INR\)?\s*[\n\s]*(\d[\d,]+)/i,
    /Total\s*investment[^₹\d]*(?:Rs\.?\s*|₹\s*|INR\s*)?(\d[\d,]+)\s*\/?[-–]?/i,
    /total\s*(?:cost|amount|value)[^₹\d]*(?:Rs\.?\s*|₹\s*|INR\s*)?(\d[\d,]+)/i,
  ];
  for (const pat of totalCostPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 1000) { // Must be > ₹1000 to be a real total
        result.totalCost = val;
        break;
      }
    }
  }

  // Supply cost
  const supplyMatch = text.match(/Supply\s*Cost\s*\(?INR\)?\s*[\n\s]*(\d[\d,]+)/i);
  if (supplyMatch) result.supplyCost = parseFloat(supplyMatch[1].replace(/,/g, ''));

  // Services cost
  const servicesMatch = text.match(/Services?\s*Cost\s*\(?INR\)?[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (servicesMatch) result.servicesCost = parseFloat(servicesMatch[1].replace(/,/g, ''));

  // GST amounts
  const gstSupplyMatch = text.match(/GST\s*@?\s*12%\s*(?:of\s*)?Supply[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (gstSupplyMatch) result.gstSupply = parseFloat(gstSupplyMatch[1].replace(/,/g, ''));

  const gstServicesMatch = text.match(/GST\s*@?\s*18%\s*(?:of\s*)?Service[^0-9\n]*[\n\s]*(\d[\d,]+)/i);
  if (gstServicesMatch) result.gstServices = parseFloat(gstServicesMatch[1].replace(/,/g, ''));

  // Per watt price
  const perWattMatch = text.match(/Rs\.?\s*(\d+(?:\.\d+)?)\s*\/?\s*Watt/i);
  if (perWattMatch) result.pricePerWatt = parseFloat(perWattMatch[1]);

  // Sanctioned load
  const loadMatch = text.match(/Sanctioned\s*Load[:\s]*(\d+(?:\.\d+)?)\s*(?:kW|KW)/i);
  if (loadMatch) result.sanctionedLoadKw = parseFloat(loadMatch[1]);

  // Connection type
  if (/three\s*phase/i.test(text)) result.connectionType = 'three_phase';
  else if (/single\s*phase/i.test(text)) result.connectionType = 'single_phase';

  // Panel info
  const panelWattMatch = text.match(/(\d{3,4})\s*(?:Wp|W)\s*(?:Mono|Poly|Solar|PV|Module|Panel)/i);
  if (panelWattMatch) result.panelWattage = parseInt(panelWattMatch[1]);

  const panelCountMatch = text.match(/(\d+)\s*(?:Nos?|nos?|Numbers?)\s*(?:\d{3,4}\s*Wp|.*?Panel|.*?Module)/i);
  if (panelCountMatch) result.panelCount = parseInt(panelCountMatch[1]);

  // Panel brand
  const panelBrands = ['Trina', 'Adani', 'Waaree', 'JA Solar', 'Canadian Solar', 'Longi', 'Renewsys', 'Pixon', 'Evvo', 'Jinko'];
  for (const brand of panelBrands) {
    if (text.includes(brand)) { result.panelBrand = brand; break; }
  }

  // Inverter brand
  const inverterBrands = ['Goodwe', 'Growatt', 'Deye', 'Sungrow', 'ABB', 'SMA', 'Schneider', 'Solar Edge', 'Soluna', 'Huawei', 'Fronius'];
  for (const brand of inverterBrands) {
    if (text.toLowerCase().includes(brand.toLowerCase())) { result.inverterBrand = brand; break; }
  }

  // Structure type
  if (/elevated|raised?\s*structure/i.test(text)) result.structureType = 'elevated_ms';
  else if (/flush\s*mount|roof\s*mount/i.test(text)) result.structureType = 'flush_mount';
  else if (/ground\s*mount/i.test(text)) result.structureType = 'ground_mount';

  // Payback
  const paybackMatch = text.match(/payback\s*period\s*of\s*(\d+(?:\.\d+)?)\s*years/i);
  if (paybackMatch) result.paybackYears = parseFloat(paybackMatch[1]);

  // Monthly generation
  const monthlyGenMatch = text.match(/(\d[\d,]*)\s*Units?\s*\/?\s*Month/i);
  if (monthlyGenMatch) result.monthlyGenerationUnits = parseInt(monthlyGenMatch[1].replace(/,/g, ''));

  // Electricity bill / consumer / service connection number
  // These are rarely in proposals (they're in separate uploaded EB card scans)
  // Only match very specific patterns with actual numbers
  const billPatterns = [
    /(?:consumer|service\s*connection)\s*(?:no|number)[.:\s]+(\d{6,15})/gi,
    /(?:SC\s*No|TANGEDCO|TNEB)\s*[.:\s]+(\d{6,15})/gi,
    /(?:EB\s*(?:No|Number))[.:\s]+(\d{6,15})/gi,
  ];
  for (const pat of billPatterns) {
    const matches = [...text.matchAll(pat)];
    for (const m of matches) {
      const candidate = m[1].trim();
      if (candidate.length >= 6 && /^\d+$/.test(candidate)) {
        result.electricityBillNumber = candidate;
        break;
      }
    }
    if (result.electricityBillNumber) break;
  }

  return result;
}

// ─── Main ───

async function main() {
  const offset = parseInt(getArg('offset') ?? '0', 10);
  const batch = parseInt(getArg('batch') ?? '50', 10);
  const op = '[process-local]';

  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Fetch leads
  const { data: allLeads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, customer_name, phone, email, address_line1, city, state, pincode, estimated_size_kwp, electricity_bill_number, source, status')
    .is('deleted_at', null);

  if (leadsErr) {
    console.error(`${op} Failed to fetch leads:`, leadsErr.message);
    return;
  }

  const leadById = new Map<string, Record<string, any>>();
  for (const l of allLeads ?? []) {
    leadById.set(l.id, l);
  }

  // Fetch proposals
  const { data: allProposals } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, system_size_kwp, sent_at, subtotal_supply, subtotal_works, gst_supply_amount, gst_works_amount, panel_brand, panel_wattage, panel_count, inverter_brand, structure_type')
    .not('lead_id', 'is', null)
    .order('revision_number', { ascending: false });

  const proposalByLeadId = new Map<string, Record<string, any>>();
  for (const p of allProposals ?? []) {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p);
    }
  }

  // Already processed
  const { data: processed } = await supabase
    .from('processing_jobs')
    .select('file_path')
    .eq('parse_method', 'local_extraction')
    .in('status', ['completed']);
  const processedPaths = new Set((processed ?? []).map(p => p.file_path));

  // List storage folders
  const { data: folders } = await supabase.storage
    .from('proposal-files')
    .list('', { limit: 2000 });

  const leadFolders = (folders ?? [])
    .filter(f => f.id === null)
    .map(f => f.name)
    .filter(name => leadById.has(name));

  console.log(`${op} ${leadFolders.length} lead folders, processing ${offset}–${offset + batch}`);

  const targetLeads = leadFolders.slice(offset, offset + batch);

  let stats = {
    processed: 0,
    extracted: 0,
    leadsUpdated: 0,
    proposalsUpdated: 0,
    skippedAlreadyDone: 0,
    skippedNoFile: 0,
    errors: 0,
  };

  const extractionLog: any[] = [];

  for (let i = 0; i < targetLeads.length; i++) {
    const leadId = targetLeads[i];
    const lead = leadById.get(leadId)!;
    const proposal = proposalByLeadId.get(leadId);

    // List files
    const { data: files } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 100 });

    if (!files || files.length === 0) { stats.skippedNoFile++; continue; }

    // Prefer docx over pdf, latest revision only
    const docxFiles = files.filter(f => f.name.toLowerCase().endsWith('.docx'));
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const docxBaseNames = new Set(docxFiles.map(f => getBaseName(f.name)));
    const uniquePdfs = pdfFiles.filter(f => !docxBaseNames.has(getBaseName(f.name)));

    const candidates = [
      ...docxFiles.map(f => ({ name: f.name, ext: 'docx' as const })),
      ...uniquePdfs.map(f => ({ name: f.name, ext: 'pdf' as const })),
    ];

    // Group by base name, pick latest revision
    const byBaseName = new Map<string, typeof candidates[0]>();
    for (const f of candidates) {
      const base = getBaseName(f.name);
      const rev = getRevisionNumber(f.name);
      const existing = byBaseName.get(base);
      if (!existing || getRevisionNumber(existing.name) < rev) {
        byBaseName.set(base, f);
      }
    }

    const finalCandidates = [...byBaseName.values()]
      .filter(f => !processedPaths.has(`${leadId}/${f.name}`))
      .sort((a, b) => getRevisionNumber(b.name) - getRevisionNumber(a.name));

    if (finalCandidates.length === 0) { stats.skippedAlreadyDone++; continue; }

    const targetFile = finalCandidates[0];
    const filePath = `${leadId}/${targetFile.name}`;
    stats.processed++;

    if (i % 10 === 0) {
      console.log(`${op} ${i + 1}/${targetLeads.length}: ${targetFile.name} (${lead.customer_name})`);
    }

    // Download
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(filePath);

    if (dlErr || !fileData) {
      stats.errors++;
      continue;
    }

    // Extract text
    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (targetFile.ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value.trim();
      } else {
        const result = await (pdfParse as any).default(buffer);
        text = (result.text || '').trim();
      }
    } catch (e) {
      stats.errors++;
      continue;
    }

    if (text.length < 100) continue;

    // Extract structured data
    const extracted = extractFromText(text);
    stats.extracted++;

    // ─── Update lead (fill gaps only) ───
    const leadUpdates: Record<string, any> = {};
    if (extracted.city && !lead.city) leadUpdates.city = extracted.city;
    // Only use location as address if it's not just a city/state name
    if (extracted.location && !lead.address_line1 && extracted.location.length > 15) {
      leadUpdates.address_line1 = extracted.location;
    }
    if (extracted.systemSizeKwp && !lead.estimated_size_kwp) {
      leadUpdates.estimated_size_kwp = extracted.systemSizeKwp;
    }
    if (extracted.electricityBillNumber && !lead.electricity_bill_number) {
      leadUpdates.electricity_bill_number = extracted.electricityBillNumber;
    }

    if (Object.keys(leadUpdates).length > 0) {
      if (isDryRun) {
        console.log(`  Lead ${lead.customer_name}: ${JSON.stringify(leadUpdates)}`);
      } else {
        leadUpdates.updated_at = new Date().toISOString();
        const { error } = await supabase.from('leads').update(leadUpdates).eq('id', leadId);
        if (error) { console.error(`  Lead update error:`, error.message); stats.errors++; }
      }
      stats.leadsUpdated++;
    }

    // ─── Update proposal (fill gaps only) ───
    if (proposal) {
      const propUpdates: Record<string, any> = {};

      if (extracted.totalCost && (!proposal.total_after_discount || proposal.total_after_discount === 0)) {
        propUpdates.total_after_discount = extracted.totalCost;
        propUpdates.total_before_discount = extracted.totalCost; // Usually same for Shiroi
      }
      if (extracted.supplyCost && (!proposal.subtotal_supply || proposal.subtotal_supply === 0)) {
        propUpdates.subtotal_supply = extracted.supplyCost;
      }
      if (extracted.servicesCost && (!proposal.subtotal_works || proposal.subtotal_works === 0)) {
        propUpdates.subtotal_works = extracted.servicesCost;
      }
      if (extracted.gstSupply && (!proposal.gst_supply_amount || proposal.gst_supply_amount === 0)) {
        propUpdates.gst_supply_amount = extracted.gstSupply;
      }
      if (extracted.gstServices && (!proposal.gst_works_amount || proposal.gst_works_amount === 0)) {
        propUpdates.gst_works_amount = extracted.gstServices;
      }
      if (extracted.systemSizeKwp && (!proposal.system_size_kwp || proposal.system_size_kwp === 0)) {
        propUpdates.system_size_kwp = extracted.systemSizeKwp;
      }
      if (extracted.proposalDateParsed && !proposal.sent_at) {
        propUpdates.sent_at = extracted.proposalDateParsed;
      }
      if (extracted.panelBrand && !proposal.panel_brand) {
        propUpdates.panel_brand = extracted.panelBrand;
      }
      if (extracted.panelWattage && !proposal.panel_wattage) {
        propUpdates.panel_wattage = extracted.panelWattage;
      }
      if (extracted.panelCount && !proposal.panel_count) {
        propUpdates.panel_count = extracted.panelCount;
      }
      if (extracted.inverterBrand && !proposal.inverter_brand) {
        propUpdates.inverter_brand = extracted.inverterBrand;
      }
      if (extracted.structureType && !proposal.structure_type) {
        propUpdates.structure_type = extracted.structureType;
      }

      if (Object.keys(propUpdates).length > 0) {
        if (isDryRun) {
          console.log(`  Proposal ${proposal.id.substring(0, 8)}: ${JSON.stringify(propUpdates)}`);
        } else {
          propUpdates.updated_at = new Date().toISOString();
          const { error } = await supabase.from('proposals').update(propUpdates).eq('id', proposal.id);
          if (error) { console.error(`  Proposal update error:`, error.message); stats.errors++; }
        }
        stats.proposalsUpdated++;
      }
    }

    // Log to processing_jobs
    if (!isDryRun) {
      await supabase.from('processing_jobs').upsert({
        bucket_id: 'proposal-files',
        file_path: filePath,
        status: 'completed',
        parse_method: 'local_extraction',
        entity_type: 'proposal',
        entity_id: proposal?.id,
        extracted_data: extracted,
        confidence_score: 0.85,
        completed_at: new Date().toISOString(),
      }, { onConflict: 'bucket_id,file_path' });
    }

    // Save to extraction log for review
    extractionLog.push({
      leadId: leadId.substring(0, 8),
      leadName: lead.customer_name,
      leadStatus: lead.status,
      fileName: targetFile.name.substring(0, 50),
      ...extracted,
    });
  }

  // Write extraction log
  const logPath = path.resolve(__dirname, 'data/extraction-log.json');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(extractionLog, null, 2));

  console.log(`\n${op} Results:`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Extracted: ${stats.extracted}`);
  console.log(`  Leads updated: ${stats.leadsUpdated}`);
  console.log(`  Proposals updated: ${stats.proposalsUpdated}`);
  console.log(`  Skipped (already done): ${stats.skippedAlreadyDone}`);
  console.log(`  Skipped (no file): ${stats.skippedNoFile}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Log: ${logPath}`);
}

main().catch(err => {
  console.error('[process-local] Fatal:', err);
  process.exit(1);
});
