// scripts/zoho-import/phase-06-projects.ts
// Projects.xls → match existing ERP projects, write zoho_project_mapping
// Projects.xls headers: Project ID | Project Name | Project Code | Customer Name | Project Status | Project Cost
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { normalizeName, tokens, jaccard, extractKwp } from './normalize';
import * as fs from 'fs';
import * as path from 'path';

interface ZohoProjectRow {
  'Project ID': string | null;
  'Project Name': string | null;
  'Project Code': string | null;
  'Customer Name': string | null;
  'Project Status': string | null;
  'Project Cost': string | number | null;
  'Description': string | null;
}

interface ERPProject {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number | null;
  site_city: string | null;
  zoho_project_id: string | null;
}

function matchScore(
  zohoName: string,
  zohoCust: string,
  erpProject: ERPProject
): number {
  const zCombined = normalizeName(zohoName + ' ' + zohoCust);
  const eCombined = normalizeName(erpProject.customer_name);

  const zTok = tokens(zCombined);
  const eTok = tokens(eCombined);
  let score = jaccard(zTok, eTok);

  // Size bonus
  const zSize = extractKwp(zohoName);
  if (zSize && erpProject.system_size_kwp && Math.abs(zSize - erpProject.system_size_kwp) < 0.5) {
    score += 0.20;
  }

  // City bonus
  if (erpProject.site_city) {
    if (normalizeName(zohoName).includes(normalizeName(erpProject.site_city))) {
      score += 0.10;
    }
  }

  return Math.min(score, 1.0);
}

export async function runPhase06(): Promise<PhaseResult> {
  const result = emptyResult('06-projects');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const zohoRows = loadSheet<ZohoProjectRow>('Projects.xls');
  console.log(`  ${zohoRows.length} projects in Projects.xls`);

  // Load all ERP projects
  const { data: erpProjects, error: fetchErr } = await admin
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, site_city, zoho_project_id');
  if (fetchErr) {
    result.errors.push({ row: 0, reason: 'fetch ERP projects: ' + fetchErr.message });
    result.failed = zohoRows.length;
    return result;
  }

  const erpList: ERPProject[] = (erpProjects ?? []) as ERPProject[];

  const reviewQueue: Array<{
    zohoId: string;
    zohoName: string;
    zohoCust: string;
    topCandidates: Array<{ project: ERPProject; score: number }>;
  }> = [];
  const unmatchedQueue: Array<{ zohoId: string; zohoName: string; zohoCust: string }> = [];
  const mappingBatch: Array<{
    zoho_project_id: string;
    erp_project_id: string;
    zoho_project_name: string;
    zoho_project_code: string | null;
    zoho_customer_name: string | null;
    match_confidence: number;
    match_method: string;
  }> = [];

  for (let i = 0; i < zohoRows.length; i++) {
    const zRow = zohoRows[i];
    const zohoId = toStr(zRow['Project ID']);
    if (!zohoId) { result.skipped++; continue; }

    const zohoName = toStr(zRow['Project Name']) ?? '';
    const zohoCust = toStr(zRow['Customer Name']) ?? '';

    // Already mapped?
    const { data: existingMap } = await admin
      .from('zoho_project_mapping')
      .select('zoho_project_id')
      .eq('zoho_project_id', zohoId)
      .maybeSingle();
    if (existingMap) { result.skipped++; continue; }

    // Also check if ERP project already has this zoho_project_id
    const alreadyStamped = erpList.find(p => p.zoho_project_id === zohoId);
    if (alreadyStamped) { result.skipped++; continue; }

    // Score all ERP projects
    const scored = erpList
      .filter(p => !p.zoho_project_id) // don't match already-mapped projects
      .map(p => ({ project: p, score: matchScore(zohoName, zohoCust, p) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (!best || best.score < 0.5) {
      unmatchedQueue.push({ zohoId, zohoName, zohoCust });
      result.skipped++;
      continue;
    }

    if (best.score >= 0.85) {
      // Auto-match
      mappingBatch.push({
        zoho_project_id: zohoId,
        erp_project_id: best.project.id,
        zoho_project_name: zohoName,
        zoho_project_code: toStr(zRow['Project Code']),
        zoho_customer_name: zohoCust || null,
        match_confidence: parseFloat(best.score.toFixed(2)),
        match_method: 'auto_fuzzy',
      });
      // Mark matched so subsequent rows don't double-match this ERP project
      best.project.zoho_project_id = zohoId;
    } else {
      // Review queue (0.5-0.85)
      reviewQueue.push({
        zohoId,
        zohoName,
        zohoCust,
        topCandidates: scored.slice(0, 3),
      });
      result.skipped++;
    }
  }

  // Write review and unmatched CSVs
  const reviewPath = path.resolve(__dirname, '../../docs/zoho-review-queue.csv');
  const unmatchedPath = path.resolve(__dirname, '../../docs/zoho-unmatched-projects.csv');

  const reviewLines = [
    'zoho_project_id,zoho_project_name,zoho_customer,candidate_1_number,candidate_1_name,score_1,candidate_2_number,score_2,candidate_3_number,score_3',
    ...reviewQueue.map(r => {
      const c = r.topCandidates;
      return [
        r.zohoId, `"${r.zohoName}"`, `"${r.zohoCust}"`,
        c[0]?.project.project_number ?? '', `"${c[0]?.project.customer_name ?? ''}"`, (c[0]?.score ?? 0).toFixed(2),
        c[1]?.project.project_number ?? '', (c[1]?.score ?? 0).toFixed(2),
        c[2]?.project.project_number ?? '', (c[2]?.score ?? 0).toFixed(2),
      ].join(',');
    }),
  ];

  const unmatchedLines = [
    'zoho_project_id,zoho_project_name,zoho_customer',
    ...unmatchedQueue.map(r => `${r.zohoId},"${r.zohoName}","${r.zohoCust}"`),
  ];

  if (!dryRun) {
    fs.writeFileSync(reviewPath, reviewLines.join('\n'), 'utf8');
    fs.writeFileSync(unmatchedPath, unmatchedLines.join('\n'), 'utf8');
  }

  console.log(`  Auto-matched: ${mappingBatch.length}`);
  console.log(`  Review queue: ${reviewQueue.length} → docs/zoho-review-queue.csv`);
  console.log(`  Unmatched: ${unmatchedQueue.length} → docs/zoho-unmatched-projects.csv`);

  if (dryRun) {
    console.log(`  DRY RUN: would insert ${mappingBatch.length} project mappings`);
    result.skipped = zohoRows.length;
    return result;
  }

  // Insert auto-matched mappings
  if (mappingBatch.length > 0) {
    const { error } = await admin
      .from('zoho_project_mapping')
      .upsert(mappingBatch, { onConflict: 'zoho_project_id' });
    if (error) {
      result.errors.push({ row: 0, reason: 'insert mappings: ' + error.message });
      result.failed = mappingBatch.length;
    } else {
      result.inserted = mappingBatch.length;

      // Also stamp zoho_project_id on the ERP project rows
      for (const m of mappingBatch) {
        await admin
          .from('projects')
          .update({ zoho_project_id: m.zoho_project_id })
          .eq('id', m.erp_project_id)
          .is('zoho_project_id', null);
      }
    }
  }

  return result;
}
