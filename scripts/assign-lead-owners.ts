/**
 * Assign lead owners from HubSpot deal owner data.
 * - "Vivek Sridhar" → Vinodh Kadavasal Sridhar (partner)
 * - "Prem ." → Premkumar (Senior Marketing Manager)
 * - Remaining unassigned → Premkumar (default marketing lead)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const isDryRun = process.argv.includes('--dry-run');

// Employee IDs
const VIVEK_ID = '9acfe527-76d4-4259-886c-aa8a4a8db742';
const PREM_ID = '01905444-3fec-4993-af84-a2ccdc348ffd';

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function main() {
  const op = '[assign-owners]';
  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Parse HubSpot deals CSV for deal owner
  const dealsCsv = readFileSync(resolve(__dirname, 'data/hubspot-deals.csv'), 'utf-8');
  const lines = dealsCsv.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const ownerIdx = headers.indexOf('Deal owner');
  const dealIdIdx = headers.indexOf('Record ID');

  const ownerByDealId = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const dealId = fields[dealIdIdx]?.trim();
    const owner = fields[ownerIdx]?.trim();
    if (dealId && owner) {
      const employeeId = owner.includes('Vivek') ? VIVEK_ID :
                         owner.includes('Prem') ? PREM_ID : null;
      if (employeeId) ownerByDealId.set(dealId, employeeId);
    }
  }
  console.log(`${op} ${ownerByDealId.size} deals with owner mapping`);

  // Get all leads without assigned_to
  const { data: leads1 } = await supabase
    .from('leads')
    .select('id, hubspot_deal_id, customer_name, assigned_to')
    .is('deleted_at', null)
    .is('assigned_to', null)
    .range(0, 999);
  const { data: leads2 } = await supabase
    .from('leads')
    .select('id, hubspot_deal_id, customer_name, assigned_to')
    .is('deleted_at', null)
    .is('assigned_to', null)
    .range(1000, 1999);
  const leads = [...(leads1 ?? []), ...(leads2 ?? [])];

  console.log(`${op} ${leads.length} leads without owner`);

  let stats = { fromDeal: 0, defaultPrem: 0, errors: 0 };

  // Batch update: first those with HubSpot deal owner
  const vivekLeads: string[] = [];
  const premLeads: string[] = [];
  const defaultLeads: string[] = [];

  for (const lead of leads) {
    if (lead.hubspot_deal_id && ownerByDealId.has(lead.hubspot_deal_id)) {
      const eid = ownerByDealId.get(lead.hubspot_deal_id)!;
      if (eid === VIVEK_ID) vivekLeads.push(lead.id);
      else premLeads.push(lead.id);
      stats.fromDeal++;
    } else {
      defaultLeads.push(lead.id);
      stats.defaultPrem++;
    }
  }

  console.log(`${op} From deal owner: ${stats.fromDeal} (Vivek: ${vivekLeads.length}, Prem: ${premLeads.length})`);
  console.log(`${op} Default to Prem: ${stats.defaultPrem}`);

  if (!isDryRun) {
    // Batch update Vivek's leads
    if (vivekLeads.length > 0) {
      for (let i = 0; i < vivekLeads.length; i += 100) {
        const batch = vivekLeads.slice(i, i + 100);
        const { error } = await supabase.from('leads')
          .update({ assigned_to: VIVEK_ID, updated_at: new Date().toISOString() })
          .in('id', batch);
        if (error) { console.error(`${op} Vivek batch error:`, error.message); stats.errors++; }
      }
    }

    // Batch update Prem's from deal + default
    const allPrem = [...premLeads, ...defaultLeads];
    for (let i = 0; i < allPrem.length; i += 100) {
      const batch = allPrem.slice(i, i + 100);
      const { error } = await supabase.from('leads')
        .update({ assigned_to: PREM_ID, updated_at: new Date().toISOString() })
        .in('id', batch);
      if (error) { console.error(`${op} Prem batch error:`, error.message); stats.errors++; }
    }
  }

  console.log(`\n${op} Results:`);
  console.log(`  Vivek (from deal): ${vivekLeads.length}`);
  console.log(`  Prem (from deal): ${premLeads.length}`);
  console.log(`  Prem (default): ${defaultLeads.length}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
