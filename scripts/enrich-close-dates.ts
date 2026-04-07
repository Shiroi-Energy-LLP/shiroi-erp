/**
 * Phase 1.1: Enrich leads from existing HubSpot deals CSV
 *
 * Backfills from hubspot-deals.csv (already in scripts/data/):
 *   - expected_close_date ← "Close Date" column
 *   - assigned_to ← "Deal owner" column → employee_id mapping
 *   - notes ← "Deal Description" + "Next step" (Google Drive links, context)
 *
 * Usage:
 *   npx tsx scripts/enrich-close-dates.ts --dry-run
 *   npx tsx scripts/enrich-close-dates.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── CSV Parser (handles quoted fields with commas) ───

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

// ─── Deal owner → employee_id mapping ───

async function getOwnerMapping(): Promise<Record<string, string>> {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, full_name, profile_id');

  if (error || !employees) {
    console.error('[getOwnerMapping] Failed:', error?.message);
    return {};
  }

  // Build name → employee_id map
  const map: Record<string, string> = {};
  for (const emp of employees) {
    // Match HubSpot owner names to employee records
    const name = emp.full_name?.toLowerCase().trim() ?? '';
    map[name] = emp.id;

    // Also try first name match (HubSpot has "Prem ." and "Vivek Sridhar")
    const firstName = name.split(' ')[0];
    if (firstName) map[firstName] = emp.id;
  }

  return map;
}

function parseHubSpotDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;
  // HubSpot format: "2025-12-13 18:42" or "2025-09-13 18:25"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(match[1]);
  if (isNaN(date.getTime())) return null;
  return match[1]; // Return YYYY-MM-DD
}

async function main() {
  const op = '[enrich-close-dates]';
  const dry = isDryRun();

  // Load HubSpot deals CSV
  const csvPath = resolve(__dirname, 'data/hubspot-deals.csv');
  const csvContent = readFileSync(csvPath, 'utf-8');
  const deals = parseCSV(csvContent);

  logMigrationStart('enrich-close-dates', deals.length);

  // Get owner mapping
  const ownerMap = await getOwnerMapping();
  console.log(`${op} Owner mapping:`, Object.keys(ownerMap).join(', '));

  // Get all leads with hubspot_deal_id
  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, hubspot_deal_id, expected_close_date, assigned_to, notes')
    .not('hubspot_deal_id', 'is', null)
    .is('deleted_at', null);

  if (leadError || !leads) {
    console.error(`${op} Failed to fetch leads:`, leadError?.message);
    return;
  }

  // Build hubspot_deal_id → lead map
  const leadByHubspot = new Map(leads.map((l) => [l.hubspot_deal_id, l]));
  console.log(`${op} ${leadByHubspot.size} leads with hubspot_deal_id`);

  let stats = { processed: 0, updated: 0, skipped: 0, errors: 0 };

  for (const deal of deals) {
    stats.processed++;
    const recordId = deal['Record ID'];
    const lead = leadByHubspot.get(recordId);

    if (!lead) {
      stats.skipped++;
      continue;
    }

    const updates: Record<string, any> = {};

    // Close date
    if (!lead.expected_close_date) {
      const closeDate = parseHubSpotDate(deal['Close Date']);
      if (closeDate) {
        updates.expected_close_date = closeDate;
      }
    }

    // Owner assignment
    if (!lead.assigned_to) {
      const ownerName = deal['Deal owner']?.toLowerCase().trim() ?? '';
      // Try exact match, then first name
      const employeeId = ownerMap[ownerName] || ownerMap[ownerName.split(' ')[0]];
      if (employeeId) {
        updates.assigned_to = employeeId;
      }
    }

    // Notes enrichment (Deal Description + Next step)
    const description = deal['Deal Description']?.trim() ?? '';
    const nextStep = deal['Next step']?.trim() ?? '';
    const existingNotes = lead.notes ?? '';

    const newNotes: string[] = [];
    if (description && !existingNotes.includes(description.slice(0, 50))) {
      newNotes.push(`[HubSpot Description] ${description}`);
    }
    if (nextStep && !existingNotes.includes(nextStep.slice(0, 30))) {
      newNotes.push(`[HubSpot Next Step] ${nextStep}`);
    }

    if (newNotes.length > 0) {
      updates.notes = (existingNotes ? existingNotes + '\n' : '') + newNotes.join('\n');
    }

    if (Object.keys(updates).length === 0) {
      stats.skipped++;
      continue;
    }

    if (dry) {
      console.log(`  Would update lead ${lead.id}: ${Object.keys(updates).join(', ')}`);
      stats.updated++;
    } else {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', lead.id);

      if (error) {
        console.error(`  Error updating lead ${lead.id}:`, error.message);
        stats.errors++;
      } else {
        stats.updated++;
      }
    }
  }

  logMigrationEnd('enrich-close-dates', {
    processed: stats.processed,
    inserted: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[enrich-close-dates] Fatal error:', err);
  process.exit(1);
});
