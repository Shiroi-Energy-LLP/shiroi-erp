/**
 * Sync files from Google Drive confirmed project folders to Supabase Storage.
 *
 * Downloads all non-spreadsheet files from each confirmed project folder and
 * uploads them to the project-files bucket at {project_id}/{category}/{filename}.
 *
 * Categories:
 *   - photos: .jpg, .jpeg, .png, .heic, .webp
 *   - autocad: .dwg, .dxf, .skp, .layout
 *   - documents: .pdf, .docx, .doc, .pptx, .ppt, .xlsx, .xls
 *   - general: everything else (.mp4, .mov, .zip, etc.)
 *
 * Usage:
 *   npx tsx scripts/sync-gdrive-files-to-supabase.ts --dry-run
 *   npx tsx scripts/sync-gdrive-files-to-supabase.ts
 *   npx tsx scripts/sync-gdrive-files-to-supabase.ts --skip-existing   (skip if file already in Supabase)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Fuzzy matching (same as extract-bom-from-gdrive.ts) ───
function tokenize(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension', 'service', 'work'].includes(t));
}

// Generic tokens that shouldn't drive matches on their own
const GENERIC_TOKENS = new Set([
  'ramaniyam', 'lancor', 'jains', 'jians', 'spdpl', 'grn', 'dra', 'newry', 'rcc',
  'builder', 'builders', 'infra', 'construction', 'constructions', 'constrcution',
  'homes', 'home', 'apartment', 'apartments', 'villa', 'villas',
  'residency', 'residences', 'nagar', 'street', 'road', 'lane',
  'group', 'enterprises', 'industries', 'tech', 'systems', 'private',
  'green', 'land', 'lands', 'tower', 'towers', 'krishna', 'sri',
]);

function fuzzyMatch(name1: string, name2: string): { score: number; quality: 'exact' | 'strong' | 'weak' } {
  const t1 = tokenize(name1), t2 = tokenize(name2);
  if (!t1.length || !t2.length) return { score: 0, quality: 'weak' };
  let m = 0;
  let strongMatches = 0;
  for (const t of t1) {
    // Short tokens (<6 chars): require exact match to avoid "karan"→"prabakaran", "latha"→"swarnalatha"
    const isMatch = t.length < 6
      ? t2.some(x => x === t)
      : t2.some(x => x.includes(t) || t.includes(x));
    if (isMatch) {
      m++;
      if (!GENERIC_TOKENS.has(t) && t.length >= 4) strongMatches++;
    }
  }
  const score = m / Math.max(t1.length, t2.length);

  if (strongMatches >= 1) return { score, quality: 'strong' };
  if (m >= 2) return { score, quality: 'strong' };
  return { score, quality: 'weak' };
}

// ─── File categorization ───
const EXTENSION_CATEGORIES: Record<string, string> = {
  // Photos
  '.jpg': 'photos', '.jpeg': 'photos', '.png': 'photos',
  '.heic': 'photos', '.heif': 'photos', '.webp': 'photos',
  // CAD/Design
  '.dwg': 'autocad', '.dxf': 'autocad', '.skp': 'autocad', '.layout': 'autocad',
  // Documents
  '.pdf': 'documents', '.docx': 'documents', '.doc': 'documents',
  '.pptx': 'documents', '.ppt': 'documents',
  '.xlsx': 'documents', '.xls': 'documents',
  // Invoices (heuristic — will be refined by filename)
  // General (default for everything else)
  '.mp4': 'general', '.mov': 'general', '.zip': 'general',
  '.skb': 'general', '.bak': 'general',
};

function getCategory(fileName: string): string {
  const lower = fileName.toLowerCase();
  // Check filename hints first
  if (/invoice|inv\b/i.test(lower) && lower.endsWith('.pdf')) return 'invoice';
  if (/warranty|guarantee/i.test(lower) && lower.endsWith('.pdf')) return 'warranty';
  // Then by extension
  const ext = '.' + lower.split('.').pop();
  return EXTENSION_CATEGORIES[ext] || 'general';
}

// MIME type from extension
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.dwg': 'application/dwg', '.dxf': 'application/dxf',
  '.skp': 'application/vnd.sketchup.skp', '.layout': 'application/octet-stream',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.zip': 'application/octet-stream', '.skb': 'application/octet-stream',
  '.bak': 'application/octet-stream',
};

function getMimeType(fileName: string): string {
  const ext = '.' + fileName.toLowerCase().split('.').pop();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// Google Drive export MIME for Google Docs types
const GDRIVE_EXPORT_MIME: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: '.pdf' },
  // Spreadsheets are already extracted — skip them
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-()& ]/g, '_').replace(/\s+/g, '_');
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ─── Main ───
async function main() {
  const op = '[gdrive-file-sync]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${SKIP_EXISTING ? ' (skip existing)' : ''}`);

  // Auth
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // ═══ Step 1: Load DB projects ═══
  console.log(`${op} Loading DB projects...`);
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, proposal_id, status');

  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .is('deleted_at', null);

  const leadNameMap = new Map<string, string>();
  (leads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  type Target = { project_id: string; lead_id: string; customer_name: string };
  const targets: Target[] = [];
  for (const pr of (projects ?? [])) {
    if (pr.lead_id) {
      targets.push({
        project_id: pr.id,
        lead_id: pr.lead_id,
        customer_name: leadNameMap.get(pr.lead_id) || '',
      });
    }
  }
  console.log(`${op} ${targets.length} projects in DB`);

  // ═══ Step 2: Load existing files in Supabase Storage ═══
  console.log(`${op} Loading existing files in project-files bucket...`);
  const existingFiles = new Set<string>();
  if (SKIP_EXISTING) {
    // List all objects in project-files bucket to avoid re-uploading
    for (const target of targets) {
      for (const cat of ['general', 'autocad', 'photos', 'documents', 'warranty', 'invoice']) {
        const { data: files } = await supabase.storage
          .from('project-files')
          .list(`${target.project_id}/${cat}`, { limit: 500 });
        if (files) {
          for (const f of files) {
            if (f.name !== '.emptyFolderPlaceholder') {
              existingFiles.add(`${target.project_id}/${cat}/${f.name}`);
            }
          }
        }
      }
    }
    console.log(`${op} ${existingFiles.size} files already in Supabase`);
  }

  // ═══ Step 3: Scan Google Drive ═══
  console.log(`\n${op} Scanning confirmed project folders...`);
  const rootRes = await drive.files.list({
    q: `'1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id,name)',
  });
  const yearFolders = (rootRes.data.files || [])
    .filter(f => /confirmed/i.test(f.name || ''))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`${op} Year folders: ${yearFolders.map(f => f.name).join(', ')}`);

  const stats = {
    folders: 0, matched: 0, noMatch: 0,
    filesScanned: 0, filesUploaded: 0, filesSkipped: 0,
    filesExisting: 0, filesError: 0,
    bytesUploaded: 0, googleDocsExported: 0,
    skippedSpreadsheets: 0,
  };

  const matchLog: Array<{ folder: string; project: string; score: number; files: number }> = [];
  const errorLog: Array<{ folder: string; file: string; error: string }> = [];

  for (const yearFolder of yearFolders) {
    console.log(`\n${op} === ${yearFolder.name} ===`);

    const projRes = await drive.files.list({
      q: `'${yearFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name)',
      pageSize: 200,
    });
    const projectFolders = projRes.data.files || [];
    console.log(`${op} ${projectFolders.length} project folders`);

    for (const folder of projectFolders) {
      stats.folders++;
      const folderName = folder.name || '';

      // Match folder to DB project
      let bestTarget: Target | null = null;
      let bestScore = 0;
      let bestQuality: 'exact' | 'strong' | 'weak' = 'weak';
      for (const target of targets) {
        const { score, quality } = fuzzyMatch(folderName, target.customer_name);
        if (score > bestScore || (score === bestScore && quality === 'strong' && bestQuality === 'weak')) {
          bestScore = score;
          bestTarget = target;
          bestQuality = quality;
        }
      }

      // Thresholds:
      //   strong/exact quality: 0.4+ (distinctive name tokens match)
      //   weak quality: 0.6+ (only generic/builder tokens match — need high overlap)
      const meetsThreshold = bestQuality !== 'weak' ? bestScore >= 0.4 : bestScore >= 0.6;
      if (!bestTarget || !meetsThreshold) {
        if (DRY_RUN) console.log(`  NO MATCH: "${folderName}" (best: ${bestTarget?.customer_name} @ ${bestScore.toFixed(2)}, quality=${bestQuality})`);
        stats.noMatch++;
        continue;
      }

      stats.matched++;
      const projectId = bestTarget.project_id;
      console.log(`  [${stats.folders}] "${folderName}" → "${bestTarget.customer_name}" (${bestScore.toFixed(2)})`);

      // List ALL files in this folder (including subfolders)
      const allFiles = await listAllFiles(drive, folder.id!);

      let folderFileCount = 0;

      for (const file of allFiles) {
        stats.filesScanned++;
        const fileName = file.name || 'unknown';
        const mimeType = file.mimeType || '';

        // Skip Google Spreadsheets (already extracted as BOM + project details)
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
          stats.skippedSpreadsheets++;
          continue;
        }

        // Determine if this is a Google Doc type that needs exporting
        const exportInfo = GDRIVE_EXPORT_MIME[mimeType];
        const isGoogleDoc = !!exportInfo;

        // Determine output filename
        let outputName: string;
        if (isGoogleDoc) {
          outputName = sanitizeFileName(fileName) + exportInfo.ext;
        } else {
          outputName = sanitizeFileName(fileName);
        }

        // Determine category
        const category = getCategory(outputName);

        // Build storage path
        const storagePath = `${projectId}/${category}/${outputName}`;

        // Skip if already exists
        if (SKIP_EXISTING && existingFiles.has(storagePath)) {
          stats.filesExisting++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`  [DRY] ${folderName} → ${storagePath} (${formatSize(Number(file.size || 0))})`);
          folderFileCount++;
          continue;
        }

        // Download from Google Drive with retry
        const MAX_RETRIES = 3;
        let success = false;
        for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
          try {
            let buffer: Buffer;
            let uploadMime: string;

            if (isGoogleDoc) {
              const res = await drive.files.export(
                { fileId: file.id!, mimeType: exportInfo.mime },
                { responseType: 'stream' }
              );
              buffer = await streamToBuffer(res.data as any);
              uploadMime = exportInfo.mime;
              stats.googleDocsExported++;
            } else {
              const res = await drive.files.get(
                { fileId: file.id!, alt: 'media' },
                { responseType: 'stream' }
              );
              buffer = await streamToBuffer(res.data as any);
              uploadMime = getMimeType(fileName);
            }

            if (buffer.length === 0) {
              stats.filesSkipped++;
              success = true;
              break;
            }

            if (buffer.length > 104857600) {
              console.log(`  SKIP (>100MB): ${fileName} (${formatSize(buffer.length)})`);
              stats.filesSkipped++;
              success = true;
              break;
            }

            // Upload to Supabase Storage
            const { error } = await supabase.storage
              .from('project-files')
              .upload(storagePath, buffer, {
                contentType: uploadMime,
                upsert: false,
              });

            if (error) {
              if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) {
                stats.filesExisting++;
              } else if (error.message?.includes('maximum allowed size')) {
                console.log(`  SKIP (bucket limit): ${fileName}`);
                stats.filesSkipped++;
              } else {
                throw new Error(`Upload failed: ${error.message}`);
              }
            } else {
              stats.filesUploaded++;
              stats.bytesUploaded += buffer.length;
              folderFileCount++;
              // Progress log every 25 files
              if (stats.filesUploaded % 25 === 0) {
                console.log(`  [progress] ${stats.filesUploaded} uploaded, ${stats.filesError} errors, ${formatSize(stats.bytesUploaded)} total`);
              }
            }

            success = true;
            await sleep(50);  // Reduced delay
          } catch (err: any) {
            const msg = err.message || String(err);
            if (msg.includes('not found') || msg.includes('404')) {
              stats.filesSkipped++;
              success = true;
            } else if (attempt < MAX_RETRIES) {
              console.log(`  RETRY ${attempt}/${MAX_RETRIES}: ${fileName} (${msg.slice(0, 80)})`);
              await sleep(2000 * attempt);  // Exponential backoff
            } else {
              console.error(`  ERROR (${MAX_RETRIES} retries): ${fileName}: ${msg.slice(0, 120)}`);
              errorLog.push({ folder: folderName, file: fileName, error: msg });
              stats.filesError++;
            }
          }
        }
      }

      if (DRY_RUN || folderFileCount > 0) {
        matchLog.push({
          folder: folderName,
          project: bestTarget.customer_name,
          score: bestScore,
          files: folderFileCount,
        });
        if (DRY_RUN && bestScore < 0.7) {
          console.log(`  ⚠ LOW SCORE: "${folderName}" → "${bestTarget.customer_name}" (${bestScore.toFixed(2)})`);
        }
      }
    }
  }

  // ═══ Summary ═══
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${op} SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Folders scanned:     ${stats.folders}`);
  console.log(`Matched to project:  ${stats.matched}`);
  console.log(`No match:            ${stats.noMatch}`);
  console.log(`Files scanned:       ${stats.filesScanned}`);
  console.log(`Spreadsheets skipped:${stats.skippedSpreadsheets}`);
  console.log(`Files uploaded:      ${stats.filesUploaded}`);
  console.log(`Already existing:    ${stats.filesExisting}`);
  console.log(`Files skipped:       ${stats.filesSkipped}`);
  console.log(`Errors:              ${stats.filesError}`);
  console.log(`Google Docs exported:${stats.googleDocsExported}`);
  console.log(`Total uploaded:      ${formatSize(stats.bytesUploaded)}`);

  if (matchLog.length > 0) {
    console.log(`\n--- Match Log (${matchLog.length}) ---`);
    for (const m of matchLog) {
      console.log(`  "${m.folder}" → "${m.project}" (${m.score.toFixed(2)}) — ${m.files} files`);
    }
  }

  if (errorLog.length > 0) {
    console.log(`\n--- Errors (${errorLog.length}) ---`);
    for (const e of errorLog) {
      console.log(`  ${e.folder}/${e.file}: ${e.error}`);
    }
  }
}

// Recursively list all files in a folder (including subfolders)
async function listAllFiles(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string; size: string }>> {
  const results: Array<{ id: string; name: string; mimeType: string; size: string }> = [];

  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,size)',
      pageSize: 100,
      pageToken,
    });

    const files = res.data.files || [];
    for (const f of files) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        // Recurse into subfolders
        const subFiles = await listAllFiles(drive, f.id!);
        results.push(...subFiles);
      } else {
        results.push({
          id: f.id!,
          name: f.name || 'unknown',
          mimeType: f.mimeType || '',
          size: f.size || '0',
        });
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return results;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

main().catch(console.error);
