/**
 * HubSpot Lead Migration Script
 *
 * Imports leads from HubSpot CSV export into the Shiroi ERP database.
 * Deduplicates against existing leads (from Google Drive migration) by phone number.
 *
 * Usage:
 *   npx tsx scripts/migrate-hubspot-leads.ts --dry-run    (required first pass)
 *   npx tsx scripts/migrate-hubspot-leads.ts               (live run)
 *
 * Prerequisites:
 *   - HubSpot CSV exported to scripts/data/hubspot-leads.csv
 *   - SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
 *
 * IMPORTANT: Run --dry-run first. Always verify counts before live run.
 * IMPORTANT: This script is IDEMPOTENT — running twice will not create duplicates
 *            (checks phone + hubspot_deal_id for existing records).
 */

import { readFileSync } from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import {
  normalizePhone,
  isDryRun,
  logMigrationStart,
  logMigrationEnd,
} from './migration-utils';

// Load env from .env.local
config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Column mapping: HubSpot CSV column name → internal field name
// UPDATE THESE if your HubSpot export uses different headers
// ---------------------------------------------------------------------------
const COLUMN_MAP: Record<string, string> = {
  // Common HubSpot contact/deal column names
  'Deal ID': 'hubspot_deal_id',
  'Record ID': 'hubspot_deal_id',
  'Contact Name': 'customer_name',
  'First Name': 'first_name',
  'Last Name': 'last_name',
  'Full Name': 'customer_name',
  'Name': 'customer_name',
  'Phone Number': 'phone',
  'Phone': 'phone',
  'Mobile Phone Number': 'phone',
  'Email': 'email',
  'City': 'city',
  'State/Region': 'state',
  'State': 'state',
  'Lead Source': 'source',
  'Original Source': 'source',
  'Source': 'source',
  'System Size (kWp)': 'estimated_size_kwp',
  'System Size': 'estimated_size_kwp',
  'Segment': 'segment',
  'Customer Segment': 'segment',
  'Create Date': 'created_at',
  'Created Date': 'created_at',
  'Create date': 'created_at',
  'Deal Stage': 'deal_stage',
  'Lifecycle Stage': 'lifecycle_stage',
  'Notes': 'notes',
  'Address': 'address_line1',
  'Street Address': 'address_line1',
  'Zip': 'pincode',
  'Postal Code': 'pincode',
  'System Type': 'system_type',
};

// Map HubSpot source values to Shiroi ERP lead_source enum
const SOURCE_MAP: Record<string, string> = {
  'Referral': 'referral',
  'referral': 'referral',
  'Website': 'website',
  'website': 'website',
  'ORGANIC_SEARCH': 'website',
  'DIRECT_TRAFFIC': 'website',
  'Builder': 'builder_tie_up',
  'builder_tie_up': 'builder_tie_up',
  'Channel Partner': 'channel_partner',
  'channel_partner': 'channel_partner',
  'Cold Call': 'cold_call',
  'cold_call': 'cold_call',
  'Exhibition': 'exhibition',
  'exhibition': 'exhibition',
  'Social Media': 'social_media',
  'social_media': 'social_media',
  'SOCIAL_MEDIA': 'social_media',
  'PAID_SOCIAL': 'social_media',
  'Walk-in': 'walkin',
  'Walk In': 'walkin',
  'walkin': 'walkin',
  'OFFLINE': 'walkin',
  'OTHER_CAMPAIGNS': 'website',
  'PAID_SEARCH': 'website',
};

const SEGMENT_MAP: Record<string, string> = {
  'Residential': 'residential',
  'residential': 'residential',
  'Commercial': 'commercial',
  'commercial': 'commercial',
  'Industrial': 'industrial',
  'industrial': 'industrial',
};

const SYSTEM_TYPE_MAP: Record<string, string> = {
  'on_grid': 'on_grid',
  'On Grid': 'on_grid',
  'hybrid': 'hybrid',
  'Hybrid': 'hybrid',
  'off_grid': 'off_grid',
  'Off Grid': 'off_grid',
};

// HubSpot deal stage → Shiroi lead_status mapping
const DEAL_STAGE_MAP: Record<string, string> = {
  'appointmentscheduled': 'contacted',
  'qualifiedtobuy': 'site_survey_scheduled',
  'presentationscheduled': 'site_survey_done',
  'decisionmakerboughtin': 'proposal_sent',
  'contractsent': 'negotiation',
  'closedwon': 'won',
  'closedlost': 'lost',
  // Common custom stages
  'new': 'new',
  'contacted': 'contacted',
  'site_survey': 'site_survey_scheduled',
  'proposal': 'proposal_sent',
  'negotiation': 'negotiation',
  'won': 'won',
  'lost': 'lost',
};

