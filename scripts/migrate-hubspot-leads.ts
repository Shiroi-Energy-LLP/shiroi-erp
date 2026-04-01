/**
 * HubSpot Lead Migration Script
 *
 * Imports leads from HubSpot CSV export into the Shiroi ERP database.
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
 *            (checks hubspot_deal_id for existing records).
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  normalizePhone,
  deduplicateByPhone,
  parseCSV,
  isDryRun,
  logMigrationStart,
  logMigrationEnd,
} from './migration-utils';

// Column mapping: HubSpot CSV column name → Shiroi ERP field
const COLUMN_MAP: Record<string, string> = {
  'Deal ID': 'hubspot_deal_id',
  'Contact Name': 'customer_name',
  'Phone': 'phone',
  'Email': 'email',
  'City': 'city',
  'State': 'state',
  'Source': 'source',
  'System Size (kWp)': 'estimated_size_kwp',
  'Segment': 'segment',
  'Created Date': 'created_at',
  'Notes': 'notes',
};

// Map HubSpot source values to Shiroi ERP lead_source enum
const SOURCE_MAP: Record<string, string> = {
  'Referral': 'referral',
  'Website': 'website',
  'Builder': 'builder_tie_up',
  'Channel Partner': 'channel_partner',
  'Cold Call': 'cold_call',
  'Exhibition': 'exhibition',
  'Social Media': 'social_media',
  'Walk-in': 'walkin',
  'Walk In': 'walkin',
};

const SEGMENT_MAP: Record<string, string> = {
  'Residential': 'residential',
  'Commercial': 'commercial',
  'Industrial': 'industrial',
};

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

  const rawRecords = parseCSV(csvContent);
  logMigrationStart('HubSpot Lead Migration', rawRecords.length);

  // Map columns
  const mappedRecords = rawRecords.map(raw => {
    const mapped: Record<string, string> = {};
    for (const [hubspotCol, erpField] of Object.entries(COLUMN_MAP)) {
      if (raw[hubspotCol] !== undefined) {
        mapped[erpField] = raw[hubspotCol];
      }
    }
    // Normalize source and segment
    mapped.source = SOURCE_MAP[mapped.source ?? ''] ?? 'website';
    mapped.segment = SEGMENT_MAP[mapped.segment ?? ''] ?? 'residential';
    return mapped;
  });

  // Normalize phones and deduplicate
  const withPhones = mappedRecords
    .filter(r => r.phone && r.phone.trim() !== '')
    .map(r => ({ ...r, phone: normalizePhone(r.phone) }));

  const { unique, duplicates } = deduplicateByPhone(withPhones);

  console.log(`${op} Records after phone normalization: ${withPhones.length}`);
  console.log(`${op} Duplicates removed: ${duplicates.length}`);
  console.log(`${op} Unique records to process: ${unique.length}`);

  if (dryRun) {
    console.log(`\n${op} DRY RUN — no database writes performed.`);
    logMigrationEnd('HubSpot Lead Migration (DRY RUN)', {
      processed: rawRecords.length,
      inserted: unique.length,
      skipped: duplicates.length + (rawRecords.length - withPhones.length),
      errors: 0,
    });
    return;
  }

  // Initialize Supabase admin client
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${op} Missing SUPABASE_URL or SUPABASE_SECRET_KEY`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of unique) {
    try {
      // Idempotency: check if hubspot_deal_id already exists
      if (record.hubspot_deal_id) {
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('hubspot_deal_id', record.hubspot_deal_id)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }
      }

      const { error } = await supabase.from('leads').insert({
        customer_name: record.customer_name || 'Unknown',
        phone: record.phone,
        email: record.email || null,
        city: record.city || 'Chennai',
        state: record.state || 'Tamil Nadu',
        source: record.source as 'referral' | 'website' | 'builder_tie_up' | 'channel_partner' | 'cold_call' | 'exhibition' | 'social_media' | 'walkin',
        segment: record.segment as 'residential' | 'commercial' | 'industrial',
        estimated_size_kwp: record.estimated_size_kwp ? parseFloat(record.estimated_size_kwp) : null,
        hubspot_deal_id: record.hubspot_deal_id || null,
        notes: record.notes || null,
        status: 'new',
      });

      if (error) {
        console.error(`${op} Insert failed for "${record.customer_name}" (${record.phone}):`, {
          code: error.code,
          message: error.message,
        });
        errors++;
      } else {
        inserted++;
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
    skipped: skipped + duplicates.length,
    errors,
  });
}

main().catch(console.error);
