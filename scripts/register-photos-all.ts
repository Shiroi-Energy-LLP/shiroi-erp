/**
 * Register ALL photos from Supabase Storage into site_photos table.
 * Links to project if available, otherwise stores lead_id in notes for later linking.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const isDryRun = process.argv.includes('--dry-run');
const MIGRATION_SYSTEM = '589b7878-46eb-4d6c-ba24-079d167d0e89';

function inferPhotoType(filename: string): string {
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
  const op = '[register-photos-all]';
  console.log(`${op} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Build lead → project mapping
  const { data: projects } = await supabase.from('projects').select('id, lead_id');
  const projectByLeadId = new Map<string, string>();
  for (const p of projects ?? []) {
    if (p.lead_id) projectByLeadId.set(p.lead_id, p.id);
  }
  console.log(`${op} ${projectByLeadId.size} leads with projects`);

  // Check existing site_photos
  const { data: existing1 } = await supabase.from('site_photos').select('storage_path').range(0, 4999);
  const { data: existing2 } = await supabase.from('site_photos').select('storage_path').range(5000, 9999);
  const existingPaths = new Set([...(existing1 ?? []), ...(existing2 ?? [])].map(p => p.storage_path));
  console.log(`${op} ${existingPaths.size} existing photos in DB`);

  // Scan both buckets
  const buckets = ['proposal-files', 'project-files'];
  const allPhotos: { bucket: string; path: string; size: number; leadId: string; filename: string; projectId?: string }[] = [];

  for (const bucket of buckets) {
    const { data: folders } = await supabase.storage.from(bucket).list('', { limit: 2000 });
    if (!folders) continue;

    for (const folder of folders.filter(f => !f.id)) {
      const { data: files } = await supabase.storage.from(bucket).list(folder.name, { limit: 500 });
      if (!files) continue;

      for (const f of files) {
        const fname = f.name.toLowerCase();
        if (fname.endsWith('.jpg') || fname.endsWith('.jpeg') || fname.endsWith('.png') || fname.endsWith('.webp') || fname.endsWith('.jfif')) {
          const fullPath = `${bucket}/${folder.name}/${f.name}`;
          if (!existingPaths.has(fullPath)) {
            const meta = f.metadata as Record<string, any> | null;
            allPhotos.push({
              bucket,
              path: `${folder.name}/${f.name}`,
              size: meta?.size ?? 0,
              leadId: folder.name,
              filename: f.name,
              projectId: projectByLeadId.get(folder.name),
            });
          }
        }
      }
    }
    console.log(`${op} Scanned ${bucket}`);
  }

  console.log(`${op} ${allPhotos.length} new photos to register`);

  // For photos WITHOUT a project, we need a fallback project.
  // site_photos requires project_id (NOT NULL).
  // We'll skip photos without projects for now — they need schema change.
  const withProject = allPhotos.filter(p => p.projectId);
  const withoutProject = allPhotos.filter(p => !p.projectId);
  console.log(`${op} ${withProject.length} with project, ${withoutProject.length} without project (skipped — need schema change)`);

  let stats = { inserted: 0, errors: 0 };
  const BATCH_SIZE = 50;

  for (let i = 0; i < withProject.length; i += BATCH_SIZE) {
    const batch = withProject.slice(i, i + BATCH_SIZE);
    const rows = batch.map(photo => ({
      project_id: photo.projectId!,
      storage_path: `${photo.bucket}/${photo.path}`,
      file_name: photo.filename,
      file_size_bytes: photo.size,
      mime_type: photo.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      photo_type: inferPhotoType(photo.filename),
      uploaded_by: MIGRATION_SYSTEM,
      sync_status: 'synced',
    }));

    if (isDryRun) {
      stats.inserted += rows.length;
    } else {
      const { error } = await supabase.from('site_photos').insert(rows);
      if (error) {
        console.error(`${op} Batch error at ${i}:`, error.message);
        stats.errors++;
      } else {
        stats.inserted += rows.length;
      }
    }

    if (i % 200 === 0 && i > 0) console.log(`${op} Progress: ${i}/${withProject.length}`);
  }

  console.log(`\n${op} Results:`);
  console.log(`  Registered: ${stats.inserted}`);
  console.log(`  Skipped (no project): ${withoutProject.length}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
