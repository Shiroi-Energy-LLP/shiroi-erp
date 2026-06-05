// One-shot patch: push the updated 60-inverter-poll-cron.json to live n8n,
// preserving the existing workflow id so the cron schedule keeps firing.
//
// Why: workflow JSON referenced ={{ $env.SUPABASE_URL }} but the n8n droplet
// doesn't have that env var set, so the URL collapsed to "/functions/v1/..."
// and every cron tick failed with "Invalid URL". Hardcoded the dev Supabase
// URL into the JSON; this script PUTs the updated definition to n8n.
//
// Usage: pnpm tsx scripts/patch-n8n-inverter-cron.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const WORKFLOW_ID = 's8fR9YlNxvtouRfr';
const FILE = 'infrastructure/n8n/workflows/60-inverter-poll-cron.json';

async function main() {
  const env = loadEnv();
  const apiKey = env.N8N_API_KEY;
  if (!apiKey) throw new Error('N8N_API_KEY missing');

  const local = JSON.parse(readFileSync(resolve(process.cwd(), FILE), 'utf8'));

  // n8n PUT requires the same shape it returns: name, nodes, connections, settings.
  // We must NOT send `active` here — n8n returns 400 if the body includes it.
  // We also need the credential id resolved on the droplet — keep what's there.
  const liveRes = await fetch(`https://n8n.shiroienergy.com/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!liveRes.ok) throw new Error(`GET workflow failed: ${liveRes.status}`);
  const live = await liveRes.json();
  console.log(`Live workflow before patch: ${live.name}, active=${live.active}`);

  // Splice the live credential id into the HTTP node (the JSON in repo has a
  // placeholder REPLACE_WITH_... which would break the request).
  const liveHttp = live.nodes.find((n: { name: string }) => n.name.includes('POST'));
  const localHttp = local.nodes.find((n: { name: string }) => n.name.includes('POST'));
  localHttp.credentials = liveHttp.credentials;

  const errorWorkflowId = (live.settings ?? {}).errorWorkflow;
  if (errorWorkflowId) local.settings.errorWorkflow = errorWorkflowId;

  const body = {
    name: local.name,
    nodes: local.nodes,
    connections: local.connections,
    settings: local.settings,
  };

  const putRes = await fetch(`https://n8n.shiroienergy.com/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const putText = await putRes.text();
  if (!putRes.ok) {
    console.error(`PUT failed: ${putRes.status}\n${putText.slice(0, 500)}`);
    throw new Error('Patch failed');
  }
  const updated = JSON.parse(putText);
  const httpNode = updated.nodes.find((n: { name: string }) => n.name.includes('POST'));
  console.log(`✓ Patched. New URL: ${httpNode.parameters.url}`);

  // Re-activate (PUT may deactivate)
  const actRes = await fetch(`https://n8n.shiroienergy.com/api/v1/workflows/${WORKFLOW_ID}/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!actRes.ok) console.warn(`Activate returned ${actRes.status}`);
  else {
    const act = await actRes.json();
    console.log(`✓ active=${act.active}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
