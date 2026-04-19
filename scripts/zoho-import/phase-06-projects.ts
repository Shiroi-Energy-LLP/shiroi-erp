// scripts/zoho-import/phase-06-projects.ts
// Projects.xls → match existing ERP projects, write zoho_project_mapping, backfill projects.zoho_project_id
//
// Matching strategy (Apr 19 2026 — third iteration):
//
// The core problem: ERP's `customer_name` is often the SITE/PROJECT label (e.g. "Radiance Flourish",
// "Khurinji iris", "Jain Housing - Anarghya"), not the billing company name. Meanwhile Zoho splits
// that information: `Project Name` holds the site label, `Customer Name` holds the company.
// Project numbers like "SHIROI/PROJ/2025-26/0028" contain no useful tokens and dilute Jaccard.
//
// Strategy:
//   1. Use ERP `customer_name` ONLY as the match target (no project_number noise).
//   2. Compute three similarity scores between Zoho and ERP and take the max:
//        a. Token Jaccard of (zoho name + customer) vs erp.customer_name
//        b. Token Jaccard of just zoho.name vs erp.customer_name
//        c. Character-bigram Dice coefficient of zoho.name vs erp.customer_name
//      (c) catches spelling variants like "khurinjis" vs "khurinji", "anargaya" vs "anarghya".
//   3. Bonuses:
//        +0.20 when system_size_kwp matches ±0.5 kWp
//        +0.10 when ERP site_city appears in zoho name
//        +0.20 when |zoho_cost - erp_contracted_value| / max < 5% (or +0.10 if < 15%)
//        +0.15 when zoho Customer Name == erp.customer_name (normalized)
//   4. Accept the best match when EITHER:
//        - best.score >= 0.80, OR
//        - best.score >= 0.55 AND (best.score - second.score) >= 0.15  (clear winner)
//   5. Each ERP project can only match one Zoho project — greedy across Zoho projects sorted by best score desc.
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
  contracted_value: number | null;
  system_size_kwp: number | null;
  site_city: string | null;
  zoho_project_id: string | null;
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const x = s.replace(/\s+/g, ' ');
  for (let i = 0; i < x.length - 1; i++) {
    out.add(x.substring(i, i + 2));
  }
  return out;
}