// ---------------------------------------------------------------------------
// Proper CSV parser that handles quoted fields with commas
// ---------------------------------------------------------------------------
function parseCSVProper(csvContent: string): Record<string, string>[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const ch = csvContent[i];
    if (ch === '"') {
      if (inQuotes && csvContent[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip carriage return
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((header, j) => {
      record[header] = (values[j] ?? '').trim();
    });
    records.push(record);
  }

  return records;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// ---------------------------------------------------------------------------
// Load existing leads from DB for dedup
// ---------------------------------------------------------------------------
async function loadExistingLeads(supabase: SupabaseClient): Promise<{
  byPhone: Map<string, string>;
  byHubspotId: Set<string>;
}> {
  const op = '[loadExistingLeads]';
  console.log(`${op} Loading existing leads for dedup...`);

  const byPhone = new Map<string, string>(); // normalized phone → lead ID
  const byHubspotId = new Set<string>();

  let offset = 0;
  const batchSize = 1000;
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, hubspot_deal_id')
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`${op} Failed to load leads:`, error.message);
      throw error;
    }
    if (!data || data.length === 0) break;

    for (const lead of data) {
      if (lead.phone) {
        const normalized = normalizePhone(lead.phone);
        byPhone.set(normalized, lead.id);
      }
      if (lead.hubspot_deal_id) {
        byHubspotId.add(lead.hubspot_deal_id);
      }
    }

    total += data.length;
    offset += batchSize;
  }

  console.log(`${op} Loaded ${total} existing leads (${byPhone.size} with phones, ${byHubspotId.size} with HubSpot IDs)`);
  return { byPhone, byHubspotId };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const op = '[migrate-hubspot-leads]';
  const dryRun = isDryRun();

  // Read CSV
  const csvPath = 'scripts/data/hubspot-leads.csv';
  let csvContent: string;
  try {
    csvContent = readFileSync(csvPath, 'utf-8');
  } catch {
    console.error(`${op} CSV file not found: ${csvPath}`);
    console.error(`${op} Export from HubSpot and place at: ${csvPath}`);
    process.exit(1);
  }

  const rawRecords = parseCSVProper(csvContent);

  // Print detected columns for verification
  if (rawRecords.length > 0) {
    const csvHeaders = Object.keys(rawRecords[0]);
    console.log(`\n${op} Detected CSV columns (${csvHeaders.length}):`);
    csvHeaders.forEach(h => {
      const mapped = COLUMN_MAP[h];
      console.log(`  "${h}" → ${mapped ? mapped : '(unmapped, ignored)'}`);
    });
    console.log('');
  }

  logMigrationStart('HubSpot Lead Migration', rawRecords.length);

  // Map columns
  const mappedRecords = rawRecords.map(raw => {
    const mapped: Record<string, string> = {};
    for (const [csvCol, value] of Object.entries(raw)) {
      const erpField = COLUMN_MAP[csvCol];
      if (erpField && value) {
        // Handle first_name + last_name → customer_name
        if (erpField === 'first_name') {
          mapped.customer_name = (mapped.customer_name || '') ?
            mapped.customer_name : value;
        } else if (erpField === 'last_name') {
          mapped.customer_name = mapped.customer_name ?
            `${mapped.customer_name} ${value}`.trim() : value;
        } else {
          // Don't overwrite if already set (first match wins)
          if (!mapped[erpField]) {
            mapped[erpField] = value;
          }
        }
      }
    }

    // Normalize enums
    mapped.source = SOURCE_MAP[mapped.source ?? ''] ?? 'website';
    mapped.segment = SEGMENT_MAP[mapped.segment ?? ''] ?? 'residential';
    mapped.system_type = SYSTEM_TYPE_MAP[mapped.system_type ?? ''] ?? '';

    // Map deal stage to lead status
    if (mapped.deal_stage) {
      const stage = mapped.deal_stage.toLowerCase().replace(/\s+/g, '');
      mapped.lead_status = DEAL_STAGE_MAP[stage] ?? 'new';
    } else if (mapped.lifecycle_stage) {
      const stage = mapped.lifecycle_stage.toLowerCase().replace(/\s+/g, '');
      mapped.lead_status = DEAL_STAGE_MAP[stage] ?? 'new';
    } else {
      mapped.lead_status = 'new';
    }

    return mapped;
  });

  // Split: records with phones and without
  const withPhones = mappedRecords.filter(r => r.phone && r.phone.trim() !== '');
  const noPhones = mappedRecords.filter(r => !r.phone || r.phone.trim() === '');

  console.log(`${op} Records with phone: ${withPhones.length}`);
  console.log(`${op} Records without phone (will be imported with notes): ${noPhones.length}`);

  // Normalize phones
  const normalized = withPhones.map(r => ({
    ...r,
    phone: normalizePhone(r.phone),
  }));

  // Dedup within CSV (keep first occurrence per phone)
  const phonesSeen = new Map<string, typeof normalized[0]>();
  const csvDuplicates: typeof normalized = [];
  for (const record of normalized) {
    if (phonesSeen.has(record.phone)) {
      csvDuplicates.push(record);
    } else {
      phonesSeen.set(record.phone, record);
    }
  }
  const uniqueByPhone = Array.from(phonesSeen.values());

  console.log(`${op} CSV internal duplicates removed: ${csvDuplicates.length}`);
  console.log(`${op} Unique records (with phone): ${uniqueByPhone.length}`);

  // Initialize Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load existing leads for cross-dedup
  const existing = await loadExistingLeads(supabase);

  // Check each record against existing DB leads
  const toInsert: typeof uniqueByPhone = [];
  let dbDuplicates = 0;

  for (const record of uniqueByPhone) {
    // Check by HubSpot deal ID first
    if (record.hubspot_deal_id && existing.byHubspotId.has(record.hubspot_deal_id)) {
      dbDuplicates++;
      continue;
    }
    // Check by phone number
    if (existing.byPhone.has(record.phone)) {
      dbDuplicates++;
      continue;
    }
    toInsert.push(record);
  }

  // Also check no-phone records by HubSpot ID
  const noPhoneToInsert = noPhones.filter(r => {
    if (r.hubspot_deal_id && existing.byHubspotId.has(r.hubspot_deal_id)) return false;
    return true;
  });

  console.log(`${op} Already in DB (phone or HubSpot ID match): ${dbDuplicates}`);
  console.log(`${op} New records to insert (with phone): ${toInsert.length}`);
  console.log(`${op} New records to insert (no phone): ${noPhoneToInsert.length}`);

  if (dryRun) {
    console.log(`\n${op} DRY RUN — no database writes performed.`);
    console.log(`\n${op} Sample records that would be inserted:`);
    const sample = [...toInsert.slice(0, 3), ...noPhoneToInsert.slice(0, 2)];
    for (const r of sample) {
      console.log(`  ${r.customer_name || '(no name)'} | ${r.phone || '(no phone)'} | ${r.source} | ${r.segment} | ${r.lead_status}`);
    }
    logMigrationEnd('HubSpot Lead Migration (DRY RUN)', {
      processed: rawRecords.length,
      inserted: toInsert.length + noPhoneToInsert.length,
      skipped: dbDuplicates + csvDuplicates.length + (rawRecords.length - mappedRecords.length),
      errors: 0,
    });
    return;
  }

  // Insert records
  let inserted = 0;
  let errors = 0;
  const allToInsert = [...toInsert, ...noPhoneToInsert];

  for (const record of allToInsert) {
    try {
      // Parse system size
      let estimatedSizeKwp: number | null = null;
      if (record.estimated_size_kwp) {
        const parsed = parseFloat(record.estimated_size_kwp);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 9999.99) {
          estimatedSizeKwp = parsed;
        }
      }

      // Parse created date
      let createdAt: string | undefined;
      if (record.created_at) {
        const d = new Date(record.created_at);
        if (!isNaN(d.getTime())) {
          createdAt = d.toISOString();
        }
      }

      const insertData: Record<string, unknown> = {
        customer_name: record.customer_name || 'Unknown (HubSpot)',
        phone: record.phone || `HUBSPOT-NO-PHONE-${record.hubspot_deal_id || Date.now()}`,
        email: record.email || null,
        city: record.city || 'Chennai',
        state: record.state || 'Tamil Nadu',
        source: record.source as string,
        segment: record.segment as string,
        estimated_size_kwp: estimatedSizeKwp,
        hubspot_deal_id: record.hubspot_deal_id || null,
        notes: record.notes ? `[HubSpot Import] ${record.notes}` : '[HubSpot Import]',
        status: record.lead_status || 'new',
        address_line1: record.address_line1 || null,
        pincode: record.pincode || null,
      };

      // Only set system_type if valid
      if (record.system_type && ['on_grid', 'hybrid', 'off_grid'].includes(record.system_type)) {
        insertData.system_type = record.system_type;
      }

      // Set created_at if we have it
      if (createdAt) {
        insertData.created_at = createdAt;
      }

      const { error } = await supabase.from('leads').insert(insertData);

      if (error) {
        // Handle phone uniqueness constraint
        if (error.code === '23505' && error.message.includes('phone')) {
          console.warn(`${op} Phone uniqueness conflict for "${record.customer_name}" (${record.phone}) — skipping`);
          dbDuplicates++;
        } else {
          console.error(`${op} Insert failed for "${record.customer_name}" (${record.phone}):`, {
            code: error.code,
            message: error.message,
          });
          errors++;
        }
      } else {
        inserted++;
        if (inserted % 50 === 0) {
          console.log(`${op} Progress: ${inserted} inserted...`);
        }
      }
    } catch (err) {
      console.error(`${op} Unexpected error for "${record.customer_name}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  logMigrationEnd('HubSpot Lead Migration', {
    processed: rawRecords.length,
    inserted,
    skipped: dbDuplicates + csvDuplicates.length,
    errors,
  });
}

main().catch(console.error);
