/**
 * Phase 0: Junk Lead Cleanup + Placeholder Phone Flagging
 *
 * Actions:
 *   1. Exports 25 junk leads (Google Drive folder names) to backup JSON
 *   2. Soft-deletes them via the migration SQL (run separately)
 *   3. Generates manual-phone-numbers.csv for 76 real leads with placeholder phones
 *
 * Usage:
 *   npx tsx scripts/cleanup-junk-leads.ts --dry-run    # preview only
 *   npx tsx scripts/cleanup-junk-leads.ts               # live run
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env — try local first, fall back to main repo root
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const op = '[cleanup-junk-leads]';
  const dry = isDryRun();

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);

  // ─── Step 1: Identify and backup junk leads (14-digit fake phones) ───
  console.log(`\n${op} Step 1: Identifying junk leads with 14-digit fake phones...`);

  const { data: junkLeads, error: junkError } = await supabase
    .from('leads')
    .select(`
      id, customer_name, phone, status, source, segment,
      hubspot_deal_id, notes, created_at,
      proposals:proposals(id, proposal_number, total_after_discount, system_size_kwp),
      projects:projects(id, project_number)
    `)
    .or('phone.like.8888%,phone.like.9999%')
    .is('deleted_at', null);

  if (junkError) {
    console.error(`${op} Error fetching junk leads:`, junkError.message);
    return;
  }

  // Filter in JS for precise 14-digit check (Supabase can't do length filter on text)
  const junkFiltered = (junkLeads ?? []).filter(
    (l) => l.phone && l.phone.length > 10 && /^(8888|9999)/.test(l.phone)
  );

  console.log(`${op} Found ${junkFiltered.length} junk leads`);

  // Backup to JSON
  const backupPath = resolve(__dirname, 'data/junk-leads-backup.json');
  writeFileSync(backupPath, JSON.stringify(junkFiltered, null, 2), 'utf-8');
  console.log(`${op} Backup saved to: ${backupPath}`);

  // Show what we'd delete
  for (const lead of junkFiltered) {
    const proposals = (lead as any).proposals ?? [];
    const projects = (lead as any).projects ?? [];
    console.log(`  ${lead.customer_name.padEnd(45)} | ${lead.phone} | proposals: ${proposals.length} | projects: ${projects.length}`);
  }

  if (!dry) {
    // Remove entity_contacts links
    const junkIds = junkFiltered.map((l) => l.id);

    const { error: ecError } = await supabase
      .from('entity_contacts')
      .delete()
      .eq('entity_type', 'lead')
      .in('entity_id', junkIds);

    if (ecError) console.error(`${op} entity_contacts delete error:`, ecError.message);
    else console.log(`${op} Removed entity_contacts for ${junkIds.length} junk leads`);

    // Soft-delete leads
    const { error: leadError } = await supabase
      .from('leads')
      .update({
        deleted_at: new Date().toISOString(),
        notes: '[DATA_CLEANUP 2026-04-07] Soft-deleted: Google Drive folder name imported as lead.',
      })
      .in('id', junkIds);

    if (leadError) console.error(`${op} leads soft-delete error:`, leadError.message);
    else console.log(`${op} Soft-deleted ${junkIds.length} junk leads`);
  }

  // ─── Step 2: Generate CSV for 76 placeholder phone leads ───
  console.log(`\n${op} Step 2: Generating CSV for placeholder phone leads...`);

  const { data: placeholderLeads, error: phError } = await supabase
    .from('leads')
    .select(`
      id, customer_name, phone, status, segment, created_at,
      proposals:proposals(id, proposal_number),
      projects:projects(id, project_number, customer_phone)
    `)
    .like('phone', '0000000%')
    .is('deleted_at', null)
    .order('customer_name');

  if (phError) {
    console.error(`${op} Error fetching placeholder leads:`, phError.message);
    return;
  }

  console.log(`${op} Found ${placeholderLeads?.length ?? 0} leads with placeholder phones`);

  // Generate CSV
  const csvHeader = 'lead_id,customer_name,current_phone,status,segment,proposal_number,project_number,real_phone_number';
  const csvRows = (placeholderLeads ?? []).map((l) => {
    const proposals = (l as any).proposals ?? [];
    const projects = (l as any).projects ?? [];
    const propNum = proposals[0]?.proposal_number ?? '';
    const projNum = projects[0]?.project_number ?? '';
    const escapedName = `"${l.customer_name.replace(/"/g, '""')}"`;
    return `${l.id},${escapedName},${l.phone},${l.status},${l.segment},${propNum},${projNum},`;
  });

  const csvContent = [csvHeader, ...csvRows].join('\n');
  const csvPath = resolve(__dirname, 'data/manual-phone-numbers.csv');
  writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`${op} CSV saved to: ${csvPath}`);
  console.log(`${op} Fill in the 'real_phone_number' column and run the import script.`);

  // ─── Stats ───
  logMigrationEnd('cleanup-junk-leads', {
    processed: junkFiltered.length + (placeholderLeads?.length ?? 0),
    inserted: 0,
    skipped: dry ? junkFiltered.length : 0,
    errors: 0,
  });
}

main().catch((err) => {
  console.error('[cleanup-junk-leads] Fatal error:', err);
  process.exit(1);
});
