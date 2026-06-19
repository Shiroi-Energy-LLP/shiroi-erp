/**
 * O&M plant-monitoring GAP exporter.
 *
 * The O&M "plant monitoring details" page lists rows in plant_monitoring_credentials
 * (~34 today). But ~208 plants have a portal login sitting in pending_project_imports
 * that were never promoted into that table — so they don't show in O&M. This script
 * lists every plant with a login that ISN'T yet in plant_monitoring_credentials, split
 * into two actions for Manivel:
 *   - LINK-or-CREATE : no ERP project matched → Manivel must link to an existing
 *                       project or create a new one before it can be promoted.
 *   - CONFIRM-match  : a tentative project match exists → verify, then promote.
 *
 * No passwords are emitted (plaintext usernames + project names only). Re-run anytime
 * as projects get linked to see what's left.
 *
 *   pnpm tsx scripts/export-om-monitoring-gap.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  const { data: imports, error: e1 } = await sb
    .from('pending_project_imports')
    .select('project_name, portal_brand, portal_username, matched_project_id, match_confidence')
    .not('portal_username', 'is', null)
    .neq('portal_username', '');
  if (e1) throw new Error(e1.message);

  const { data: promoted, error: e2 } = await sb
    .from('plant_monitoring_credentials')
    .select('project_id')
    .is('deleted_at', null);
  if (e2) throw new Error(e2.message);
  const promotedSet = new Set((promoted ?? []).map((r) => r.project_id as string));

  const matchedIds = [
    ...new Set((imports ?? []).map((r) => r.matched_project_id).filter(Boolean) as string[]),
  ];
  const projById = new Map<string, { customer_name: string | null; project_number: string | null }>();
  for (let i = 0; i < matchedIds.length; i += 200) {
    const { data: projs } = await sb
      .from('projects')
      .select('id, customer_name, project_number')
      .in('id', matchedIds.slice(i, i + 200));
    for (const p of projs ?? []) projById.set(p.id as string, { customer_name: p.customer_name, project_number: p.project_number });
  }

  const gap = (imports ?? []).filter((r) => !r.matched_project_id || !promotedSet.has(r.matched_project_id as string));
  gap.sort((a, b) => {
    const am = a.matched_project_id ? 1 : 0;
    const bm = b.matched_project_id ? 1 : 0;
    if (am !== bm) return am - bm; // LINK-or-CREATE (no match) first
    return (
      (a.portal_brand ?? '').localeCompare(b.portal_brand ?? '') ||
      (a.project_name ?? '').localeCompare(b.project_name ?? '')
    );
  });

  const header = 'Project\tBrand\tUsername\tMatch\tTentative_Project\tTentative_Proj_No\tAction';
  const lines = gap.map((r) => {
    const proj = r.matched_project_id ? projById.get(r.matched_project_id as string) : null;
    const action = r.matched_project_id ? 'CONFIRM-match' : 'LINK-or-CREATE';
    return [
      r.project_name,
      r.portal_brand ?? '(none)',
      r.portal_username,
      r.match_confidence ?? 'none',
      proj?.customer_name ?? '',
      proj?.project_number ?? '',
      action,
    ].join('\t');
  });

  const linkCreate = gap.filter((r) => !r.matched_project_id).length;
  const confirm = gap.length - linkCreate;
  const banner =
    `# O&M MONITORING GAP — plants with a portal login NOT yet in plant_monitoring_credentials\n` +
    `# ${gap.length} plants (${linkCreate} LINK-or-CREATE, ${confirm} CONFIRM-match). In O&M now: ${promotedSet.size}.\n` +
    `# LINK-or-CREATE = no ERP project (Manivel links/creates). CONFIRM-match = tentative project, verify then promote.\n` +
    `# Re-run anytime: pnpm tsx scripts/export-om-monitoring-gap.ts\n#\n`;

  const out = path.resolve(__dirname, 'data/plant-credentials-dump-om-monitoring-gap.tsv');
  fs.writeFileSync(out, banner + header + '\n' + lines.join('\n') + '\n');

  console.log(`O&M gap: ${gap.length} plants (${linkCreate} LINK-or-CREATE, ${confirm} CONFIRM-match)`);
  console.log(`In plant_monitoring_credentials now: ${promotedSet.size}`);
  console.log(`Written: ${out}`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
