/**
 * Forces every n8n scheduleTrigger node to interpret its cron expression in
 * Asia/Kolkata (IST), regardless of n8n's global GENERIC_TIMEZONE / workflow
 * settings.timezone.
 *
 * Why this exists: n8n 2.x's scheduleTrigger evaluates cron in UTC unless
 * the node itself has a `timezone` parameter explicitly set. Setting
 * `settings.timezone: "Asia/Kolkata"` at the WORKFLOW level (as we did
 * 2026-05-03) is NOT sufficient — observed all morning of 2026-05-19 when
 * crons that should fire at 7/8/9 AM IST fired at 12:30/13:30/14:30 IST
 * (i.e., 7/8/9 UTC = +5:30 IST).
 *
 * Adds `parameters.timezone = "Asia/Kolkata"` to every node of type
 * `n8n-nodes-base.scheduleTrigger`. Idempotent.
 *
 * After running, re-push affected workflows AND deactivate→reactivate them
 * so n8n re-registers the cron schedule with the new timezone.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');
const TIMEZONE = 'Asia/Kolkata';

interface N8nNode {
  type?: string;
  name?: string;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflow {
  nodes: N8nNode[];
}

function patch(filePath: string): { changed: boolean; nodeName?: string } {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  let changed = false;
  let triggerName: string | undefined;

  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.scheduleTrigger') continue;
    const params = (node.parameters ?? {}) as Record<string, unknown>;
    if (params.timezone === TIMEZONE) continue; // already correct
    params.timezone = TIMEZONE;
    node.parameters = params;
    changed = true;
    triggerName = node.name;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  }

  return { changed, nodeName: triggerName };
}

function main() {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let totalChanged = 0;
  for (const file of files) {
    const fp = path.join(WORKFLOWS_DIR, file);
    const { changed, nodeName } = patch(fp);
    if (changed) {
      console.log(`  [updt] ${file} → trigger "${nodeName}" timezone=${TIMEZONE}`);
      totalChanged++;
    }
  }

  console.log('');
  console.log(`Done. ${totalChanged} workflow(s) had scheduleTrigger timezone set to ${TIMEZONE}.`);
}

main();
