/**
 * Phase 1.2: Enrich leads + contacts from HubSpot Contacts & Companies CSVs
 *
 * Matching strategy (contacts → leads):
 *   1. Associated Deal ID → leads.hubspot_deal_id (strongest, 7 contacts)
 *   2. Phone match → leads.phone (13 contacts with phones)
 *   3. Name fuzzy match → leads.customer_name (remaining 485 contacts)
 *
 * Data enriched:
 *   - leads: email, address_line1, city, state, pincode
 *   - contacts: email, last_name, lifecycle_stage
 *   - companies: phone, address, industry, employee count
 *
 * Usage:
 *   npx tsx scripts/enrich-from-hubspot-contacts.ts --dry-run
 *   npx tsx scripts/enrich-from-hubspot-contacts.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isDryRun, normalizePhone, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── CSV Parser (handles quoted fields with commas + embedded quotes) ───

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((h, j) => {
      record[h] = values[j] ?? '';
    });
    records.push(record);
  }
  return records;
}

// ─── Name normalization for fuzzy matching ───

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function nameTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter((t) => t.length > 1)
  );
}

function nameSimilarity(a: string, b: string): number {
  const tokensA = nameTokens(a);
  const tokensB = nameTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  // Jaccard-like score
  return overlap / Math.max(tokensA.size, tokensB.size);
}

// ─── Main ───

async function main() {
  const op = '[enrich-hubspot-contacts]';
  const dry = isDryRun();

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Load HubSpot Contacts CSV ═══
  const contactsCsvPath = resolve(__dirname, 'data/hubspot-contacts.csv');
  const contactsCsv = readFileSync(contactsCsvPath, 'utf-8');
  const hubContacts = parseCSV(contactsCsv);
  console.log(`${op} Loaded ${hubContacts.length} HubSpot contacts`);

  // ═══ Load HubSpot Companies CSV ═══
  const companiesCsvPath = resolve(__dirname, 'data/hubspot-companies.csv');
  const companiesCsv = readFileSync(companiesCsvPath, 'utf-8');
  const hubCompanies = parseCSV(companiesCsv);
  console.log(`${op} Loaded ${hubCompanies.length} HubSpot companies`);

  logMigrationStart('enrich-hubspot-contacts', hubContacts.length + hubCompanies.length);

  // ═══ Fetch all leads ═══
  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, hubspot_deal_id, customer_name, phone, email, address_line1, city, state, pincode')
    .is('deleted_at', null);

  if (leadError || !leads) {
    console.error(`${op} Failed to fetch leads:`, leadError?.message);
    return;
  }
  console.log(`${op} ${leads.length} active leads in DB`);

  // Build lead lookup maps
  const leadByDealId = new Map<string, typeof leads[0]>();
  const leadByPhone = new Map<string, typeof leads[0]>();
  const leadByNormName = new Map<string, typeof leads[0]>();

  for (const lead of leads) {
    if (lead.hubspot_deal_id) leadByDealId.set(lead.hubspot_deal_id, lead);
    if (lead.phone && lead.phone.length >= 10) {
      const norm = normalizePhone(lead.phone);
      leadByPhone.set(norm, lead);
    }
    const normName = normalizeName(lead.customer_name ?? '');
    if (normName) leadByNormName.set(normName, lead);
  }

  // ═══ Fetch all contacts in DB ═══
  const { data: dbContacts, error: contactError } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, phone, secondary_phone, email');

  if (contactError) {
    console.error(`${op} Failed to fetch contacts:`, contactError?.message);
    return;
  }

  // Build contact lookup by phone
  const dbContactByPhone = new Map<string, typeof dbContacts[0]>();
  for (const c of dbContacts ?? []) {
    if (c.phone && c.phone.length >= 10) {
      dbContactByPhone.set(normalizePhone(c.phone), c);
    }
  }

  // ═══ Fetch entity_contacts to find lead→contact links ═══
  const { data: entityContacts } = await supabase
    .from('entity_contacts')
    .select('entity_id, contact_id')
    .eq('entity_type', 'lead');

  const contactIdByLeadId = new Map<string, string>();
  for (const ec of entityContacts ?? []) {
    contactIdByLeadId.set(ec.entity_id, ec.contact_id);
  }

  // ═══ Process HubSpot contacts → match to leads ═══
  let stats = {
    processed: 0,
    leadsUpdated: 0,
    contactsUpdated: 0,
    matchedByDeal: 0,
    matchedByPhone: 0,
    matchedByName: 0,
    unmatched: 0,
    errors: 0,
  };

  for (const hc of hubContacts) {
    stats.processed++;
    const firstName = hc['First Name']?.trim() ?? '';
    const lastName = hc['Last Name']?.trim() ?? '';
    const email = hc['Email']?.trim() ?? '';
    const phone = hc['Phone Number']?.trim() ?? '';
    const city = hc['City']?.trim() ?? '';
    const street = hc['Street Address']?.trim() ?? '';
    const postal = hc['Postal Code']?.trim() ?? '';
    const state = hc['State/Region']?.trim() ?? '';
    const lifecycle = hc['Lifecycle Stage']?.trim() ?? '';
    const dealIds = hc['Associated Deal IDs']?.trim() ?? '';

    if (!email && !phone) continue; // Nothing to enrich with

    // ─── Match to lead ───
    let matchedLead: typeof leads[0] | undefined;
    let matchMethod = '';

    // Strategy 1: Deal ID match
    if (dealIds) {
      const ids = dealIds.split(';').map((id) => id.trim());
      for (const did of ids) {
        if (leadByDealId.has(did)) {
          matchedLead = leadByDealId.get(did);
          matchMethod = 'deal_id';
          stats.matchedByDeal++;
          break;
        }
      }
    }

    // Strategy 2: Phone match
    if (!matchedLead && phone) {
      const digits = phone.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        const norm = normalizePhone(digits);
        if (leadByPhone.has(norm)) {
          matchedLead = leadByPhone.get(norm);
          matchMethod = 'phone';
          stats.matchedByPhone++;
        }
      }
    }

    // Strategy 3: Name fuzzy match (require ≥0.6 similarity)
    if (!matchedLead && (firstName || lastName)) {
      const fullName = `${firstName} ${lastName}`.trim();
      const normFull = normalizeName(fullName);

      // Try exact normalized match first
      if (leadByNormName.has(normFull)) {
        matchedLead = leadByNormName.get(normFull);
        matchMethod = 'name_exact';
        stats.matchedByName++;
      } else {
        // Fuzzy: find best match above threshold
        let bestScore = 0;
        let bestLead: typeof leads[0] | undefined;
        for (const lead of leads) {
          const score = nameSimilarity(fullName, lead.customer_name ?? '');
          if (score > bestScore && score >= 0.6) {
            bestScore = score;
            bestLead = lead;
          }
        }
        if (bestLead) {
          matchedLead = bestLead;
          matchMethod = `name_fuzzy(${bestScore.toFixed(2)})`;
          stats.matchedByName++;
        }
      }
    }

    if (!matchedLead) {
      stats.unmatched++;
      continue;
    }

    // ─── Update lead with email + address (fill gaps only) ───
    const leadUpdates: Record<string, string> = {};
    if (email && !matchedLead.email) leadUpdates.email = email;
    if (street && !matchedLead.address_line1) leadUpdates.address_line1 = street;
    if (city && !matchedLead.city) leadUpdates.city = city;
    if (state && !matchedLead.state) leadUpdates.state = state;
    if (postal && !matchedLead.pincode) leadUpdates.pincode = postal;

    if (Object.keys(leadUpdates).length > 0) {
      if (dry) {
        console.log(`  Lead ${matchedLead.customer_name} [${matchMethod}]: ${Object.keys(leadUpdates).join(', ')}`);
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ ...leadUpdates, updated_at: new Date().toISOString() })
          .eq('id', matchedLead.id);
        if (error) {
          console.error(`  Error updating lead ${matchedLead.id}:`, error.message);
          stats.errors++;
        }
      }
      stats.leadsUpdated++;
    }

    // ─── Update linked contact with email + last_name ───
    const contactId = contactIdByLeadId.get(matchedLead.id);
    if (contactId) {
      const dbContact = (dbContacts ?? []).find((c) => c.id === contactId);
      if (dbContact) {
        const contactUpdates: Record<string, string> = {};
        if (email && !dbContact.email) contactUpdates.email = email;
        if (lastName && !dbContact.last_name) contactUpdates.last_name = lastName;

        if (Object.keys(contactUpdates).length > 0) {
          if (dry) {
            console.log(`    → Contact ${dbContact.first_name}: ${Object.keys(contactUpdates).join(', ')}`);
          } else {
            const { error } = await supabase
              .from('contacts')
              .update({ ...contactUpdates, updated_at: new Date().toISOString() })
              .eq('id', contactId);
            if (error) {
              console.error(`  Error updating contact ${contactId}:`, error.message);
              stats.errors++;
            }
          }
          stats.contactsUpdated++;
        }
      }
    }
  }

  console.log(`\n${op} Contact matching summary:`);
  console.log(`  Matched by deal ID: ${stats.matchedByDeal}`);
  console.log(`  Matched by phone:   ${stats.matchedByPhone}`);
  console.log(`  Matched by name:    ${stats.matchedByName}`);
  console.log(`  Unmatched:          ${stats.unmatched}`);
  console.log(`  Leads updated:      ${stats.leadsUpdated}`);
  console.log(`  Contacts updated:   ${stats.contactsUpdated}`);

  // ═══ Process HubSpot companies ═══
  console.log(`\n${op} Processing ${hubCompanies.length} HubSpot companies...`);

  // Fetch DB companies
  const { data: dbCompanies, error: compError } = await supabase
    .from('companies')
    .select('id, name, city, state, industry, company_size, address_line1, pincode, website');

  if (compError) {
    console.error(`${op} Failed to fetch companies:`, compError?.message);
  }

  const dbCompanyByNormName = new Map<string, typeof dbCompanies extends (infer T)[] | null ? T : never>();
  for (const c of dbCompanies ?? []) {
    const normName = normalizeName(c.name ?? '');
    if (normName) dbCompanyByNormName.set(normName, c);
  }

  let companiesUpdated = 0;
  for (const hComp of hubCompanies) {
    const compName = hComp['Company name']?.trim() ?? '';
    const phone = hComp['Phone Number']?.trim() ?? '';
    const city = hComp['City']?.trim() ?? '';
    const state = hComp['State/Region']?.trim() ?? '';
    const street = hComp['Street Address']?.trim() ?? '';
    const postal = hComp['Postal Code']?.trim() ?? '';
    const industry = hComp['Industry']?.trim() ?? '';
    const employees = hComp['Number of Employees']?.trim() ?? '';
    const website = hComp['Website URL']?.trim() ?? '';

    if (!compName) continue;

    // Match by name
    const normName = normalizeName(compName);
    let dbComp = dbCompanyByNormName.get(normName);

    // Fuzzy match if no exact
    if (!dbComp) {
      let bestScore = 0;
      for (const [key, val] of dbCompanyByNormName.entries()) {
        const score = nameSimilarity(compName, val.name ?? '');
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          dbComp = val;
        }
      }
    }

    if (!dbComp) continue;

    const updates: Record<string, string | number> = {};
    if (city && !dbComp.city) updates.city = city;
    if (state && !dbComp.state) updates.state = state;
    if (street && !dbComp.address_line1) updates.address_line1 = street;
    if (postal && !dbComp.pincode) updates.pincode = postal;
    if (industry && !dbComp.industry) updates.industry = industry;
    if (employees && !dbComp.company_size) updates.company_size = employees;
    if (website && !dbComp.website) updates.website = website;

    if (Object.keys(updates).length > 0) {
      if (dry) {
        console.log(`  Company ${dbComp.name}: ${Object.keys(updates).join(', ')}`);
      } else {
        const { error } = await supabase
          .from('companies')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', dbComp.id);
        if (error) {
          console.error(`  Error updating company ${dbComp.id}:`, error.message);
          stats.errors++;
        }
      }
      companiesUpdated++;
    }
  }

  console.log(`  Companies updated: ${companiesUpdated}`);

  logMigrationEnd('enrich-hubspot-contacts', {
    processed: stats.processed + hubCompanies.length,
    inserted: stats.leadsUpdated + stats.contactsUpdated + companiesUpdated,
    skipped: stats.unmatched,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[enrich-hubspot-contacts] Fatal error:', err);
  process.exit(1);
});
