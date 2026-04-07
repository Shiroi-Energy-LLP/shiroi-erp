/**
 * Extract vendor GSTIN, PAN, phone, email from project-files PDFs.
 * These are POs, invoices, delivery challans with vendor details.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
const pdfParse = require('pdf-parse');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const isDryRun = process.argv.includes('--dry-run');

function extractVendorData(text: string): Record<string, any> {
  const result: Record<string, any> = {};

  // GSTIN: 2-digit state + 5-char PAN + 4-digit + 1-char + 1Z + 1-char
  const gstinMatch = text.match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/);
  if (gstinMatch) result.gstin = gstinMatch[1];

  // PAN: 5 alpha + 4 digit + 1 alpha
  const panMatch = text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (panMatch) {
    // Avoid extracting GSTIN's embedded PAN
    const pan = panMatch[1];
    if (!result.gstin || !result.gstin.includes(pan)) {
      result.pan_number = pan;
    } else {
      // Extract PAN from GSTIN
      result.pan_number = result.gstin.substring(2, 12);
    }
  }
  // If we have GSTIN but no PAN, derive it
  if (result.gstin && !result.pan_number) {
    result.pan_number = result.gstin.substring(2, 12);
  }

  // Phone: Indian mobile 10-digit starting with 6-9
  const phoneMatch = text.match(/(?:Ph|Phone|Mobile|Tel|Contact)[:\s.]*(?:\+91[\s-]?)?([6-9]\d{9})\b/i);
  if (phoneMatch) result.phone = phoneMatch[1];
  if (!result.phone) {
    const anyPhone = text.match(/\b([6-9]\d{9})\b/);
    if (anyPhone) result.phone = anyPhone[1];
  }

  // Email
  const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) {
    const email = emailMatch[1].toLowerCase();
    // Skip Shiroi's own email
    if (!email.includes('shiroienergy') && !email.includes('shiroi')) {
      result.email = email;
    }
  }

  // MSME / Udyam number
  const msmeMatch = text.match(/\b(UDYAM-[A-Z]{2}-\d{2}-\d{7})\b/i);
  if (msmeMatch) { result.is_msme = true; result.msme_number = msmeMatch[1].toUpperCase(); }

  // Vendor name — look for common patterns in POs/invoices
  const vendorPatterns = [
    /(?:M\/s\.?|To|Vendor|Supplier)[:\s]*([A-Z][A-Za-z\s&.,]+?)(?:\n|GSTIN|PAN|Address)/,
    /(?:Bill\s*To|Ship\s*To)[:\s]*([A-Z][A-Za-z\s&.,]+?)(?:\n|GSTIN)/,
  ];
  for (const pat of vendorPatterns) {
    const m = text.match(pat);
    if (m) {
      const name = m[1].trim().replace(/[,.]$/, '');
      if (name.length > 3 && name.length < 100 && !name.includes('Shiroi')) {
        result.vendor_name = name;
        break;
      }
    }
  }

  return result;
}

function normalizeVendorName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(pvt|private|ltd|limited|llp|india)\b/g, '')
    .trim();
}

async function main() {
  const op = '[extract-vendor-pdfs]';
  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Get all vendors
  const { data: vendors } = await supabase.from('vendors')
    .select('id, company_name, phone, email, gstin, pan_number, is_msme');

  const vendorByNormName = new Map<string, any>();
  for (const v of vendors ?? []) {
    vendorByNormName.set(normalizeVendorName(v.company_name || ''), v);
  }
  console.log(`${op} ${vendorByNormName.size} vendors in DB`);

  // Shiroi's own GSTIN — skip when found
  const SHIROI_GSTIN = '33AAFCA9741A1Z2';
  const SHIROI_PAN = 'AAFCA9741A';

  // Build project→vendor mapping via POs
  const { data: pos } = await supabase.from('purchase_orders').select('id, project_id, vendor_id');
  const vendorByProject = new Map<string, Set<string>>();
  for (const po of pos ?? []) {
    if (po.project_id && po.vendor_id) {
      if (!vendorByProject.has(po.project_id)) vendorByProject.set(po.project_id, new Set());
      vendorByProject.get(po.project_id)!.add(po.vendor_id);
    }
  }
  console.log(`${op} ${vendorByProject.size} projects with PO→vendor links`);

  // List project-files PDFs
  const { data: folders } = await supabase.storage.from('project-files').list('projects', { limit: 500 });
  if (!folders) { console.log(`${op} No project folders`); return; }

  const pdfFiles: { path: string; projectId: string }[] = [];
  for (const projFolder of folders.filter(f => !f.id)) {
    for (const subdir of ['purchase-orders', 'documents', 'invoices', 'delivery-challans']) {
      const { data: files } = await supabase.storage.from('project-files').list(`projects/${projFolder.name}/${subdir}`, { limit: 100 });
      if (!files) continue;
      for (const f of files) {
        if (f.name.toLowerCase().endsWith('.pdf')) {
          pdfFiles.push({
            path: `projects/${projFolder.name}/${subdir}/${f.name}`,
            projectId: projFolder.name,
          });
        }
      }
    }
  }
  console.log(`${op} ${pdfFiles.length} PDFs to process`);

  let stats = { processed: 0, vendorsUpdated: 0, gstinFound: 0, panFound: 0, phoneFound: 0, emailFound: 0, errors: 0 };
  const vendorUpdates = new Map<string, Record<string, any>>(); // vendorId → updates

  for (let i = 0; i < pdfFiles.length; i++) {
    const { path: filePath } = pdfFiles[i];
    if (i % 20 === 0) console.log(`${op} ${i + 1}/${pdfFiles.length}`);

    const { data: fileData, error: dlErr } = await supabase.storage.from('project-files').download(filePath);
    if (dlErr || !fileData) { stats.errors++; continue; }

    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const result = await pdfParse(buffer);
      text = (result.text || '').trim();
    } catch { stats.errors++; continue; }

    if (text.length < 50) continue;
    stats.processed++;

    const extracted = extractVendorData(text);

    // Skip Shiroi's own GSTIN/PAN
    if (extracted.gstin === SHIROI_GSTIN) delete extracted.gstin;
    if (extracted.pan_number === SHIROI_PAN) delete extracted.pan_number;
    // Skip Shiroi emails
    if (extracted.email && (extracted.email.includes('shiroi') || extracted.email.includes('mail2@'))) delete extracted.email;

    if (!extracted.gstin && !extracted.pan_number && !extracted.phone && !extracted.email) continue;

    if (extracted.gstin) stats.gstinFound++;
    if (extracted.pan_number) stats.panFound++;
    if (extracted.phone) stats.phoneFound++;
    if (extracted.email) stats.emailFound++;

    // Strategy 1: If project has exactly 1 vendor via POs, assign data to that vendor
    const { projectId } = pdfFiles[i];
    const projectVendors = vendorByProject.get(projectId);
    if (projectVendors && projectVendors.size === 1) {
      const vendorId = [...projectVendors][0];
      const vendor = (vendors ?? []).find(v => v.id === vendorId);
      if (vendor) {
        const updates = vendorUpdates.get(vendorId) || {};
        if (extracted.gstin && !vendor.gstin) updates.gstin = extracted.gstin;
        if (extracted.pan_number && !vendor.pan_number) updates.pan_number = extracted.pan_number;
        if (extracted.phone && !vendor.phone) updates.phone = extracted.phone;
        if (extracted.email && !vendor.email) updates.email = extracted.email;
        if (extracted.is_msme !== undefined && !vendor.is_msme) updates.is_msme = extracted.is_msme;
        if (Object.keys(updates).length > 0) vendorUpdates.set(vendorId, updates);
      }
    }

    // Strategy 2: Match by vendor name in text
    if (extracted.vendor_name) {
      const normName = normalizeVendorName(extracted.vendor_name);
      for (const [key, vendor] of vendorByNormName.entries()) {
        if (key.includes(normName) || normName.includes(key) ||
            (key.split(' ')[0] === normName.split(' ')[0] && key.split(' ')[0].length > 3)) {
          const updates = vendorUpdates.get(vendor.id) || {};
          if (extracted.gstin && !vendor.gstin) updates.gstin = extracted.gstin;
          if (extracted.pan_number && !vendor.pan_number) updates.pan_number = extracted.pan_number;
          if (extracted.phone && !vendor.phone) updates.phone = extracted.phone;
          if (extracted.email && !vendor.email) updates.email = extracted.email;
          if (extracted.is_msme !== undefined && !vendor.is_msme) updates.is_msme = extracted.is_msme;
          if (Object.keys(updates).length > 0) vendorUpdates.set(vendor.id, updates);
          break;
        }
      }
    }
  }

  // Apply vendor updates
  console.log(`${op} ${vendorUpdates.size} vendors to update`);
  for (const [vendorId, updates] of vendorUpdates.entries()) {
    if (isDryRun) {
      const vendor = (vendors ?? []).find(v => v.id === vendorId);
      console.log(`  ${vendor?.company_name}: ${JSON.stringify(updates)}`);
    } else {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase.from('vendors').update(updates).eq('id', vendorId);
      if (error) { console.error(`  Error updating vendor ${vendorId}:`, error.message); stats.errors++; }
    }
    stats.vendorsUpdated++;
  }

  console.log(`\n${op} Results:`);
  console.log(`  PDFs processed: ${stats.processed}`);
  console.log(`  Vendors updated: ${stats.vendorsUpdated}`);
  console.log(`  GSTINs found: ${stats.gstinFound}`);
  console.log(`  PANs found: ${stats.panFound}`);
  console.log(`  Phones found: ${stats.phoneFound}`);
  console.log(`  Emails found: ${stats.emailFound}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
