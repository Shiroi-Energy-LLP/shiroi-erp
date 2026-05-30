/**
 * Poll n8n REST API for the next execution of workflow #19 (or another
 * given workflow id) and report the outcome. Use after clicking "Execute
 * workflow" in the n8n UI when manual trigger is the only path.
 *
 *   pnpm tsx scripts/watch-n8n-19-execution.ts                 # waits up to 60s for #19
 *   pnpm tsx scripts/watch-n8n-19-execution.ts <workflowId>    # other workflow
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const BASE = 'https://n8n.shiroienergy.com';
const KEY = process.env.N8N_API_KEY!;
const WF = process.argv[2] || 'eDxwDJb96e8szPI2'; // #19

async function getLatestId() {
  const r = await fetch(`${BASE}/api/v1/executions?workflowId=${WF}&limit=1`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  const j = await r.json();
  return j.data?.[0]?.id;
}

async function getExecution(id: string) {
  const r = await fetch(`${BASE}/api/v1/executions/${id}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': KEY },
  });
  return r.json();
}

async function main() {
  const baseline = await getLatestId();
  console.log(`Watching workflow ${WF} — baseline execution id: ${baseline ?? '(none)'}`);
  console.log('Now click "Execute workflow" in the n8n UI. Waiting up to 60s for a new execution…');
  const deadline = Date.now() + 60_000;
  let newId;
  while (Date.now() < deadline) {
    const latest = await getLatestId();
    if (latest && latest !== baseline) {
      newId = latest;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!newId) {
    console.log('No new execution appeared in 60s. Did you click Execute?');
    process.exit(2);
  }
  console.log(`\nNew execution: ${newId}. Fetching details…\n`);
  // Give n8n a couple seconds to finalize the run
  await new Promise((r) => setTimeout(r, 4_000));
  const e = await getExecution(newId);
  console.log('status :', e.status);
  console.log('mode   :', e.mode);
  console.log('started:', e.startedAt);
  const runData = e.data?.resultData?.runData || {};
  console.log('\nnode execution map:');
  for (const [node, runs] of Object.entries(runData) as any) {
    const err = runs[0]?.error;
    if (err) {
      console.log(`  ✗ ${node} — ${err.message}`);
      const respBody = err.errorResponse?.body?.error;
      if (respBody) console.log('      meta:', JSON.stringify(respBody).slice(0, 250));
    } else {
      const items = runs[0]?.data?.main?.[0]?.length ?? 0;
      console.log(`  ✓ ${node} (${runs.length} run, ${items} item)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
