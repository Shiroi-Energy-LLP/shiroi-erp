/**
 * Continue backfill for remaining leads (the first run got 694/1040, and missed leads beyond row 1000).
 * This script fetches ALL leads, skips ones already linked, and processes the rest.
 *
 * Usage: npx tsx scripts/backfill-contacts-remaining.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

const admin = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

async function fetchAll(table: string, select: string, filter?: (q: any) => any) {
  const rows: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    let query = admin.from(table).select(select).range(page * pageSize, (page + 1) * pageSize - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return rows;
}

async function main() {
  console.log('=== Backfilling REMAINING contacts ===\n');

  // Fetch ALL leads
  const leads = await fetchAll('leads', 'id, customer_name, phone, email, city, state, segment, address_line1, pincode, deleted_at, company_id',
    (q: any) => q.is('deleted_at', null)
  );
  console.log(`Total leads: ${leads.length}`);

  // Fetch ALL projects
  const projects = await fetchAll('projects', 'id, customer_name, customer_phone, customer_email, site_city, site_state, lead_id, project_number, company_id');
  console.log(`Total projects: ${projects.length}`);

  // Find leads NOT yet linked (no company_id)
  const unlinkedLeads = leads.filter((l: any) => !l.company_id);
  console.log(`Unlinked leads: ${unlinkedLeads.length}`);

  // Find projects NOT yet linked
  const unlinkedProjects = projects.filter((p: any) => !p.company_id);
  console.log(`Unlinked projects: ${unlinkedProjects.length}`);

  if (unlinkedLeads.length === 0 && unlinkedProjects.length === 0) {
    console.log('\nAll leads and projects are already linked. Nothing to do.');
    return;
  }

  // Build contact map from unlinked records
  const contactMap = new Map<string, {
    name: string; phone: string; email: string | null;
    city: string; state: string; segment: string;
    address_line1: string | null; pincode: string | null;
    leadIds: string[]; projectIds: string[];
  }>();

  for (const lead of unlinkedLeads) {
    const normPhone = normalizePhone(lead.phone);
    const key = normPhone || lead.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      contactMap.set(key, {
        name: lead.customer_name.trim(), phone: lead.phone, email: lead.email,
        city: lead.city, state: lead.state, segment: lead.segment,
        address_line1: lead.address_line1, pincode: lead.pincode,
        leadIds: [], projectIds: [],
      });
    }
    contactMap.get(key)!.leadIds.push(lead.id);
  }

  // Map lead_id to key for project linking
  const leadToKey = new Map<string, string>();
  for (const lead of leads) {
    const normPhone = normalizePhone(lead.phone);
    leadToKey.set(lead.id, normPhone || lead.customer_name.toLowerCase().trim());
  }

  for (const proj of unlinkedProjects) {
    const key = leadToKey.get(proj.lead_id) || normalizePhone(proj.customer_phone) || proj.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      contactMap.set(key, {
        name: proj.customer_name.trim(), phone: proj.customer_phone, email: proj.customer_email,
        city: proj.site_city, state: proj.site_state, segment: 'residential',
        address_line1: null, pincode: null, leadIds: [], projectIds: [],
      });
    }
    contactMap.get(key)!.projectIds.push(proj.id);
  }

  console.log(`\nNew contacts to create: ${contactMap.size}`);

  let created = 0;
  let leadsLinked = 0;
  let projectsLinked = 0;

  for (const [, info] of contactMap) {
    // Create company
    const { data: company, error: compErr } = await admin
      .from('companies').insert({
        name: info.name, segment: info.segment, city: info.city, state: info.state,
        address_line1: info.address_line1, pincode: info.pincode,
      }).select('id').single();

    if (compErr) { console.error(`  Skip "${info.name}": ${compErr.message}`); continue; }

    // Create contact
    const { data: contact, error: contErr } = await admin
      .from('contacts').insert({
        name: info.name, phone: info.phone || null, email: info.email || null,
      }).select('id').single();

    if (contErr) { console.error(`  Skip contact "${info.name}": ${contErr.message}`); continue; }

    // Link to company
    await admin.from('contact_company_roles').insert({
      contact_id: contact.id, company_id: company.id,
      role_title: info.segment === 'residential' ? 'Owner' : 'Primary Contact',
      is_primary: true,
    });

    // Link to leads
    for (const leadId of info.leadIds) {
      await admin.from('entity_contacts').insert({
        contact_id: contact.id, entity_type: 'lead', entity_id: leadId,
        role_label: 'Primary Contact', is_primary: true,
      }).catch(() => {});
      await admin.from('leads').update({ company_id: company.id }).eq('id', leadId);
      leadsLinked++;
    }

    // Link to projects
    for (const projectId of info.projectIds) {
      await admin.from('entity_contacts').insert({
        contact_id: contact.id, entity_type: 'project', entity_id: projectId,
        role_label: 'Primary Contact', is_primary: true,
      }).catch(() => {});
      await admin.from('projects').update({ company_id: company.id }).eq('id', projectId);
      projectsLinked++;
    }

    created++;
    if (created % 50 === 0) console.log(`  Processed ${created}/${contactMap.size}...`);
  }

  console.log(`\n=== Done ===`);
  console.log(`New contacts created: ${created}`);
  console.log(`Leads linked: ${leadsLinked}`);
  console.log(`Projects linked: ${projectsLinked}`);
}

main().catch(console.error);
