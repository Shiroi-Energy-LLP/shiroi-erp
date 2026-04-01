/**
 * Project Actuals Migration Script
 *
 * Imports 100 projects with full actuals (costs, revenues, vendor payments)
 * into the Shiroi ERP database. These seed the BOM correction factors.
 *
 * Usage:
 *   npx tsx scripts/migrate-projects-actuals.ts --dry-run
 *   npx tsx scripts/migrate-projects-actuals.ts
 *
 * IMPORTANT: Run this BEFORE HubSpot migration — correction factors must come
 * from real project actuals, not from HubSpot estimate data.
 *
 * Prerequisites:
 *   - Project actuals CSV at scripts/data/project-actuals.csv
 *   - SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  parseCSV,
  isDryRun,
  logMigrationStart,
  logMigrationEnd,
  isValidDate,
} from './migration-utils';

async function main() {
  const op = '[migrate-projects-actuals]';
  const dryRun = isDryRun();

  const csvPath = 'scripts/data/project-actuals.csv';
  let csvContent: string;
  try {
    csvContent = readFileSync(csvPath, 'utf-8');
  } catch {
    console.error(`${op} CSV file not found: ${csvPath}`);
    console.error(`${op} Prepare project actuals data and place at: ${csvPath}`);
    process.exit(1);
  }

  const rawRecords = parseCSV(csvContent);
  logMigrationStart('Project Actuals Migration', rawRecords.length);

  if (dryRun) {
    // Validate and report
    let validCount = 0;
    let invalidCount = 0;

    for (const record of rawRecords) {
      const hasRequired = record['project_number'] && record['customer_name'] && record['customer_phone'];
      if (hasRequired) {
        validCount++;
      } else {
        invalidCount++;
        console.warn(`${op} Missing required fields:`, {
          project_number: record['project_number'] ?? 'MISSING',
          customer_name: record['customer_name'] ?? 'MISSING',
        });
      }
    }

    console.log(`\n${op} DRY RUN — no database writes performed.`);
    console.log(`${op} Valid records: ${validCount}`);
    console.log(`${op} Invalid records: ${invalidCount}`);
    logMigrationEnd('Project Actuals Migration (DRY RUN)', {
      processed: rawRecords.length,
      inserted: validCount,
      skipped: invalidCount,
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

  for (const record of rawRecords) {
    try {
      // Check if project already exists by project_number
      const { data: existing } = await supabase
        .from('projects')
        .select('id')
        .eq('project_number', record['project_number'])
        .maybeSingle();

      if (existing) {
        console.log(`${op} Project ${record['project_number']} already exists, skipping`);
        skipped++;
        continue;
      }

      // Validate required fields
      if (!record['project_number'] || !record['customer_name'] || !record['customer_phone']) {
        console.warn(`${op} Skipping record — missing required fields`);
        skipped++;
        continue;
      }

      // Preserve historical created_at (not migration run time)
      const createdAt = isValidDate(record['created_at'] ?? '')
        ? record['created_at']
        : undefined;

      console.log(`${op} Inserting project: ${record['project_number']}`);

      // Note: Full project insert would include many fields.
      // This is a template — Vivek will provide the exact CSV column mapping.
      const { error } = await supabase.from('projects').insert({
        project_number: record['project_number'],
        customer_name: record['customer_name'],
        customer_phone: record['customer_phone'],
        customer_email: record['customer_email'] || null,
        site_city: record['city'] || 'Chennai',
        site_state: record['state'] || 'Tamil Nadu',
        site_address_line1: record['address'] || '',
        system_size_kwp: parseFloat(record['system_size_kwp'] || '0'),
        system_type: (record['system_type'] || 'on_grid') as 'on_grid' | 'hybrid' | 'off_grid',
        contracted_value: parseFloat(record['contracted_value'] || '0'),
        advance_amount: parseFloat(record['advance_amount'] || '0'),
        advance_received_at: record['advance_date'] || new Date().toISOString(),
        status: (record['status'] || 'completed') as 'completed',
        lead_id: record['lead_id'] || crypto.randomUUID(),
        proposal_id: record['proposal_id'] || crypto.randomUUID(),
        panel_count: parseInt(record['panel_count'] || '0', 10),
        ...(createdAt ? { created_at: createdAt } : {}),
      });

      if (error) {
        console.error(`${op} Insert failed for ${record['project_number']}:`, {
          code: error.code,
          message: error.message,
        });
        errors++;
      } else {
        inserted++;
      }
    } catch (err) {
      console.error(`${op} Unexpected error:`, {
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  // After project insert, verify correction factors were seeded
  const { data: correctionFactors } = await supabase
    .from('bom_correction_factors')
    .select('id')
    .limit(5);

  if (correctionFactors && correctionFactors.length > 0) {
    console.log(`${op} BOM correction factors seeded: ${correctionFactors.length}+ entries`);
  } else {
    console.warn(`${op} WARNING: No bom_correction_factors found after migration. Check DB triggers.`);
  }

  logMigrationEnd('Project Actuals Migration', {
    processed: rawRecords.length,
    inserted,
    skipped,
    errors,
  });
}

main().catch(console.error);
