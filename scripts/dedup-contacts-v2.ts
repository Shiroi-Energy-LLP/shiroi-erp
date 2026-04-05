/**
 * Dedup contacts created by backfill-contacts-v2.ts
 * Groups contacts by normalized phone, keeps the one with most entity links,
 * re-links entity_contacts from duplicates to the keeper, then deletes duplicates.
 *
 * Usage: npx tsx scripts/dedup-contacts-v2.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizePhone(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

async function fetchAll(table: string, select: string) {
  const rows: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin.from(table).select(select).range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return rows;
}

async function main() {
  console.log('=== Deduplicating Contacts ===\n');

  // Fetch all contacts
  const contacts = await fetchAll('contacts', 'id, name, phone, email, created_at');
  console.log(`Total contacts: ${contacts.length}`);

  // Fetch all entity_contacts
  const entityContacts = await fetchAll('entity_contacts', 'id, contact_id, entity_type, entity_id');
  console.log(`Total entity_contacts: ${entityContacts.length}`);

  // Fetch all contact_company_roles
  const companyRoles = await fetchAll('contact_company_roles', 'id, contact_id, company_id');
  console.log(`Total contact_company_roles: ${companyRoles.length}`);

  // Group contacts by normalized phone (or name if no phone)
  const groups = new Map<string, any[]>();
  for (const c of contacts) {
    const key = normalizePhone(c.phone) || c.name?.toLowerCase().trim() || c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // Find groups with duplicates
  const dupeGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`\nDuplicate groups: ${dupeGroups.length}`);

  if (dupeGroups.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    return;
  }

  let merged = 0;
  let deleted = 0;

  for (const [key, dupes] of dupeGroups) {
    // Count entity links per contact
    const linkCounts = dupes.map((c: any) => ({
      contact: c,
      links: entityContacts.filter((ec: any) => ec.contact_id === c.id).length,
      roles: companyRoles.filter((cr: any) => cr.contact_id === c.id).length,
    }));

    // Keep the one with most links, or oldest if tied
    linkCounts.sort((a: any, b: any) => {
      if (b.links !== a.links) return b.links - a.links;
      return new Date(a.contact.created_at).getTime() - new Date(b.contact.created_at).getTime();
    });

    const keeper = linkCounts[0].contact;
    const toDelete = linkCounts.slice(1).map((l: any) => l.contact);

    for (const dupe of toDelete) {
      // Re-link entity_contacts from dupe to keeper
      const dupeLinks = entityContacts.filter((ec: any) => ec.contact_id === dupe.id);
      for (const link of dupeLinks) {
        // Check if keeper already has this exact link
        const exists = entityContacts.some(
          (ec: any) => ec.contact_id === keeper.id && ec.entity_type === link.entity_type && ec.entity_id === link.entity_id
        );
        if (!exists) {
          await admin.from('entity_contacts').update({ contact_id: keeper.id }).eq('id', link.id);
        } else {
          await admin.from('entity_contacts').delete().eq('id', link.id);
        }
      }

      // Re-link company roles from dupe to keeper
      const dupeRoles = companyRoles.filter((cr: any) => cr.contact_id === dupe.id);
      for (const role of dupeRoles) {
        const exists = companyRoles.some(
          (cr: any) => cr.contact_id === keeper.id && cr.company_id === role.company_id
        );
        if (!exists) {
          await admin.from('contact_company_roles').update({ contact_id: keeper.id }).eq('id', role.id);
        } else {
          await admin.from('contact_company_roles').delete().eq('id', role.id);
        }
      }

      // Delete the duplicate contact
      await admin.from('contacts').delete().eq('id', dupe.id);
      deleted++;
    }

    merged++;
  }

  console.log(`\n=== Dedup Complete ===`);
  console.log(`Duplicate groups merged: ${merged}`);
  console.log(`Duplicate contacts deleted: ${deleted}`);

  // Final counts
  const { count: cc } = await admin.from('contacts').select('id', { count: 'exact', head: true });
  const { count: ec } = await admin.from('entity_contacts').select('id', { count: 'exact', head: true });
  console.log(`\nFinal contacts: ${cc}`);
  console.log(`Final entity_contacts: ${ec}`);
}

main().catch(console.error);
