/**
 * Fix project-files storage paths.
 *
 * Old path: projects/{project_id}/{category}/{filename}
 * New path: {project_id}/{category}/{filename}
 *
 * The ERP UI expects files at {project_id}/{category}/{filename}.
 * Files at the old "projects/" prefix are invisible to the ERP.
 *
 * This script moves (copy + delete) all old-path files to the correct path.
 *
 * Usage:
 *   npx tsx scripts/fix-project-files-path.ts --dry-run
 *   npx tsx scripts/fix-project-files-path.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const DRY_RUN = process.argv.includes('--dry-run');
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const op = '[fix-paths]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // Get all files under projects/ prefix using SQL (most efficient)
  const { data: files, error } = await supabase.rpc('get_storage_objects_by_prefix', {
    p_bucket: 'project-files',
    p_prefix: 'projects/',
  });

  // Fallback: direct SQL if RPC doesn't exist
  let fileList: Array<{ name: string; size: number; mimetype: string }> = [];

  if (error) {
    // Use admin query instead
    console.log(`${op} Using direct query...`);
    const { data, error: sqlErr } = await supabase
      .from('storage_objects_view')
      .select('name, metadata')
      .eq('bucket_id', 'project-files')
      .like('name', 'projects/%')
      .limit(2000);

    if (sqlErr) {
      // Last resort: list folders manually
      console.log(`${op} Listing storage folders manually...`);
      const { data: topFolders } = await supabase.storage
        .from('project-files')
        .list('projects', { limit: 500 });

      for (const folder of (topFolders ?? [])) {
        if (folder.name === '.emptyFolderPlaceholder') continue;
        // Each folder is a project_id
        const categories = ['documents', 'photos', 'layouts', 'purchase-orders', 'general', 'autocad', 'warranty', 'invoice'];
        for (const cat of categories) {
          const { data: catFiles } = await supabase.storage
            .from('project-files')
            .list(`projects/${folder.name}/${cat}`, { limit: 500 });

          for (const f of (catFiles ?? [])) {
            if (f.name === '.emptyFolderPlaceholder') continue;
            fileList.push({
              name: `projects/${folder.name}/${cat}/${f.name}`,
              size: f.metadata?.size || 0,
              mimetype: f.metadata?.mimetype || 'application/octet-stream',
            });
          }
        }
      }
    }
  }

  console.log(`${op} Found ${fileList.length} files under projects/ prefix`);

  // Map old categories to new categories
  const CATEGORY_MAP: Record<string, string> = {
    'documents': 'documents',
    'photos': 'photos',
    'layouts': 'autocad',
    'purchase-orders': 'documents',
    'general': 'general',
    'autocad': 'autocad',
    'warranty': 'warranty',
    'invoice': 'invoice',
  };

  const stats = {
    total: fileList.length,
    moved: 0,
    skipped: 0,
    alreadyExists: 0,
    errors: 0,
  };

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const parts = file.name.split('/');
    // projects/{project_id}/{category}/{filename}
    if (parts.length < 4) {
      console.log(`  SKIP (bad path): ${file.name}`);
      stats.skipped++;
      continue;
    }

    const projectId = parts[1];
    const oldCategory = parts[2];
    const fileName = parts.slice(3).join('/');
    const newCategory = CATEGORY_MAP[oldCategory] || 'general';
    const newPath = `${projectId}/${newCategory}/${fileName}`;

    if (DRY_RUN) {
      console.log(`  [DRY] ${file.name} → ${newPath}`);
      stats.moved++;
      continue;
    }

    // Download old file
    const { data: blob, error: dlErr } = await supabase.storage
      .from('project-files')
      .download(file.name);

    if (dlErr || !blob) {
      console.error(`  ERROR downloading ${file.name}: ${dlErr?.message}`);
      stats.errors++;
      continue;
    }

    // Upload to new path
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from('project-files')
      .upload(newPath, buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (upErr) {
      if (upErr.message?.includes('already exists') || upErr.message?.includes('Duplicate')) {
        stats.alreadyExists++;
        // Still delete the old one since the new one exists
      } else {
        console.error(`  ERROR uploading ${newPath}: ${upErr.message}`);
        stats.errors++;
        continue; // Don't delete old if upload failed
      }
    } else {
      stats.moved++;
    }

    // Delete old file
    const { error: delErr } = await supabase.storage
      .from('project-files')
      .remove([file.name]);

    if (delErr) {
      console.error(`  ERROR deleting old ${file.name}: ${delErr.message}`);
    }

    // Progress
    if ((stats.moved + stats.alreadyExists) % 50 === 0) {
      console.log(`  [progress] ${stats.moved + stats.alreadyExists}/${stats.total} processed (${stats.errors} errors)`);
    }

    await sleep(50);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`${op} SUMMARY`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`Total files:       ${stats.total}`);
  console.log(`Moved:             ${stats.moved}`);
  console.log(`Already existed:   ${stats.alreadyExists}`);
  console.log(`Skipped:           ${stats.skipped}`);
  console.log(`Errors:            ${stats.errors}`);
}

main().catch(console.error);
