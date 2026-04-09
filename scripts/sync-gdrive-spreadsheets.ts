/**
 * Export Google Sheets from confirmed project folders as .xlsx and upload
 * to Supabase project-files bucket.
 *
 * The main sync script skipped spreadsheets (already extracted BOM/details).
 * This script exports them as Excel files so they're accessible from the
 * project page.
 *
 * Usage:
 *   npx tsx scripts/sync-gdrive-spreadsheets.ts --dry-run
 *   npx tsx scripts/sync-gdrive-spreadsheets.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

const SERVICE_ACCOUNT_KEY_PATH = 'C:\\Users\\vivek\\Downloads\\shiroi-migration-key.json';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const DRY_RUN = process.argv.includes('--dry-run');

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Fuzzy matching (same as sync-gdrive-files-to-supabase.ts) ───
function tokenize(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'the', 'and', 'pvt', 'ltd', 'llp',
      'block', 'phase', 'kwp', 'solar', 'energy', 'power', 'site', 'project',
      'new', 'old', 'rework', 'extension', 'service', 'work'].includes(t));
}

const GENERIC_TOKENS = new Set([
  'ramaniyam', 'lancor', 'jains', 'jians', 'spdpl', 'grn', 'dra', 'newry', 'rcc',
  'builder', 'builders', 'infra', 'construction', 'constructions', 'constrcution',
  'homes', 'home', 'apartment', 'apartments', 'villa', 'villas',
  'residency', 'residences', 'nagar', 'street', 'road', 'lane',
  'group', 'enterprises', 'industries', 'tech', 'systems', 'private',
  'green', 'land', 'lands', 'tower', 'towers', 'krishna', 'sri',
]);

function fuzzyMatch(name1: string, name2: string): { score: number; quality: 'strong' | 'weak' } {
  const t1 = tokenize(name1), t2 = tokenize(name2);
  if (!t1.length || !t2.length) return { score: 0, quality: 'weak' };
  let m = 0, strongMatches = 0;
  for (const t of t1) {
    const isMatch = t.length < 6
      ? t2.some(x => x === t)
      : t2.some(x => x.includes(t) || t.includes(x));
    if (isMatch) {
      m++;
      if (!GENERIC_TOKENS.has(t) && t.length >= 4) strongMatches++;
    }
  }
  const score = m / Math.max(t1.length, t2.length);
  if (strongMatches >= 1 || m >= 2) return { score, quality: 'strong' };
  return { score, quality: 'weak' };
}

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

async function main() {
  const op = '[gdrive-spreadsheet-sync]';
  console.log(`${op} Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Load DB projects
  console.log(`${op} Loading DB projects...`);
  const { data: projects } = await supabase.from('projects').select('id, lead_id');
  const { data: leads } = await supabase.from('leads').select('id, customer_name').is('deleted_at', null);

  const leadNameMap = new Map<string, string>();
  (leads ?? []).forEach(l => leadNameMap.set(l.id, l.customer_name));

  type Target = { project_id: string; lead_id: string; customer_name: string };
  const targets: Target[] = [];
  for (const pr of (projects ?? [])) {
    if (pr.lead_id) {
      targets.push({ project_id: pr.id, lead_id: pr.lead_id, customer_name: leadNameMap.get(pr.lead_id) || '' });
    }
  }
  console.log(`${op} ${targets.length} projects in DB`);

  // Scan Google Drive
  const rootRes = await drive.files.list({
    q: `'1s_58esQ1Xt-ca88cksFlJRlh3pu28V6D' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id,name)',
  });
  const yearFolders = (rootRes.data.files || [])
    .filter(f => /confirmed/i.test(f.name || ''))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`${op} Year folders: ${yearFolders.map(f => f.name).join(', ')}`);

  const stats = { folders: 0, matched: 0, noMatch: 0, exported: 0, existing: 0, errors: 0, bytes: 0 };

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
      let bestQuality: 'strong' | 'weak' = 'weak';
      for (const target of targets) {
        const { score, quality } = fuzzyMatch(folderName, target.customer_name);
        if (score > bestScore || (score === bestScore && quality === 'strong' && bestQuality === 'weak')) {
          bestScore = score;
          bestTarget = target;
          bestQuality = quality;
        }
      }

      const meetsThreshold = bestQuality !== 'weak' ? bestScore >= 0.4 : bestScore >= 0.6;
      if (!bestTarget || !meetsThreshold) {
        stats.noMatch++;
        continue;
      }

      stats.matched++;
      const projectId = bestTarget.project_id;

      // Find Google Spreadsheets in this folder (not recursive — costing sheet is always top-level)
      const sheetRes = await drive.files.list({
        q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
        fields: 'files(id,name)',
      });
      const sheets = sheetRes.data.files || [];

      for (const sheet of sheets) {
        const sheetName = sheet.name || 'Costing_Sheet';
        const outputName = sanitizeFileName(sheetName) + '.xlsx';
        const storagePath = `${projectId}/documents/${outputName}`;

        if (DRY_RUN) {
          console.log(`  [DRY] "${folderName}" → ${storagePath}`);
          stats.exported++;
          continue;
        }

        // Export as xlsx
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const res = await drive.files.export(
              { fileId: sheet.id!, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
              { responseType: 'stream' }
            );
            const buffer = await streamToBuffer(res.data as any);

            if (buffer.length === 0) break;
            if (buffer.length > 104857600) {
              console.log(`  SKIP (>100MB): ${sheetName}`);
              break;
            }

            const { error } = await supabase.storage
              .from('project-files')
              .upload(storagePath, buffer, {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                upsert: false,
              });

            if (error) {
              if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) {
                stats.existing++;
              } else {
                throw new Error(error.message);
              }
            } else {
              stats.exported++;
              stats.bytes += buffer.length;
              if (stats.exported % 25 === 0) {
                console.log(`  [progress] ${stats.exported} exported`);
              }
            }
            break;
          } catch (err: any) {
            if (attempt < MAX_RETRIES) {
              console.log(`  RETRY ${attempt}: ${sheetName} (${(err.message || '').slice(0, 80)})`);
              await sleep(2000 * attempt);
            } else {
              console.error(`  ERROR: ${sheetName}: ${(err.message || '').slice(0, 120)}`);
              stats.errors++;
            }
          }
        }
        await sleep(100);
      }
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${op} SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Folders scanned:   ${stats.folders}`);
  console.log(`Matched:           ${stats.matched}`);
  console.log(`No match:          ${stats.noMatch}`);
  console.log(`Sheets exported:   ${stats.exported}`);
  console.log(`Already existing:  ${stats.existing}`);
  console.log(`Errors:            ${stats.errors}`);
  console.log(`Total size:        ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(console.error);
