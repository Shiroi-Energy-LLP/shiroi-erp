/**
 * Set the Zoho Books Edge Function secrets via the Supabase Management API.
 *
 * Used by the zoho-sync Edge Function (supabase/functions/zoho-sync) — see
 * docs/superpowers/specs/2026-07-16-zoho-live-api-sync-design.md §3.
 * Secret values are read from .env.local — never passed on the command line.
 *
 * Requires SUPABASE_ACCESS_TOKEN in .env.local — the "shiroi-erp-mgmt"
 * Personal Access Token (Dashboard → Account → Access Tokens).
 *
 *   pnpm tsx scripts/set-zoho-edge-secrets.ts           # dry-run (shows what it would set)
 *   pnpm tsx scripts/set-zoho-edge-secrets.ts --apply   # actually set them
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const PROJECT_REF = 'actqtzoxjilqnldnacqz';
const MGMT_BASE = 'https://api.supabase.com';

// name → required? (ZOHO_DC is optional; the function defaults to 'in')
const SECRET_SPECS: Array<{ name: string; required: boolean }> = [
  { name: 'ZOHO_CLIENT_ID', required: true },
  { name: 'ZOHO_CLIENT_SECRET', required: true },
  { name: 'ZOHO_REFRESH_TOKEN', required: true },
  { name: 'ZOHO_BOOKS_ORG_ID', required: true },
  { name: 'ZOHO_DC', required: false },
  { name: 'ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID', required: true },
  { name: 'ZOHO_PAID_THROUGH_ACCOUNT_ID', required: true },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (apply && !token) {
    console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local.');
    console.error('Create one: Supabase Dashboard → Account → Access Tokens → Generate new token.');
    process.exit(1);
  }

  const secrets: { name: string; value: string }[] = [];
  let missingRequired = false;
  for (const spec of SECRET_SPECS) {
    const value = process.env[spec.name]?.trim();
    if (!value) {
      if (spec.required) {
        console.error(`  ✗ ${spec.name}: not present in .env.local (REQUIRED)`);
        missingRequired = true;
      } else {
        console.log(`  • ${spec.name}: not set — skipping (zoho-sync defaults apply)`);
      }
      continue;
    }
    secrets.push({ name: spec.name, value });
    console.log(`  • ${spec.name}: ready`);
  }

  if (missingRequired) {
    console.error('\nAborting — add the missing required ZOHO_* values to .env.local first.');
    console.error('(Self-client setup: api-console.zoho.in → client id/secret → grant code for');
    console.error(' scope ZohoBooks.fullaccess.all → exchange for a refresh token. See spec §9.)');
    process.exit(1);
  }
  if (secrets.length === 0) {
    console.log('Nothing to set.');
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
    console.log('The next zoho-sync invocation will pick them up (no redeploy needed).');
  } else {
    console.error('✗ Failed — check the token has the right scope and the project ref is correct.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
