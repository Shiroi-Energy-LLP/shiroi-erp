// scripts/whatsapp-import/run.ts
// CLI: npx tsx run.ts --chat <profile> --zip "<path>"

import 'dotenv/config';
import AdmZip from 'adm-zip';
import * as path from 'node:path';
import { parseChat } from './parser.js';
import { extractClusters } from './extractor.js';
import { routeResults } from './router.js';
import { loadExistingHashes, isAlreadyImported, hashMessage } from './dedup.js';
import { getAllProjects, getAllLeads } from './db.js';
import type { ChatProfile } from './types.js';

const VALID_PROFILES: ChatProfile[] = ['marketing', 'llp', 'shiroi_energy', 'site'];

function parseArgs(): { chat: ChatProfile; zip: string } {
  const args = process.argv.slice(2);
  const chatIdx = args.indexOf('--chat');
  const zipIdx = args.indexOf('--zip');

  if (chatIdx === -1 || zipIdx === -1) {
    console.error('Usage: npx tsx run.ts --chat <marketing|llp|shiroi_energy|site> --zip "<path-to-zip>"');
    process.exit(1);
  }

  const chat = args[chatIdx + 1] as ChatProfile;
  const zipPath = args[zipIdx + 1] ?? '';

  if (!VALID_PROFILES.includes(chat)) {
    console.error(`Invalid chat profile: "${chat}". Must be one of: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
  }

  if (!zipPath) {
    console.error('--zip path is required');
    process.exit(1);
  }

  return { chat, zip: zipPath };
}

async function main() {
  const op = '[WhatsApp Import]';
  const { chat, zip: zipPath } = parseArgs();

  console.log(`${op} Starting import`);
  console.log(`${op}   Profile: ${chat}`);
  console.log(`${op}   ZIP: ${path.basename(zipPath)}`);
  console.log(`${op}   Time: ${new Date().toISOString()}`);

  // Validate environment
  if (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_SECRET_KEY']) {
    console.error(`${op} Missing SUPABASE_URL or SUPABASE_SECRET_KEY`);
    process.exit(1);
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error(`${op} Missing ANTHROPIC_API_KEY`);
    process.exit(1);
  }

  // Open ZIP
  let zipFile: AdmZip;
  try {
    zipFile = new AdmZip(zipPath);
  } catch (err) {
    console.error(`${op} Failed to open ZIP: ${zipPath}`, err);
    process.exit(1);
  }

  // Verify ZIP has _chat.txt
  const allEntries = zipFile.getEntries();
  const txtEntry = allEntries.find(e => e.name === '_chat.txt');
  if (!txtEntry) {
    console.error(`${op} No _chat.txt found in ZIP. Make sure this is a WhatsApp export (Export Chat → Include Media).`);
    process.exit(1);
  }

  const imageEntries = allEntries.filter(e =>
    /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(e.name)
  );
  const videoEntries = allEntries.filter(e =>
    /\.(mp4|3gp|mov|avi)$/i.test(e.name)
  );
  const pdfEntries = allEntries.filter(e => /\.pdf$/i.test(e.name));

  console.log(`${op} ZIP contents: ${allEntries.length} total files`);
  console.log(`${op}   Images: ${imageEntries.length}`);
  console.log(`${op}   Videos: ${videoEntries.length} (skipped)`);
  console.log(`${op}   PDFs: ${pdfEntries.length}`);

  // Parse chat text
  const chatText = txtEntry.getData().toString('utf8');
  console.log(`${op} Chat text: ${chatText.length.toLocaleString()} characters`);

  const clusters = parseChat(chatText, chat);
  console.log(`${op} Parsed ${clusters.length.toLocaleString()} message clusters`);

  // Load existing hashes for dedup
  await loadExistingHashes();

  // Filter clusters not yet imported
  const newClusters = clusters.filter(c => {
    const firstMsg = c.messages[0];
    if (!firstMsg) return false;
    const hash = hashMessage(firstMsg) + '_check';
    return !isAlreadyImported(hash);
  });

  const skippedCount = clusters.length - newClusters.length;
  if (skippedCount > 0) {
    console.log(`${op} Skipping ${skippedCount} already-imported clusters`);
  }
  console.log(`${op} Processing ${newClusters.length} new clusters`);

  if (newClusters.length === 0) {
    console.log(`${op} Nothing new to import. Done.`);
    return;
  }

  // Load projects and leads for fuzzy matching
  const [projects, leads] = await Promise.all([getAllProjects(), getAllLeads()]);
  console.log(`${op} Loaded ${projects.length} projects + ${leads.length} leads for matching`);

  // Extract via Claude API (batched)
  console.log(`${op} Starting Claude extraction...`);
  const results = await extractClusters(newClusters, projects, leads, chat);

  // Route extracted records to Supabase
  console.log(`${op} Writing to database...`);
  await routeResults(results, newClusters);

  console.log(`${op} Import complete.`);
  console.log(`${op} Visit /whatsapp-import in the ERP to review pending records.`);
}

main().catch(err => {
  console.error('[WhatsApp Import] Fatal error:', err);
  process.exit(1);
});
