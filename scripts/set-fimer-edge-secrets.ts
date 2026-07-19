/**
 * Set the FIMER Edge Function secrets via the Supabase Management API.
 *
 * Only sets the FIMER_CRED_* secrets actually needed by currently
 * polling-enabled FIMER inverters (so disabled/sold plants' creds are skipped).
 * Credential values are read from .env.local — never passed on the command line.
 *
 * Requires SUPABASE_ACCESS_TOKEN in .env.local — a Supabase Personal Access
 * Token (Dashboard → Account → Access Tokens). Reusable for future deploys/secrets.
 *
 *   pnpm tsx scripts/set-fimer-edge-secrets.ts           # dry-run (shows what it would set)
 *   pnpm tsx scripts/set-fimer-edge-secrets.ts --apply   # actually set them
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'actqtzoxjilqnldnacqz';
const MGMT_BASE = 'https://api.supabase.com';

async function main() {
  const apply = process.argv.includes('--apply');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (apply && !token) {
    console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local.');
    console.error('Create one: Supabase Dashboard → Account → Access Tokens → Generate new token.');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local.');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // The set of FIMER_CRED_* refs needed = distinct vault_secret_ref of
  // polling-enabled fimer inverters.
  const { data: invs, error } = await sb
    .from('inverters')
    .select('monitoring_credentials_id')
    .eq('brand', 'fimer')
    .eq('polling_enabled', true)
    .not('monitoring_credentials_id', 'is', null);
  if (error) throw new Error(error.message);

  const credIds = [...new Set((invs ?? []).map((r) => r.monitoring_credentials_id as string))];
  const refs = new Set<string>();
  for (const cid of credIds) {
    const { data: c } = await sb
      .from('inverter_monitoring_credentials')
      .select('vault_secret_ref')
      .eq('id', cid)
      .maybeSingle();
    if (c?.vault_secret_ref) refs.add(c.vault_secret_ref);
  }

  if (refs.size === 0) {
    console.log('No polling-enabled FIMER inverters → no secrets to set.');
    return;
  }

  console.log(`Secrets needed for enabled FIMER inverters: ${[...refs].join(', ')}`);
  const secrets: { name: string; value: string }[] = [];
  for (const name of refs) {
    const value = process.env[name];
    if (!value) {
      console.error(`  ✗ ${name}: not present in .env.local; skipping`);
      continue;
    }
    try {
      const o = JSON.parse(value) as { api_key?: string; username?: string; password?: string };
      if (!o.api_key || !o.username || !o.password) {
        console.error(`  ✗ ${name}: JSON missing api_key/username/password; skipping`);
        continue;
      }
    } catch {
      console.error(`  ✗ ${name}: not valid JSON; skipping`);
      continue;
    }
    secrets.push({ name, value });
    console.log(`  • ${name}: ready`);
  }

  if (secrets.length === 0) {
    console.log('Nothing valid to set.');
    return;
  }
  if (!apply) {
    console.log(`\nDry run — ${secrets.length} secret(s) would be set. Re-run with --apply.`);
    return;
  }

  const res = await fetch(`${MGMT_BASE}/v1/projects/${PROJECT_REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(secrets),
  });
  const text = await res.text();
  console.log(`\nManagement API → HTTP ${res.status} ${text.slice(0, 200)}`);
  if (res.ok) {
    console.log(`✓ Set ${secrets.length} Edge secret(s): ${secrets.map((s) => s.name).join(', ')}`);
    console.log('The next inverter-poll run will pick them up (no redeploy needed).');
  } else {
    console.error('✗ Failed — check the token has the right scope and the project ref is correct.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
