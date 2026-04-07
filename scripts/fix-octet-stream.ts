/**
 * Phase 2.1: Fix octet-stream mime types in Supabase Storage
 *
 * 705 files in proposal-files bucket have mime_type = 'application/octet-stream'
 * because they were uploaded without proper content-type headers.
 * Real types: .skp (306), .layout (142), .pptx (112), .mp4/.mov (83), other (62)
 *
 * This script:
 *   1. Queries storage.objects for octet-stream files
 *   2. Infers correct mime type from file extension
 *   3. Updates metadata.mimetype via Supabase Storage API
 *   4. Logs results
 *
 * Usage:
 *   npx tsx scripts/fix-octet-stream.ts --dry-run
 *   npx tsx scripts/fix-octet-stream.ts
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

// ─── Extension → MIME type mapping ───

const EXT_TO_MIME: Record<string, string> = {
  // 3D / CAD
  '.skp': 'application/vnd.sketchup.skp',
  '.layout': 'application/vnd.sketchup.layout',
  '.skb': 'application/vnd.sketchup.skp', // SketchUp backup
  '.dwg': 'application/acad',

  // Office
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',

  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',

  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',

  // Archives
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',

  // PDF
  '.pdf': 'application/pdf',

  // Other
  '.bak': 'application/x-backup',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot).toLowerCase();
}

async function main() {
  const op = '[fix-octet-stream]';
  const dry = isDryRun();

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Scan all folders in proposal-files for octet-stream files ═══
  const buckets = ['proposal-files', 'project-files'];
  const octetFiles: { bucket: string; path: string; ext: string; correctMime: string }[] = [];

  for (const bucket of buckets) {
    console.log(`\n${op} Scanning bucket: ${bucket}...`);

    const { data: folders } = await supabase.storage.from(bucket).list('', { limit: 2000 });
    if (!folders) continue;

    // Folders have id=null
    const uuidFolders = folders.filter((f) => !f.id);
    let scanned = 0;

    for (const folder of uuidFolders) {
      const { data: files } = await supabase.storage.from(bucket).list(folder.name, { limit: 500 });
      if (!files) continue;

      for (const f of files) {
        const meta = f.metadata as Record<string, any> | null;
        const mime = meta?.mimetype || '';

        if (mime === 'application/octet-stream') {
          const ext = getExtension(f.name);
          const correctMime = EXT_TO_MIME[ext];

          if (correctMime) {
            octetFiles.push({
              bucket,
              path: `${folder.name}/${f.name}`,
              ext,
              correctMime,
            });
          } else {
            console.log(`  ${op} Unknown extension: ${f.name} (ext: ${ext})`);
          }
        }
      }

      scanned++;
      if (scanned % 100 === 0) {
        process.stdout.write(`\r${op} Scanned ${scanned}/${uuidFolders.length} folders, found ${octetFiles.length} octet-stream files...`);
      }
    }
    console.log(`\n${op} ${octetFiles.length} octet-stream files found so far`);
  }

  // ═══ Summary by extension ═══
  const extCounts = new Map<string, number>();
  for (const f of octetFiles) {
    extCounts.set(f.ext, (extCounts.get(f.ext) ?? 0) + 1);
  }
  console.log(`\n${op} Breakdown by extension:`);
  for (const [ext, count] of [...extCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ext.padEnd(10)} → ${count} files → ${EXT_TO_MIME[ext]}`);
  }

  logMigrationStart('fix-octet-stream', octetFiles.length);

  let stats = { fixed: 0, errors: 0, skipped: 0 };

  // ═══ Fix mime types ═══
  // Supabase Storage API doesn't have a direct "update metadata" endpoint.
  // We need to use copy-with-new-metadata or update via storage.objects SQL.
  // The most reliable approach: use the admin client to update storage.objects directly.

  const BATCH_SIZE = 20;

  for (let i = 0; i < octetFiles.length; i += BATCH_SIZE) {
    const batch = octetFiles.slice(i, i + BATCH_SIZE);

    for (const file of batch) {
      if (dry) {
        console.log(`  ${file.path.substring(0, 70).padEnd(72)} ${file.ext} → ${file.correctMime.substring(0, 40)}`);
        stats.fixed++;
        continue;
      }

      // Update via SQL — storage.objects metadata is JSONB
      const { error } = await supabase.rpc('update_storage_mime_type' as any, {
        p_bucket: file.bucket,
        p_path: file.path,
        p_mime: file.correctMime,
      });

      if (error) {
        // Fallback: try direct SQL via admin
        // Note: This requires a DB function, which we'll create if needed
        console.error(`  ${op} Failed: ${file.path} — ${error.message}`);
        stats.errors++;
      } else {
        stats.fixed++;
      }
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      console.log(`${op} Progress: ${i}/${octetFiles.length} (fixed: ${stats.fixed})`);
    }
  }

  logMigrationEnd('fix-octet-stream', {
    processed: octetFiles.length,
    inserted: stats.fixed,
    skipped: stats.skipped,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[fix-octet-stream] Fatal error:', err);
  process.exit(1);
});
