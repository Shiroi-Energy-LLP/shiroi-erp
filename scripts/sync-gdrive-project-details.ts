/**
 * Sync project details from Google Drive confirmed project spreadsheets.
 *
 * Extracts from "Project details" + "Notes" tabs:
 *   - Start date, end date, commissioning date
 *   - Budget (project value), actual cost, margin
 *   - Location / address
 *   - Contact name, phone
 *   - Panel/inverter make
 *   - System type (on_grid/hybrid), structure type
 *
 * Fill-gaps-only: never overwrite existing non-null/non-zero values.
 *
 * Usage:
 *   npx tsx scripts/sync-gdrive-project-details.ts --dry-run
 *   npx tsx scripts/sync-gdrive-project-details.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const DRY_RUN = process.argv.includes('--dry-run');
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function tokenize(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension', 'service', 'work'].includes(t));
}

function fuzzyMatch(name1: string, name2: string): number {
  const t1 = tokenize(name1), t2 = tokenize(name2);
  if (!t1.length || !t2.length) return 0;
  let m = 0;
  for (const t of t1) if (t2.some(x => x.includes(t) || t.includes(x))) m++;
  return m / Math.max(t1.length, t2.length);
}

function parseDate(val: string): string | null {
  if (!val || val.length < 4) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch { return null; }
}

function parseCurrency(val: string): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function extractSize(val: string): number | null {
  const mw = val.match(/(\d+\.?\d*)\s*(?:MWp|MW)/i);
  if (mw) return parseFloat(mw[1]) * 1000;
  const kw = val.match(/(\d+\.?\d*)\s*(?:kWp|KWp|kW|KW)/i);
  if (kw) return parseFloat(kw[1]);
  return null;
}

function normalizePhone(val: string): string | null {
  if (!val) return null;
  const digits = val.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

// Build a lookup from the flat key-value grid of the "Project details" tab
function parseProjectDetails(rows: string[][]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      const key = (row[i] || '').trim().toLowerCase().replace(/[:\s]+$/, '');
      const val = (row[i + 1] || '').trim();
      if (key && val && val.length > 0 && !/^[₹$]?0?\.?0*$/.test(val)) {
        kv[key] = val;
      }
    }
  }
  return kv;
}

function parseNotes(rows: string[][]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      const key = (row[i] || '').trim().toLowerCase().replace(/[:\s]+$/, '');
      const val = (row[i + 1] || '').trim();
      if (key && val && val.length > 0) {
        kv[key] = val;
      }
    }
  }
  // Look for address block (rows after "Billing Address" or "Ship To")
  let addressLines: string[] = [];
  let inAddress = false;
  for (const row of rows) {
    const firstCell = (row[0] || '').trim();
    if (/billing.*address|ship.*to|site.*address/i.test(firstCell)) {
      inAddress = true;
      continue;
    }
    if (inAddress && firstCell && firstCell.length > 5 && !/total|location|file/i.test(firstCell)) {
      addressLines.push(firstCell);
    } else if (inAddress && (!firstCell || firstCell.length <= 2)) {
      inAddress = false;
    }
  }
  if (addressLines.length > 0) kv['_address'] = addressLines.join(', ');
  return kv;
}

async function main() {
  const op = '[sync-gdrive-details]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  // Load DB data
  const { data: projects } = await supabase.from('projects').select('id, lead_id, proposal_id, status, actual_start_date, actual_end_date, commissioned_date, contracted_value, site_city, site_address_line1, panel_brand, inverter_brand, structure_type, system_size_kwp');
  const { data: leads } = await supabase.from('leads').select('id, customer_name, phone, city, address_line1, estimated_size_kwp').is('deleted_at', null);
  const { data: proposals } = await supabase.from('proposals').select('id, lead_id, total_after_discount, system_size_kwp, system_type, gross_margin_pct');

  const leadNameMap = new Map<string, string>();
  (leads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  type Target = {
    project: typeof projects extends (infer T)[] | null ? T : never;
    lead: typeof leads extends (infer T)[] | null ? T : never;
    proposal: typeof proposals extends (infer T)[] | null ? T : never;
  };
  const targetsByName = new Map<string, Target>();

  for (const pr of (projects ?? [])) {
    if (!pr.lead_id || !pr.proposal_id) continue;
    const lead = (leads ?? []).find(l => l.id === pr.lead_id);
    const proposal = (proposals ?? []).find(p => p.id === pr.proposal_id);
    if (lead && proposal) {
      targetsByName.set(lead.customer_name, { project: pr, lead, proposal });
    }
  }

  // Scan Google Drive
  const rootRes = await drive.files.list({
    q: `'1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id,name)',
  });
  const yearFolders = (rootRes.data.files || []).filter(f => /confirmed/i.test(f.name || '')).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let stats = { folders: 0, matched: 0, projectUpdates: 0, leadUpdates: 0, proposalUpdates: 0, noMatch: 0, noSheet: 0, errors: 0 };

  for (const yearFolder of yearFolders) {
    console.log(`\n${op} === ${yearFolder.name} ===`);
    const projRes = await drive.files.list({
      q: `'${yearFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name)', pageSize: 200,
    });

    for (const folder of (projRes.data.files || [])) {
      stats.folders++;
      const folderName = folder.name || '';

      // Match to DB
      let bestTarget: Target | null = null;
      let bestScore = 0;
      for (const [name, target] of targetsByName.entries()) {
        const score = fuzzyMatch(folderName, name);
        if (score > bestScore) { bestScore = score; bestTarget = target; }
      }
      if (!bestTarget || bestScore < 0.4) {
        if (DRY_RUN && stats.noMatch < 10) console.log(`  NO MATCH: ${folderName} (best score: ${bestScore.toFixed(2)})`);
        stats.noMatch++;
        continue;
      }

      // Find spreadsheet
      const filesRes = await drive.files.list({
        q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id,name)',
      });
      const spreadsheet = (filesRes.data.files || [])[0];
      if (!spreadsheet) { stats.noSheet++; continue; }

      stats.matched++;

      // Read Project details and Notes
      let details: Record<string, string> = {};
      let notes: Record<string, string> = {};
      try {
        const d = await sheetsApi.spreadsheets.values.get({
          spreadsheetId: spreadsheet.id!, range: "'Project details'!A1:K30",
        });
        details = parseProjectDetails((d.data.values || []) as string[][]);
      } catch {}
      try {
        const n = await sheetsApi.spreadsheets.values.get({
          spreadsheetId: spreadsheet.id!, range: "'Notes'!A1:K30",
        });
        notes = parseNotes((n.data.values || []) as string[][]);
      } catch {}

      // Build updates
      const projectUpdates: Record<string, any> = {};
      const leadUpdates: Record<string, any> = {};
      const proposalUpdates: Record<string, any> = {};

      // Start date
      const startDate = parseDate(details['start date'] || '');
      if (startDate && !bestTarget.project.actual_start_date) projectUpdates.actual_start_date = startDate;

      // End date
      const endDate = parseDate(details['end date'] || '');
      if (endDate && !bestTarget.project.actual_end_date) projectUpdates.actual_end_date = endDate;

      // Commissioning date
      const commDate = parseDate(details['sys commissinoned on'] || details['system commissinoned on'] || details['system commissioned on'] || '');
      if (commDate && !bestTarget.project.commissioned_date) projectUpdates.commissioned_date = commDate;

      // Location → project site_city
      const location = details['location'] || '';
      if (location && !bestTarget.project.site_city) projectUpdates.site_city = location;

      // Panel make
      const panelMake = details['panel make'] || '';
      if (panelMake && !bestTarget.project.panel_brand) {
        projectUpdates.panel_brand = panelMake.split('/')[0].trim();
        // Try to extract wattage and count
        const wattMatch = panelMake.match(/(\d+)\s*[Ww]p/);
        if (wattMatch) projectUpdates.panel_wattage = parseInt(wattMatch[1]);
        const countMatch = panelMake.match(/(\d+)\s*[Nn]os/);
        if (countMatch) projectUpdates.panel_count = parseInt(countMatch[1]);
      }

      // Inverter make
      const invMake = details['inverter make'] || '';
      if (invMake && !bestTarget.project.inverter_brand) {
        projectUpdates.inverter_brand = invMake.split('/')[0].trim();
      }

      // Structure type from category
      const catStr = (details['category'] || '').toLowerCase();
      if (!bestTarget.project.structure_type) {
        if (/elevated/i.test(catStr)) projectUpdates.structure_type = 'elevated_ms';
        else if (/mini.*rail/i.test(catStr)) projectUpdates.structure_type = 'mini_rail';
        else if (/ground/i.test(catStr)) projectUpdates.structure_type = 'ground_mount';
        else if (/carport/i.test(catStr)) projectUpdates.structure_type = 'carport';
      }

      // System size on project
      const sizeStr2 = details['system size'] || '';
      const size2 = extractSize(sizeStr2);
      if (size2 && (!bestTarget.project.system_size_kwp || Number(bestTarget.project.system_size_kwp) === 0)) {
        projectUpdates.system_size_kwp = size2;
      }

      // Budget → contracted_value
      const budget = parseCurrency(details['budget'] || '');
      if (budget > 0 && (!bestTarget.project.contracted_value || Number(bestTarget.project.contracted_value) === 0)) {
        projectUpdates.contracted_value = budget;
      }

      // Project value from notes
      const projectValue = parseCurrency(notes['project value'] || '');
      if (projectValue > 0 && (!bestTarget.proposal.total_after_discount || Number(bestTarget.proposal.total_after_discount) === 0)) {
        proposalUpdates.total_after_discount = projectValue;
        proposalUpdates.total_before_discount = projectValue;
      }

      // Location → lead city
      if (location && !bestTarget.lead.city) leadUpdates.city = location;

      // Address from notes
      const address = notes['_address'] || '';
      if (address && !bestTarget.lead.address_line1) leadUpdates.address_line1 = address;

      // Contact phone
      const phone = normalizePhone(notes['contact number'] || details['contact number'] || '');
      if (phone && (!bestTarget.lead.phone || /^[0-9]{14}$/.test(bestTarget.lead.phone))) {
        leadUpdates.phone = phone;
      }

      // System size
      const sizeStr = details['system size'] || '';
      const size = extractSize(sizeStr);
      if (size && (!bestTarget.lead.estimated_size_kwp || Number(bestTarget.lead.estimated_size_kwp) === 0)) {
        leadUpdates.estimated_size_kwp = size;
      }
      if (size && (!bestTarget.proposal.system_size_kwp || Number(bestTarget.proposal.system_size_kwp) === 0)) {
        proposalUpdates.system_size_kwp = size;
      }

      // Margin
      const marginStr = details['actual margin'] || details['considred margin'] || '';
      const margin = parseFloat(marginStr.replace(/[%\s]/g, ''));
      if (margin > 0 && (!bestTarget.proposal.gross_margin_pct || Number(bestTarget.proposal.gross_margin_pct) === 0)) {
        proposalUpdates.gross_margin_pct = margin;
      }

      // System type from category
      const category = (details['category'] || '').toLowerCase();
      if (!bestTarget.proposal.system_type || bestTarget.proposal.system_type === 'on_grid') {
        if (/hybrid/i.test(category)) proposalUpdates.system_type = 'hybrid';
        else if (/off.*grid/i.test(category)) proposalUpdates.system_type = 'off_grid';
      }

      // Log updates
      const hasUpdates = Object.keys(projectUpdates).length + Object.keys(leadUpdates).length + Object.keys(proposalUpdates).length;
      if (hasUpdates > 0) {
        const updates = [
          ...Object.keys(projectUpdates).map(k => `project.${k}`),
          ...Object.keys(leadUpdates).map(k => `lead.${k}`),
          ...Object.keys(proposalUpdates).map(k => `proposal.${k}`),
        ];
        console.log(`  ${folderName} → ${bestTarget.lead.customer_name}: ${updates.join(', ')}`);
      }

      if (DRY_RUN) {
        if (Object.keys(projectUpdates).length) stats.projectUpdates++;
        if (Object.keys(leadUpdates).length) stats.leadUpdates++;
        if (Object.keys(proposalUpdates).length) stats.proposalUpdates++;
        continue;
      }

      // Apply updates
      if (Object.keys(projectUpdates).length > 0) {
        projectUpdates.updated_at = new Date().toISOString();
        const { error } = await supabase.from('projects').update(projectUpdates).eq('id', bestTarget.project.id);
        if (error) { console.error(`  Error updating project: ${error.message}`); stats.errors++; }
        else stats.projectUpdates++;
      }
      if (Object.keys(leadUpdates).length > 0) {
        leadUpdates.updated_at = new Date().toISOString();
        const { error } = await supabase.from('leads').update(leadUpdates).eq('id', bestTarget.lead.id);
        if (error) { console.error(`  Error updating lead: ${error.message}`); stats.errors++; }
        else stats.leadUpdates++;
      }
      if (Object.keys(proposalUpdates).length > 0) {
        proposalUpdates.updated_at = new Date().toISOString();
        const { error } = await supabase.from('proposals').update(proposalUpdates).eq('id', bestTarget.proposal.id);
        if (error) { console.error(`  Error updating proposal: ${error.message}`); stats.errors++; }
        else stats.proposalUpdates++;
      }

      await sleep(100);
    }
    await sleep(300);
  }

  console.log(`\n${op} ═══ Results ═══`);
  console.log(`  Folders scanned:    ${stats.folders}`);
  console.log(`  Matched to DB:      ${stats.matched}`);
  console.log(`  Projects updated:   ${stats.projectUpdates}`);
  console.log(`  Leads updated:      ${stats.leadUpdates}`);
  console.log(`  Proposals updated:  ${stats.proposalUpdates}`);
  console.log(`  No match:           ${stats.noMatch}`);
  console.log(`  No spreadsheet:     ${stats.noSheet}`);
  console.log(`  Errors:             ${stats.errors}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
