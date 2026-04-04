/**
 * Backfill Contacts V2 — HubSpot-style smart migration
 *
 * Logic:
 * - Residential leads: customer_name is the PERSON → create contact only (no company)
 * - Commercial/Industrial leads: customer_name might be person or company
 *   → If name looks like a company (Pvt, Ltd, LLP, Industries, etc.) → create company + contact
 *   → Otherwise → create contact only, flag for manual review
 * - Dedup by normalized phone number
 * - Split customer_name into first_name + last_name
 * - Set lifecycle_stage based on lead status
 * - Link contacts to leads/projects via entity_contacts
 *
 * Usage: npx tsx scripts/backfill-contacts-v2.ts
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

// ── Helpers ──

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const lastName = parts.pop()!;
  const firstName = parts.join(' ');
  return { firstName, lastName };
}

const COMPANY_PATTERNS = [
  /\b(pvt|private|ltd|limited|llp|llc|inc|corp|co\b)/i,
  /\b(industries|enterprises|builders|constructions|infra|infrastructure)\b/i,
  /\b(group|foundation|trust|society|association)\b/i,
  /\b(hospital|school|college|university|institute|academy)\b/i,
  /\b(hotel|resort|mall|plaza|tower|towers)\b/i,
  /\b(pharma|chemicals|textiles|foods|motors|auto)\b/i,
  /\b(technologies|tech|solutions|systems|services)\b/i,
  /\b(realty|properties|estates|housing)\b/i,
];

function looksLikeCompanyName(name: string): boolean {
  return COMPANY_PATTERNS.some((pattern) => pattern.test(name));
}

function leadStatusToLifecycle(status: string): string {
  switch (status) {
    case 'new':
    case 'contacted':
    case 'follow_up':
      return 'lead';
    case 'qualified':
    case 'site_visit_scheduled':
    case 'site_visit_done':
    case 'design_confirmed':
    case 'proposal_sent':
      return 'opportunity';
    case 'converted':
      return 'customer';
    case 'disqualified':
    case 'lost':
      return 'lead';
    default:
      return 'lead';
  }
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

// ── Main ──

async function main() {
  console.log('=== Contacts V2 Backfill ===\n');

  // Fetch all leads
  const leads = await fetchAll(
    'leads',
    'id, customer_name, phone, email, city, state, segment, address_line1, pincode, status, assigned_to, deleted_at',
    (q: any) => q.is('deleted_at', null),
  );
  console.log(`Total leads: ${leads.length}`);

  // Fetch all projects
  const projects = await fetchAll(
    'projects',
    'id, customer_name, customer_phone, customer_email, site_city, site_state, lead_id, project_number',
  );
  console.log(`Total projects: ${projects.length}`);

  // Build contact map — dedup by normalized phone
  const contactMap = new Map<string, {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    city: string;
    state: string;
    segment: string;
    addressLine1: string | null;
    pincode: string | null;
    lifecycleStage: string;
    isCompanyName: boolean;
    leadIds: string[];
    projectIds: string[];
  }>();

  for (const lead of leads) {
    const normPhone = normalizePhone(lead.phone);
    const key = normPhone || lead.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      const { firstName, lastName } = splitName(lead.customer_name);
      const isCompany = lead.segment !== 'residential' && looksLikeCompanyName(lead.customer_name);

      contactMap.set(key, {
        firstName,
        lastName,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        state: lead.state,
        segment: lead.segment,
        addressLine1: lead.address_line1,
        pincode: lead.pincode,
        lifecycleStage: leadStatusToLifecycle(lead.status),
        isCompanyName: isCompany,
        leadIds: [],
        projectIds: [],
      });
    }

    // Upgrade lifecycle if this lead is further along
    const existing = contactMap.get(key)!;
    const newLifecycle = leadStatusToLifecycle(lead.status);
    const order = ['subscriber', 'lead', 'opportunity', 'customer', 'evangelist'];
    if (order.indexOf(newLifecycle) > order.indexOf(existing.lifecycleStage)) {
      existing.lifecycleStage = newLifecycle;
    }

    existing.leadIds.push(lead.id);
  }

  // Map lead_id to contact key for project linking
  const leadToKey = new Map<string, string>();
  for (const lead of leads) {
    const normPhone = normalizePhone(lead.phone);
    leadToKey.set(lead.id, normPhone || lead.customer_name.toLowerCase().trim());
  }

  for (const proj of projects) {
    const key = leadToKey.get(proj.lead_id) || normalizePhone(proj.customer_phone) || proj.customer_name.toLowerCase().trim();

    if (!contactMap.has(key)) {
      const { firstName, lastName } = splitName(proj.customer_name);
      contactMap.set(key, {
        firstName,
        lastName,
        phone: proj.customer_phone,
        email: proj.customer_email,
        city: proj.site_city,
        state: proj.site_state,
        segment: 'residential',
        addressLine1: null,
        pincode: null,
        lifecycleStage: 'customer', // has a project = customer
        isCompanyName: false,
        leadIds: [],
        projectIds: [],
      });
    }

    const existing = contactMap.get(key)!;
    // If they have a project, they're at least a customer
    existing.lifecycleStage = 'customer';
    existing.projectIds.push(proj.id);
  }

  console.log(`\nUnique contacts to create: ${contactMap.size}`);

  const companyNames = [...contactMap.values()].filter((c) => c.isCompanyName);
  console.log(`Of which ${companyNames.length} look like company names (will create company + contact)`);
  console.log(`And ${contactMap.size - companyNames.length} are person names (contact only)\n`);

  let contactsCreated = 0;
  let companiesCreated = 0;
  let leadsLinked = 0;
  let projectsLinked = 0;

  for (const [, info] of contactMap) {
    let companyId: string | null = null;

    // For commercial/industrial with company-looking names → create company
    if (info.isCompanyName && info.segment !== 'residential') {
      const { data: company, error: compErr } = await admin
        .from('companies')
        .insert({
          name: `${info.firstName} ${info.lastName}`.trim(), // full original name as company
          segment: info.segment,
          city: info.city,
          state: info.state,
          address_line1: info.addressLine1,
          pincode: info.pincode,
        })
        .select('id')
        .single();

      if (compErr) {
        console.error(`  Skip company "${info.firstName} ${info.lastName}": ${compErr.message}`);
      } else {
        companyId = company.id;
        companiesCreated++;
      }
    }

    // Create the contact (always a person)
    const { data: contact, error: contErr } = await admin
      .from('contacts')
      .insert({
        first_name: info.firstName,
        last_name: info.lastName || null,
        name: `${info.firstName} ${info.lastName}`.trim(),
        phone: info.phone || null,
        email: info.email || null,
        lifecycle_stage: info.lifecycleStage,
        source: 'hubspot_import',
      } as any)
      .select('id')
      .single();

    if (contErr) {
      console.error(`  Skip contact "${info.firstName} ${info.lastName}": ${contErr.message}`);
      continue;
    }
    contactsCreated++;

    // Link contact to company if we created one
    if (companyId) {
      await admin.from('contact_company_roles').insert({
        contact_id: contact.id,
        company_id: companyId,
        role_title: 'Primary Contact',
        is_primary: true,
      });
    }

    // Link to leads
    for (const leadId of info.leadIds) {
      try {
        await admin.from('entity_contacts').insert({
          contact_id: contact.id,
          entity_type: 'lead',
          entity_id: leadId,
          role_label: 'Primary Contact',
          is_primary: true,
        });
      } catch (_) { /* ignore duplicates */ }

      // Set company_id on lead if we have one
      if (companyId) {
        await admin.from('leads').update({ company_id: companyId }).eq('id', leadId);
      }
      leadsLinked++;
    }

    // Link to projects
    for (const projectId of info.projectIds) {
      try {
        await admin.from('entity_contacts').insert({
          contact_id: contact.id,
          entity_type: 'project',
          entity_id: projectId,
          role_label: 'Primary Contact',
          is_primary: true,
        });
      } catch (_) { /* ignore duplicates */ }

      if (companyId) {
        await admin.from('projects').update({ company_id: companyId }).eq('id', projectId);
      }
      projectsLinked++;
    }

    if (contactsCreated % 100 === 0) {
      console.log(`  Processed ${contactsCreated}/${contactMap.size}...`);
    }
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Contacts created:  ${contactsCreated}`);
  console.log(`Companies created: ${companiesCreated} (only for C&I leads with company-looking names)`);
  console.log(`Leads linked:      ${leadsLinked}`);
  console.log(`Projects linked:   ${projectsLinked}`);
  console.log(`\nResidential contacts have NO company — this is by design.`);
  console.log(`Commercial contacts with person names have NO company — review manually.`);
}

main().catch(console.error);