function diceCoef(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function matchScore(
  zohoName: string,
  zohoCust: string,
  zohoCost: number,
  erpProject: ERPProject
): number {
  const zName = normalizeName(zohoName);
  const zCust = normalizeName(zohoCust);
  const zFull = normalizeName(zohoName + ' ' + zohoCust);
  const eName = normalizeName(erpProject.customer_name);

  if (!zName || !eName) return 0;

  const jacFull = jaccard(tokens(zFull), tokens(eName));
  const jacName = jaccard(tokens(zName), tokens(eName));
  const diceName = diceCoef(bigrams(zName), bigrams(eName));

  // Dice on its own can produce false positives when letters overlap by chance
  // (e.g. "geeyam nandini" vs "ramaniyam nagas" share enough bigrams to score 0.7).
  // Require at least some token overlap for Dice to contribute beyond what Jaccard gives.
  const hasTokenOverlap = jacFull > 0 || jacName > 0;
  const diceContrib = hasTokenOverlap ? diceName : 0;

  let score = Math.max(jacFull, jacName, diceContrib);

  const zSize = extractKwp(zohoName);
  if (zSize && erpProject.system_size_kwp && Math.abs(zSize - erpProject.system_size_kwp) < 0.5) {
    score += 0.20;
  }

  if (erpProject.site_city) {
    const city = normalizeName(erpProject.site_city);
    if (city.length >= 4 && zName.includes(city)) {
      score += 0.10;
    }
  }

  if (zohoCost > 1 && erpProject.contracted_value && erpProject.contracted_value > 1) {
    const max = Math.max(zohoCost, erpProject.contracted_value);
    const diff = Math.abs(zohoCost - erpProject.contracted_value) / max;
    if (diff < 0.05) score += 0.20;
    else if (diff < 0.15) score += 0.10;
  }

  if (zCust && eName) {
    if (zCust === eName) {
      score += 0.15;
    } else {
      const custJac = jaccard(tokens(zCust), tokens(eName));
      if (custJac >= 0.80) score += 0.10;
    }
  }

  return Math.min(score, 1.0);
}

export async function runPhase06(): Promise<PhaseResult> {
  const result = emptyResult('06-projects');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const zohoRows = loadSheet<ZohoProjectRow>('Projects.xls');
  console.log(`  ${zohoRows.length} projects in Projects.xls`);

  const { data: erpProjects, error: fetchErr } = await admin
    .from('projects')
    .select('id, project_number, customer_name, contracted_value, system_size_kwp, site_city, zoho_project_id');
  if (fetchErr) {
    result.errors.push({ row: 0, reason: 'fetch ERP projects: ' + fetchErr.message });
    result.failed = zohoRows.length;
    return result;
  }

  const erpList: ERPProject[] = (erpProjects ?? []).map(p => ({
    id: p.id,
    project_number: p.project_number,
    customer_name: p.customer_name,
    contracted_value: p.contracted_value == null ? null : Number(p.contracted_value),
    system_size_kwp: p.system_size_kwp == null ? null : Number(p.system_size_kwp),
    site_city: p.site_city,
    zoho_project_id: p.zoho_project_id,
  }));

  const { data: existingMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_id');
  const alreadyMappedIds = new Set(
    (existingMappings ?? []).map(m => m.zoho_project_id).filter((x): x is string => x != null)
  );

  const reviewQueue: Array<{
    zohoId: string;
    zohoName: string;
    zohoCust: string;
    topCandidates: Array<{ project: ERPProject; score: number }>;
  }> = [];
  const unmatchedQueue: Array<{ zohoId: string; zohoName: string; zohoCust: string; zohoCost: number }> = [];
  const mappingBatch: Array<{
    zoho_project_id: string;
    erp_project_id: string;
    zoho_project_name: string;
    zoho_project_code: string | null;
    zoho_customer_name: string | null;
    match_confidence: number;
    match_method: string;
  }> = [];

  type ZohoItem = { zohoId: string; zohoName: string; zohoCust: string; zohoCode: string | null; zohoCost: number };
  const zohoQueue: ZohoItem[] = zohoRows
    .map(r => ({
      zohoId: toStr(r['Project ID']),
      zohoName: toStr(r['Project Name']) ?? '',
      zohoCust: toStr(r['Customer Name']) ?? '',
      zohoCode: toStr(r['Project Code']),
      zohoCost: toNumber(r['Project Cost']),
    }))
    .filter((r): r is ZohoItem => !!r.zohoId);

  type Scored = ZohoItem & { scored: Array<{ project: ERPProject; score: number }> };
  const withScores: Scored[] = [];

  for (const z of zohoQueue) {
    if (alreadyMappedIds.has(z.zohoId)) { result.skipped++; continue; }
    if (erpList.some(p => p.zoho_project_id === z.zohoId)) { result.skipped++; continue; }

    const scored = erpList
      .map(p => ({ project: p, score: matchScore(z.zohoName, z.zohoCust, z.zohoCost, p) }))
      .sort((a, b) => b.score - a.score);

    withScores.push({ ...z, scored });
  }

  withScores.sort((a, b) => (b.scored[0]?.score ?? 0) - (a.scored[0]?.score ?? 0));

  for (const z of withScores) {
    const fresh = z.scored
      .filter(s => !s.project.zoho_project_id)
      .slice(0, 5);
    const best = fresh[0];
    const second = fresh[1];

    if (!best || best.score < 0.50) {
      unmatchedQueue.push({ zohoId: z.zohoId, zohoName: z.zohoName, zohoCust: z.zohoCust, zohoCost: z.zohoCost });
      result.skipped++;
      continue;
    }

    // Auto-accept when:
    //   - score >= 0.70 (robust match from multiple signals), OR
    //   - score >= 0.55 AND clearly ahead of second candidate by 0.15+, OR
    //   - Jaccard alone (not Dice) is >= 0.50 and clearly ahead by 0.10+ (token overlap is hard to fake)
    const jacName = jaccard(tokens(normalizeName(z.zohoName)), tokens(normalizeName(best.project.customer_name)));
    const jacFull = jaccard(tokens(normalizeName(z.zohoName + ' ' + z.zohoCust)), tokens(normalizeName(best.project.customer_name)));
    const jacBest = Math.max(jacName, jacFull);
    const secondScore = second?.score ?? 0;

    // When multiple ERP projects tie at the top, it's ambiguous even if the score is high
    // (e.g. "Ramaniyam Trinity" matches 3 different Ramaniyam sites equally well).
    // Require a minimum gap from the second-best for auto-accept.
    const highConfidence = best.score >= 0.70 && (best.score - secondScore) >= 0.05;
    const clearWinner = best.score >= 0.55 && (best.score - secondScore) >= 0.15;
    const strongJaccardWinner = jacBest >= 0.50 && (best.score - secondScore) >= 0.10;

    if (highConfidence || clearWinner || strongJaccardWinner) {
      mappingBatch.push({
        zoho_project_id: z.zohoId,
        erp_project_id: best.project.id,
        zoho_project_name: z.zohoName,
        zoho_project_code: z.zohoCode,
        zoho_customer_name: z.zohoCust || null,
        match_confidence: parseFloat(best.score.toFixed(2)),
        match_method: 'auto_fuzzy',
      });
      best.project.zoho_project_id = z.zohoId;
    } else {
      reviewQueue.push({
        zohoId: z.zohoId,
        zohoName: z.zohoName,
        zohoCust: z.zohoCust,
        topCandidates: fresh.slice(0, 3),
      });
      result.skipped++;
    }
  }

  const reviewPath = path.resolve(__dirname, '../../docs/zoho-review-queue.csv');
  const unmatchedPath = path.resolve(__dirname, '../../docs/zoho-unmatched-projects.csv');
  const matchedPath = path.resolve(__dirname, '../../docs/zoho-matched-projects.csv');

  const matchedLines = [
    'zoho_project_id,zoho_project_name,zoho_customer,erp_project_number,erp_customer_name,score',
    ...mappingBatch.map(m => {
      const erp = erpList.find(p => p.id === m.erp_project_id)!;
      return [
        m.zoho_project_id, `"${m.zoho_project_name.replace(/"/g, '""')}"`, `"${(m.zoho_customer_name ?? '').replace(/"/g, '""')}"`,
        erp.project_number, `"${erp.customer_name.replace(/"/g, '""')}"`,
        m.match_confidence.toFixed(2),
      ].join(',');
    }),
  ];
  fs.writeFileSync(matchedPath, matchedLines.join('\n'), 'utf8');

  const reviewLines = [
    'zoho_project_id,zoho_project_name,zoho_customer,candidate_1_number,candidate_1_name,score_1,candidate_2_number,candidate_2_name,score_2,candidate_3_number,candidate_3_name,score_3',
    ...reviewQueue.map(r => {
      const c = r.topCandidates;
      return [
        r.zohoId, `"${r.zohoName.replace(/"/g, '""')}"`, `"${r.zohoCust.replace(/"/g, '""')}"`,
        c[0]?.project.project_number ?? '', `"${(c[0]?.project.customer_name ?? '').replace(/"/g, '""')}"`, (c[0]?.score ?? 0).toFixed(2),
        c[1]?.project.project_number ?? '', `"${(c[1]?.project.customer_name ?? '').replace(/"/g, '""')}"`, (c[1]?.score ?? 0).toFixed(2),
        c[2]?.project.project_number ?? '', `"${(c[2]?.project.customer_name ?? '').replace(/"/g, '""')}"`, (c[2]?.score ?? 0).toFixed(2),
      ].join(',');
    }),
  ];

  const unmatchedLines = [
    'zoho_project_id,zoho_project_name,zoho_customer,zoho_cost',
    ...unmatchedQueue.map(r => `${r.zohoId},"${r.zohoName.replace(/"/g, '""')}","${r.zohoCust.replace(/"/g, '""')}",${r.zohoCost}`),
  ];

  fs.writeFileSync(reviewPath, reviewLines.join('\n'), 'utf8');
  fs.writeFileSync(unmatchedPath, unmatchedLines.join('\n'), 'utf8');

  console.log(`  Auto-matched: ${mappingBatch.length}`);
  console.log(`  Review queue: ${reviewQueue.length} → docs/zoho-review-queue.csv`);
  console.log(`  Unmatched: ${unmatchedQueue.length} → docs/zoho-unmatched-projects.csv`);

  if (dryRun) {
    console.log(`  DRY RUN: would insert ${mappingBatch.length} project mappings`);
    result.skipped = zohoRows.length;
    return result;
  }

  if (mappingBatch.length > 0) {
    const { error } = await admin
      .from('zoho_project_mapping')
      .upsert(mappingBatch, { onConflict: 'zoho_project_id' });
    if (error) {
      result.errors.push({ row: 0, reason: 'insert mappings: ' + error.message });
      result.failed = mappingBatch.length;
    } else {
      result.inserted = mappingBatch.length;

      for (const m of mappingBatch) {
        const { error: updateErr } = await admin
          .from('projects')
          .update({ zoho_project_id: m.zoho_project_id })
          .eq('id', m.erp_project_id)
          .is('zoho_project_id', null);
        if (updateErr) {
          result.errors.push({ row: 0, reason: `stamp zoho_project_id on ${m.erp_project_id}: ${updateErr.message}` });
        }
      }
    }
  }

  return result;
}
