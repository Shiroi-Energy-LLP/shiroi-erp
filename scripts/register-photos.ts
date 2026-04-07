/**
 * Phase 4.1: Register all photos from Supabase Storage into site_photos table
 *
 * Currently: 1,794 photos across both buckets, 0 rows in site_photos.
 * This script:
 *   1. Lists all JPEG/PNG files in proposal-files and project-files buckets
 *   2. Matches to projects via lead_id folder UUID
 *   3. Inserts into site_photos table
 *   4. Logs in processing_jobs
 *
 * Usage:
 *   npx tsx scripts/register-photos.ts --dry-run
 *   npx tsx scripts/register-photos.ts
 */

import { createClient } from '@supabase/supabase-js';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// ─── Photo type inference from filename ───

function inferPhotoType(filename: string): string {
  // Must match site_photos_photo_type_check constraint:
  // progress, material_received, qc_gate, issue, commissioning, before_work, after_work, survey, other
  const lower = filename.toLowerCase();
  if (/before|pre.?install|existing|site.?visit/i.test(lower)) return 'before_work';
  if (/after|complete|finish|done|handover/i.test(lower)) return 'after_work';
  if (/survey|roof|terrace|elevation/i.test(lower)) return 'survey';
  if (/commission|meter|reading|ceig/i.test(lower)) return 'commissioning';
  if (/material|delivery|received|unload/i.test(lower)) return 'material_received';
  if (/qc|quality|inspect|gate/i.test(lower)) return 'qc_gate';
  if (/issue|damage|defect|problem/i.test(lower)) return 'issue';
  if (/panel|module|install|struct|mount|frame|inverter|cable|wire/i.test(lower)) return 'progress';
  return 'other';
}

async function main() {
  const op = '[register-photos]';
  const dry = isDryRun();

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Build lead → project mapping ═══
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id');

  const projectByLeadId = new Map<string, string>();
  for (const p of projects ?? []) {
    if (p.lead_id) projectByLeadId.set(p.lead_id, p.id);
  }
  console.log(`${op} ${projectByLeadId.size} leads with projects`);

  // Check existing site_photos to avoid duplicates
  const { data: existingPhotos } = await supabase
    .from('site_photos')
    .select('storage_path')
    .limit(10000);

  const existingPaths = new Set((existingPhotos ?? []).map((p) => p.storage_path));
  console.log(`${op} ${existingPaths.size} existing photos in DB`);

  // ═══ Scan both buckets for photos ═══
  const buckets = ['proposal-files', 'project-files'];
  const photoFiles: { bucket: string; path: string; size: number; leadId: string; filename: string }[] = [];

  for (const bucket of buckets) {
    console.log(`\n${op} Scanning bucket: ${bucket}...`);

    const { data: folders } = await supabase.storage.from(bucket).list('', { limit: 2000 });
    if (!folders) continue;

    const uuidFolders = folders.filter((f) => !f.id); // Folders have id=null
    let found = 0;

    for (const folder of uuidFolders) {
      const { data: files } = await supabase.storage.from(bucket).list(folder.name, { limit: 500 });
      if (!files) continue;

      for (const f of files) {
        const fname = f.name.toLowerCase();
        if (fname.endsWith('.jpg') || fname.endsWith('.jpeg') || fname.endsWith('.png') || fname.endsWith('.webp')) {
          const meta = f.metadata as Record<string, any> | null;
          const fullPath = `${folder.name}/${f.name}`;

          if (!existingPaths.has(fullPath)) {
            photoFiles.push({
              bucket,
              path: fullPath,
              size: meta?.size ?? 0,
              leadId: folder.name,
              filename: f.name,
            });
            found++;
          }
        }
      }

      if (found > 0 && found % 100 === 0) {
        process.stdout.write(`\r${op} Found ${found} new photos in ${bucket}...`);
      }
    }
    console.log(`\n${op} ${found} new photos in ${bucket}`);
  }

  logMigrationStart('register-photos', photoFiles.length);

  let stats = { inserted: 0, skippedNoProject: 0, errors: 0 };

  // ═══ Insert photos ═══
  const BATCH_SIZE = 50;

  for (let i = 0; i < photoFiles.length; i += BATCH_SIZE) {
    const batch = photoFiles.slice(i, i + BATCH_SIZE);
    const rows = batch
      .map((photo) => {
        const projectId = projectByLeadId.get(photo.leadId);
        if (!projectId) {
          stats.skippedNoProject++;
          return null;
        }

        return {
          project_id: projectId,
          storage_path: `${photo.bucket}/${photo.path}`,
          file_name: photo.filename,
          file_size_bytes: photo.size,
          mime_type: photo.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
          photo_type: inferPhotoType(photo.filename),
          uploaded_by: '589b7878-46eb-4d6c-ba24-079d167d0e89', // "Migration System" employee
          sync_status: 'synced',
        };
      })
      .filter(Boolean);

    if (rows.length === 0) continue;

    if (dry) {
      for (const row of rows) {
        if (row) {
          console.log(`  ${row.file_name.substring(0, 50).padEnd(52)} → project ${row.project_id.substring(0, 8)} [${row.photo_type}]`);
        }
      }
      stats.inserted += rows.length;
    } else {
      const { error } = await supabase.from('site_photos').insert(rows);
      if (error) {
        console.error(`${op} Batch insert error:`, error.message);
        stats.errors++;
      } else {
        stats.inserted += rows.length;
      }
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      console.log(`${op} Progress: ${i}/${photoFiles.length} (inserted: ${stats.inserted})`);
    }
  }

  logMigrationEnd('register-photos', {
    processed: photoFiles.length,
    inserted: stats.inserted,
    skipped: stats.skippedNoProject,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[register-photos] Fatal error:', err);
  process.exit(1);
});
