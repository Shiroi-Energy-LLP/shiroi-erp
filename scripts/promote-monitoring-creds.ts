/**
 * Promote reviewed plant monitoring credentials from pending_project_imports
 * into plant_monitoring_credentials (so they show on the O&M page).
 *
 * It does NOT write to the DB. It GENERATES a reviewable .sql file with one
 * INSERT per matched-but-not-yet-promoted plant, each prefixed by a comment
 * showing the tentative ERP-project match + confidence. Workflow:
 *   1. pnpm tsx scripts/promote-monitoring-creds.ts
 *   2. Open the generated scripts/data/promote-monitoring-creds-*.sql and DELETE
 *      any line whose tentative match is wrong (the auto-matcher is noisy — e.g.
 *      many A-block flats mis-match to "A1 09 Mr. Saravanan").
 *   3. Run it dev-first in the Supabase SQL editor, verify O&M, then prod.
 *
 * The password is copied as the existing ciphertext (pending_project_imports and
 * plant_monitoring_credentials share the same Vault key — mig 158/159), so no
 * decrypt/re-encrypt and no plaintext ever lands in the file.
 *
 * Only rows that ALREADY have a matched_project_id are candidates. Plants with no
 * project (the "LINK-or-CREATE" set in the gap file) must be linked/created by
 * Manivel first, then re-run this.
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const GEN_DATE = '2026-06-19';

async function main(): Promise<void> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  const { data: imports, error: e1 } = await sb
    .from('pending_project_imports')
    .select('id, project_name, portal_brand, portal_url, portal_username, matched_project_id, match_confidence')
    .not('portal_username', 'is', null)
    .neq('portal_username', '')
    .not('matched_project_id', 'is', null);
  if (e1) throw new Error(e1.message);

  const { data: promoted, error: e2 } = await sb
    .from('plant_monitoring_credentials')
    .select('project_id')
    .is('deleted_at', null);
  if (e2) throw new Error(e2.message);
  const promotedSet = new Set((promoted ?? []).map((r) => r.project_id as string));

  const candidates = (imports ?? []).filter((r) => !promotedSet.has(r.matched_project_id as string));

  const ids = [...new Set(candidates.map((r) => r.matched_project_id as string))];
  const projById = new Map<string, { customer_name: string | null; project_number: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: projs } = await sb
      .from('projects')
      .select('id, customer_name, project_number')
      .in('id', ids.slice(i, i + 200));
    for (const p of projs ?? []) projById.set(p.id as string, { customer_name: p.customer_name, project_number: p.project_number });
  }

  candidates.sort(
    (a, b) =>
      (a.portal_brand ?? '').localeCompare(b.portal_brand ?? '') ||
      (a.project_name ?? '').localeCompare(b.project_name ?? ''),
  );

  const stmts = candidates.map((r) => {
    const proj = projById.get(r.matched_project_id as string);
    const comment = `-- ${r.project_name}  ->  ${proj?.customer_name ?? '?'} (${proj?.project_number ?? ''}) [${r.match_confidence ?? 'none'}]`;
    return (
      `${comment}\n` +
      `INSERT INTO plant_monitoring_credentials (project_id, portal_url, username, password_encrypted, inverter_brand, notes)\n` +
      `SELECT '${r.matched_project_id}'::uuid, portal_url, portal_username, portal_password_encrypted,\n` +
      `       COALESCE(portal_brand, 'other'), 'Promoted from pending_project_imports ${r.id} (${GEN_DATE})'\n` +
      `FROM pending_project_imports WHERE id = '${r.id}'::uuid\n` +
      `ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING;`
    );
  });

  const header =
    `-- Promote reviewed monitoring credentials into plant_monitoring_credentials.\n` +
    `-- Generated ${GEN_DATE} by scripts/promote-monitoring-creds.ts — ${candidates.length} candidates.\n` +
    `-- REVIEW FIRST: delete any INSERT whose tentative match (comment above it) is wrong.\n` +
    `-- Run dev-first, verify the O&M page, then prod. Password ciphertext is copied as-is\n` +
    `-- (shared Vault key) so no plaintext appears here.\n--\n`;
  const sql = `${header}\nBEGIN;\n\n${stmts.join('\n\n')}\n\nCOMMIT;\n`;

  const out = path.resolve(__dirname, `data/promote-monitoring-creds-${GEN_DATE}.sql`);
  fs.writeFileSync(out, sql);

  console.log(`${candidates.length} promotable candidates (matched but not yet in O&M).`);
  console.log(`Review SQL written: ${out}`);
  console.log(`Next: open it, delete wrong matches, run dev-first in the SQL editor.`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
