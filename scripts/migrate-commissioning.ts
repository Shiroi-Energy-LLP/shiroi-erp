/**
 * Commissioning Projects Migration Script
 *
 * Imports ~500 commissioning-only projects (plants + commissioning reports).
 * These are historical installations with basic commissioning data.
 *
 * Usage:
 *   npx tsx scripts/migrate-commissioning.ts --dry-run
 *   npx tsx scripts/migrate-commissioning.ts
 *
 * IMPORTANT: Run AFTER project actuals migration (Step 18.5).
 *
 * Prerequisites:
 *   - Commissioning CSV at scripts/data/commissioning-projects.csv
 *   - SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  normalizePhone,
  parseCSV,
  isDryRun,
  logMigrationStart,
  logMigrationEnd,
  isValidDate,
} from './migration-utils';

async function main() {
  const op = '[migrate-commissioning]';
  const dryRun = isDryRun();

  const csvPath = 'scripts/data/commissioning-projects.csv';
  let csvContent: string;
  try {
    csvContent = readFileSync(csvPath, 'utf-8');
  } catch {
    console.error(`${op} CSV file not found: ${csvPath}`);
    console.error(`${op} Prepare commissioning data and place at: ${csvPath}`);
    process.exit(1);
  }

  const rawRecords = parseCSV(csvContent);
  logMigrationStart('Commissioning Projects Migration', rawRecords.length);

  if (dryRun) {
    let validCount = 0;
    let invalidCount = 0;

    for (const record of rawRecords) {
      const hasRequired = record['customer_name'] && record['customer_phone'];
      if (hasRequired) {
        validCount++;
      } else {
        invalidCount++;
        console.warn(`${op} Missing required fields:`, {
          customer_name: record['customer_name'] ?? 'MISSING',
          customer_phone: record['customer_phone'] ?? 'MISSING',
        });
      }
    }

    console.log(`\n${op} DRY RUN — no database writes performed.`);
    logMigrationEnd('Commissioning Projects Migration (DRY RUN)', {
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
      if (!record['customer_name'] || !record['customer_phone']) {
        skipped++;
        continue;
      }

      const phone = normalizePhone(record['customer_phone']);

      // Check for existing by phone to avoid duplicates
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id')
        .eq('customer_phone', phone)
        .maybeSingle();

      if (existingProject) {
        skipped++;
        continue;
      }

      // Preserve historical dates
      const commissionedDate = isValidDate(record['commissioned_date'] ?? '')
        ? record['commissioned_date']
        : null;

      const createdAt = isValidDate(record['created_at'] ?? '')
        ? record['created_at']
        : undefined;

      // Insert project with commissioned status
      const projectId = crypto.randomUUID();
      const { error: projectError } = await supabase.from('projects').insert({
        id: projectId,
        project_number: record['project_number'] || `HIST-${inserted + 1}`,
        customer_name: record['customer_name'],
        customer_phone: phone,
        customer_email: record['customer_email'] || null,
        site_city: record['city'] || 'Chennai',
        site_state: record['state'] || 'Tamil Nadu',
        site_address_line1: record['address'] || '',
        system_size_kwp: parseFloat(record['system_size_kwp'] || '0'),
        system_type: (record['system_type'] || 'on_grid') as 'on_grid' | 'hybrid' | 'off_grid',
        status: 'completed' as const,
        contracted_value: parseFloat(record['contracted_value'] || '0'),
        advance_amount: parseFloat(record['advance_amount'] || '0'),
        advance_received_at: record['advance_date'] || new Date().toISOString(),
        commissioned_date: commissionedDate,
        panel_count: parseInt(record['panel_count'] || '0', 10),
        lead_id: crypto.randomUUID(),
        proposal_id: crypto.randomUUID(),
        ...(createdAt ? { created_at: createdAt } : {}),
      });

      if (projectError) {
        console.error(`${op} Project insert failed:`, {
          code: projectError.code,
          message: projectError.message,
          customer: record['customer_name'],
        });
        errors++;
        continue;
      }

      inserted++;

      // Optionally insert commissioning report if data available
      if (record['ir_value'] || record['voc_reading']) {
        const { error: reportError } = await supabase.from('commissioning_reports').insert({
          project_id: projectId,
          commissioning_date: commissionedDate || new Date().toISOString().split('T')[0],
          ir_value_megaohm: parseFloat(record['ir_value'] || '0'),
          voc_reading: parseFloat(record['voc_reading'] || '0'),
          status: 'approved',
          submitted_by: record['submitted_by'] || crypto.randomUUID(),
        });

        if (reportError) {
          console.warn(`${op} Commissioning report insert failed for ${record['customer_name']}:`, {
            code: reportError.code,
            message: reportError.message,
          });
        }
      }
    } catch (err) {
      console.error(`${op} Unexpected error:`, {
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  // Verify plant records
  const { count: plantCount } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed');

  console.log(`${op} Total completed projects in DB: ${plantCount}`);

  logMigrationEnd('Commissioning Projects Migration', {
    processed: rawRecords.length,
    inserted,
    skipped,
    errors,
  });
}

main().catch(console.error);
