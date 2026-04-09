/**
 * Audit project-files bucket in Supabase Storage.
 *
 * Checks:
 *   1. Files in folders that don't correspond to any project_id
 *   2. Empty folders
 *   3. Summary of files per project
 *
 * With --delete-orphans: removes files whose folder UUID doesn't match any project.
 *
 * Usage:
 *   npx tsx scripts/audit-project-files.ts
 *   npx tsx scripts/audit-project-files.ts --delete-orphans
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const DELETE_ORPHANS = process.argv.includes('--delete-orphans');

async function main() {
  const op = '[audit-project-files]';
  console.log(`${op} Mode: ${DELETE_ORPHANS ? 'DELETE ORPHANS' : 'AUDIT ONLY'}`);

  // Get all project IDs
  const { data: projects } = await supabase
    .from('projects')
    .select('id, lead_id, status');

  const projectIds = new Set((projects ?? []).map(p => p.id));
  console.log(`${op} ${projectIds.size} projects in DB`);

  // Get all lead IDs (for checking proposal-files too)
  const { data: leads } = await supabase
    .from('leads')
    .select('id')
    .is('deleted_at', null);
  const leadIds = new Set((leads ?? []).map(l => l.id));

  // ═══ Audit project-files bucket ═══
  console.log(`\n${op} Scanning project-files bucket...`);

  // List top-level folders (should be project UUIDs)
  const { data: topFolders } = await supabase.storage
    .from('project-files')
    .list('', { limit: 1000 });

  const stats = {
    totalFolders: 0,
    validFolders: 0,
    orphanFolders: 0,
    totalFiles: 0,
    orphanFiles: 0,
    deletedFiles: 0,
    errors: 0,
    projectFileCount: new Map<string, number>(),
  };

  const orphanFolders: string[] = [];
  const categories = ['general', 'autocad', 'photos', 'documents', 'warranty', 'invoice'];

  for (const folder of (topFolders ?? [])) {
    if (folder.name === '.emptyFolderPlaceholder') continue;
    stats.totalFolders++;

    const isProject = projectIds.has(folder.name);

    if (!isProject) {
      // Check if it's a lead UUID (might be from older upload pattern)
      const isLead = leadIds.has(folder.name);
      if (!isLead) {
        orphanFolders.push(folder.name);
        stats.orphanFolders++;

        // Count files in orphan folder
        for (const cat of categories) {
          const { data: files } = await supabase.storage
            .from('project-files')
            .list(`${folder.name}/${cat}`, { limit: 500 });

          const realFiles = (files ?? []).filter(f => f.name !== '.emptyFolderPlaceholder');
          stats.orphanFiles += realFiles.length;

          if (DELETE_ORPHANS && realFiles.length > 0) {
            const paths = realFiles.map(f => `${folder.name}/${cat}/${f.name}`);
            const { error } = await supabase.storage.from('project-files').remove(paths);
            if (error) {
              console.error(`  ERROR deleting ${paths.length} files in ${folder.name}/${cat}: ${error.message}`);
              stats.errors++;
            } else {
              stats.deletedFiles += paths.length;
            }
          }
        }
        continue;
      }
    }

    stats.validFolders++;

    // Count files in valid project folder
    let projectTotal = 0;
    for (const cat of categories) {
      const { data: files } = await supabase.storage
        .from('project-files')
        .list(`${folder.name}/${cat}`, { limit: 500 });

      const realFiles = (files ?? []).filter(f => f.name !== '.emptyFolderPlaceholder');
      projectTotal += realFiles.length;
      stats.totalFiles += realFiles.length;
    }

    if (projectTotal > 0) {
      stats.projectFileCount.set(folder.name, projectTotal);
    }
  }

  // ═══ Summary ═══
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${op} AUDIT SUMMARY — project-files bucket`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Top-level folders:     ${stats.totalFolders}`);
  console.log(`Valid (project UUID):  ${stats.validFolders}`);
  console.log(`Orphan folders:        ${stats.orphanFolders}`);
  console.log(`Total files (valid):   ${stats.totalFiles}`);
  console.log(`Orphan files:          ${stats.orphanFiles}`);
  if (DELETE_ORPHANS) {
    console.log(`Files deleted:         ${stats.deletedFiles}`);
  }
  console.log(`Errors:                ${stats.errors}`);

  // Distribution
  const fileCounts = Array.from(stats.projectFileCount.values()).sort((a, b) => b - a);
  console.log(`\nProjects with files:   ${fileCounts.length}`);
  if (fileCounts.length > 0) {
    console.log(`  Max files/project:   ${fileCounts[0]}`);
    console.log(`  Median:              ${fileCounts[Math.floor(fileCounts.length / 2)]}`);
    console.log(`  Total files:         ${fileCounts.reduce((a, b) => a + b, 0)}`);
  }

  if (orphanFolders.length > 0) {
    console.log(`\n--- Orphan Folders (${orphanFolders.length}) ---`);
    for (const f of orphanFolders) {
      console.log(`  ${f}`);
    }
    if (!DELETE_ORPHANS) {
      console.log(`\nRun with --delete-orphans to remove orphan files.`);
    }
  }

  // Top 10 projects by file count
  const sorted = Array.from(stats.projectFileCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (sorted.length > 0) {
    console.log(`\n--- Top 10 Projects by File Count ---`);
    for (const [pid, count] of sorted) {
      console.log(`  ${pid}: ${count} files`);
    }
  }
}

main().catch(console.error);
