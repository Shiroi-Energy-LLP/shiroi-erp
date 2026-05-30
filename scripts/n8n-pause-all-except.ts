/**
 * Deactivate every n8n workflow except a small whitelist.
 *
 * Used 2026-05-26 to quiet n8n down to the 4 morning digests + heartbeat +
 * event-bus router + global error handler while we re-verify the WhatsApp
 * pipeline. Re-activate manually in the n8n UI when ready.
 *
 * Usage:
 *   pnpm tsx scripts/n8n-pause-all-except.ts          # apply
 *   pnpm tsx scripts/n8n-pause-all-except.ts --dry    # list, no changes
 *
 * Required env (.env.local):
 *   N8N_BASE_URL   e.g. https://n8n.shiroienergy.com
 *   N8N_API_KEY    Generated in n8n Settings → API → Create API key
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const N8N_BASE_URL = process.env.N8N_BASE_URL ?? 'https://n8n.shiroienergy.com';
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error('Missing N8N_API_KEY in .env.local (Settings → API → Create API key in n8n UI)');
  process.exit(1);
}

// Exact name match — earlier prefix-match would have activated stale duplicate
// workflows like "20 — Sales head daily 8AM digest" alongside the live
// "20 — Orders + Payments this week", causing double WhatsApp at 8 AM.
const KEEP_ACTIVE_NAMES = [
  '00 — Event Bus Router',
  '19 — Vivek daily 7AM digest',
  '20 — Orders + Payments this week',
  '21 — In-design queue',
  '22 — Active project queue',
  '55 — Global Error Handler',
  '56 — Droplet heartbeat',
];

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

async function n8n<T>(method: string, pathname: string): Promise<T> {
  const url = `${N8N_BASE_URL}/api/v1${pathname}`;
  const resp = await fetch(url, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY! },
  });
  if (!resp.ok) {
    throw new Error(`n8n ${method} ${pathname} → ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<T>;
}

async function main() {
  const dryRun = process.argv.includes('--dry');

  const resp = await n8n<{ data: N8nWorkflow[] }>('GET', '/workflows?limit=250');
  const all = resp.data;

  const keepList = all.filter((w) => KEEP_ACTIVE_NAMES.includes(w.name));
  const restList = all.filter((w) => !KEEP_ACTIVE_NAMES.includes(w.name));

  const toActivate = keepList.filter((w) => !w.active);
  const toDeactivate = restList.filter((w) => w.active);

  console.log(`Target: ${N8N_BASE_URL}${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`${all.length} workflows total · ${all.filter((w) => w.active).length} currently active`);
  console.log('');
  console.log(`KEEP ACTIVE (${keepList.length} matched, ${toActivate.length} need activation):`);
  for (const w of keepList) console.log(`  ${w.active ? '✓' : '→'} ${w.name}${w.active ? '' : '  (will activate)'}`);
  console.log('');
  console.log(`DEACTIVATE (${toDeactivate.length} of ${restList.length} non-whitelisted are currently active):`);
  for (const w of toDeactivate) console.log(`  ✗ ${w.name}`);
  console.log('');

  if (dryRun) {
    console.log('Dry run — no changes. Re-run without --dry to apply.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const w of toActivate) {
    try {
      await n8n('POST', `/workflows/${w.id}/activate`);
      ok++;
      console.log(`  [act  ] ${w.name}`);
    } catch (e) {
      failed++;
      console.error(`  [fail ] activate ${w.name}: ${(e as Error).message}`);
    }
  }
  for (const w of toDeactivate) {
    try {
      await n8n('POST', `/workflows/${w.id}/deactivate`);
      ok++;
      console.log(`  [deact] ${w.name}`);
    } catch (e) {
      failed++;
      console.error(`  [fail ] deactivate ${w.name}: ${(e as Error).message}`);
    }
  }

  console.log('');
  console.log(`Done. ${ok} change(s) applied${failed ? `, ${failed} failed` : ''}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
