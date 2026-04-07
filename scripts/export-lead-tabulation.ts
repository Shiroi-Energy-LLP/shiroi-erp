/**
 * Export all leads with extracted proposal data for Vivek's review.
 * Generates CSV sorted by proposal date for re-engagement analysis.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  // Get all leads (paginated - Supabase caps at 1000)
  const { data: leads1 } = await supabase
    .from('leads')
    .select('id, customer_name, status, city, estimated_size_kwp, phone, email, electricity_bill_number, source, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(0, 999);
  const { data: leads2 } = await supabase
    .from('leads')
    .select('id, customer_name, status, city, estimated_size_kwp, phone, email, electricity_bill_number, source, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(1000, 1999);
  const leads = [...(leads1 ?? []), ...(leads2 ?? [])];

  // Get all proposals (latest revision per lead)
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, system_size_kwp, sent_at, panel_brand, inverter_brand, structure_type, proposal_number, created_at')
    .not('lead_id', 'is', null)
    .order('revision_number', { ascending: false });

  const proposalByLead = new Map<string, any>();
  for (const p of proposals ?? []) {
    if (p.lead_id && !proposalByLead.has(p.lead_id)) {
      proposalByLead.set(p.lead_id, p);
    }
  }

  // Get projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, status, contracted_value')
    .not('lead_id', 'is', null);

  const projectByLead = new Map<string, any>();
  for (const pr of projects ?? []) {
    if (pr.lead_id) projectByLead.set(pr.lead_id, pr);
  }

  // Build CSV
  const rows: string[] = [];
  rows.push('Customer Name,Lead Status,City,Size (kWp),Phone,Email,Proposal Value (INR),Proposal Date,Proposal #,Panel Brand,Inverter Brand,Has Project,Project Status,Lead Created,Bill Number');

  for (const lead of leads ?? []) {
    const p = proposalByLead.get(lead.id);
    const pr = projectByLead.get(lead.id);

    const proposalDate = p?.sent_at
      ? new Date(p.sent_at).toISOString().split('T')[0]
      : '';

    const row = [
      (lead.customer_name || '').replace(/,/g, ';'),
      lead.status || '',
      lead.city || '',
      lead.estimated_size_kwp || '',
      lead.phone || '',
      lead.email || '',
      p?.total_after_discount || '',
      proposalDate,
      p?.proposal_number || '',
      p?.panel_brand || '',
      p?.inverter_brand || '',
      pr ? 'Yes' : 'No',
      pr?.status || '',
      lead.created_at ? new Date(lead.created_at).toISOString().split('T')[0] : '',
      lead.electricity_bill_number || '',
    ].join(',');

    rows.push(row);
  }

  const outPath = path.resolve(__dirname, 'data/lead-tabulation.csv');
  fs.writeFileSync(outPath, rows.join('\n'));
  console.log(`Written ${rows.length - 1} leads to ${outPath}`);

  // Summary stats
  const total = (leads ?? []).length;
  const withProposal = (leads ?? []).filter(l => proposalByLead.has(l.id)).length;
  const withProject = (leads ?? []).filter(l => projectByLead.has(l.id)).length;
  const withSize = (leads ?? []).filter(l => l.estimated_size_kwp && l.estimated_size_kwp > 0).length;
  const withDate = (leads ?? []).filter(l => {
    const p = proposalByLead.get(l.id);
    return p?.sent_at;
  }).length;

  console.log(`\nSummary:`);
  console.log(`  Total leads: ${total}`);
  console.log(`  With proposal: ${withProposal}`);
  console.log(`  With project: ${withProject}`);
  console.log(`  With size: ${withSize}`);
  console.log(`  With proposal date: ${withDate}`);
}

main().catch(e => { console.error(e); process.exit(1); });
