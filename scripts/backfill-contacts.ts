/**
 * Backfill contacts and companies from existing leads + projects data.
 *
 * Logic:
 * 1. Fetch all leads (with customer_name, phone, email, city, segment)
 * 2. Fetch all projects (with customer_name, customer_phone, customer_email, site_city, lead_id)
 * 3. Group by unique customer_name+phone → create a contact for each
 * 4. For commercial/industrial leads, create a company (using customer_name as company name)
 *    For residential, create company = person's name
 * 5. Link contacts to their companies via contact_company_roles
 * 6. Link contacts to their leads/projects via entity_contacts
 * 7. Set company_id on leads and projects
 *
 * Usage: npx tsx scripts/backfill-contacts.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface LeadRow {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  city: string;
  state: string;
  segment: string;
  address_line1: string | null;
  pincode: string | null;
  deleted_at: string | null;
}

interface ProjectRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  site_city: string;
  site_state: string;
  lead_id: string;
  project_number: string;
}

// Normalize phone for dedup
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

async function main() {
  console.log('=== Backfilling contacts and companies from existing data ===\n');

  // Step 1: Fetch all leads
  const { data: leads, error: leadsErr } = await admin
    .from('leads')
    .select('id, customer_name, phone, email, city, state, segment, address_line1, pincode, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (leadsErr) { console.error('Failed to fetch leads:', leadsErr); process.exit(1); }
  console.log(`Fetched ${leads.length} leads`);

  // Step 2: Fetch all projects
  const { data: projects, error: projErr } = await admin
    .from('projects')
    .select('id, customer_name, customer_phone, customer_email, site_city, site_state, lead_id, project_number')
    .order('created_at', { ascending: true });

  if (projErr) { console.error('Failed to fetch projects:', projErr); process.exit(1); }
  console.log(`Fetched ${projects.length} projects`);

  // Step 3: Build unique contacts map (phone → contact info)
  // We use phone as the primary dedup key since names can vary
  const contactMap = new Map<string, {
    name: string;
    phone: string;
    email: string | null;
    city: string;
    state: string;
    segment: string;
    address_line1: string | null;
    pincode: string | null;
    leadIds: string[];
    projectIds: string[];
  }>();

  for (const lead of leads) {
    const normPhone = normalizePhone(lead.phone);
    const key = normPhone || lead.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      contactMap.set(key, {
        name: lead.customer_name.trim(),
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        state: lead.state,
        segment: lead.segment,
        address_line1: lead.address_line1,
        pincode: lead.pincode,
        leadIds: [],
        projectIds: [],
      });
    }
    contactMap.get(key)!.leadIds.push(lead.id);
  }

  // Add projects — link via lead_id or phone
  const leadToPhone = new Map<string, string>();
  for (const lead of leads) {
    leadToPhone.set(lead.id, normalizePhone(lead.phone) || lead.customer_name.toLowerCase().trim());
  }

  for (const proj of projects) {
    // Try to find via lead_id first
    const key = leadToPhone.get(proj.lead_id) || normalizePhone(proj.customer_phone) || proj.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      contactMap.set(key, {
        name: proj.customer_name.trim(),
        phone: proj.customer_phone,
        email: proj.customer_email,
        city: proj.site_city,
        state: proj.site_state,
        segment: 'residential', // default if no lead found
        address_line1: null,
        pincode: null,
        leadIds: [],
        projectIds: [],
      });
    }
    contactMap.get(key)!.projectIds.push(proj.id);
  }

  console.log(`\nUnique contacts identified: ${contactMap.size}`);

  // Step 4: Create companies + contacts + link them
  let companiesCreated = 0;
  let contactsCreated = 0;
  let leadsLinked = 0;
  let projectsLinked = 0;

  for (const [key, info] of contactMap) {
    // Create company
    const { data: company, error: compErr } = await admin
      .from('companies')
      .insert({
        name: info.name,
        segment: info.segment,
        city: info.city,
        state: info.state,
        address_line1: info.address_line1,
        pincode: info.pincode,
      })
      .select('id')
      .single();

    if (compErr) {
      console.error(`  Company insert failed for "${info.name}":`, compErr.message);
      continue;
    }
    companiesCreated++;

    // Create contact (person)
    const { data: contact, error: contErr } = await admin
      .from('contacts')
      .insert({
        name: info.name,
        phone: info.phone || null,
        email: info.email || null,
      })
      .select('id')
      .single();

    if (contErr) {
      console.error(`  Contact insert failed for "${info.name}":`, contErr.message);
      continue;
    }
    contactsCreated++;

    // Link contact to company
    await admin.from('contact_company_roles').insert({
      contact_id: contact.id,
      company_id: company.id,
      role_title: info.segment === 'residential' ? 'Owner' : 'Primary Contact',
      is_primary: true,
    });

    // Link contact to leads + set company_id on leads
    for (const leadId of info.leadIds) {
      await admin.from('entity_contacts').insert({
        contact_id: contact.id,
        entity_type: 'lead',
        entity_id: leadId,
        role_label: 'Primary Contact',
        is_primary: true,
      }).then(() => leadsLinked++).catch(() => {});

      await admin.from('leads').update({ company_id: company.id }).eq('id', leadId);
    }

    // Link contact to projects + set company_id on projects
    for (const projectId of info.projectIds) {
      await admin.from('entity_contacts').insert({
        contact_id: contact.id,
        entity_type: 'project',
        entity_id: projectId,
        role_label: 'Primary Contact',
        is_primary: true,
      }).then(() => projectsLinked++).catch(() => {});

      await admin.from('projects').update({ company_id: company.id }).eq('id', projectId);
    }
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Companies created: ${companiesCreated}`);
  console.log(`Contacts created:  ${contactsCreated}`);
  console.log(`Leads linked:      ${leadsLinked}`);
  console.log(`Projects linked:   ${projectsLinked}`);
}

main().catch(console.error);
