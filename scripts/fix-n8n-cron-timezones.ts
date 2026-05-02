/**
 * Fixes the cron expressions in cron-triggered workflows.
 *
 * Phase 1 wrote crons assuming UTC interpretation (e.g., "0 30 1 * * *" with
 * a node-name comment "Daily 7:00 IST (01:30 UTC)"). The droplet's
 * GENERIC_TIMEZONE=Asia/Kolkata makes n8n interpret the cron expression in
 * IST, so the workflows actually fire 5h30m EARLIER than intended:
 *   - "0 30 1 * * *" (intended 7 AM IST) actually fires at 1:30 AM IST
 *   - "0 30 2 * * *" (intended 8 AM IST) actually fires at 2:30 AM IST
 *   - etc.
 *
 * Fix: rewrite each cron expression to be IST-native, and drop the
 * misleading "(NN:NN UTC)" parenthetical from the trigger node name.
 *
 * Idempotent — only changes nodes whose cron matches a known mis-IST pattern.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

interface N8nNode {
  type?: string;
  name?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  [key: string]: unknown;
}

// Map old (UTC-intended) cron → new (IST-native) cron. Each pair represents
// the same wall-clock time in IST, just expressed correctly for the actual TZ.
const CRON_FIX_MAP: Record<string, string> = {
  '0 30 1 * * *': '0 0 7 * * *',     // 7:00 AM IST daily (#19)
  '0 30 2 * * *': '0 0 8 * * *',     // 8:00 AM IST daily (#20-#27)
  '0 30 3 * * *': '0 0 9 * * *',     // 9:00 AM IST daily (#03, #08)
  '0 30 20 * * *': '0 0 2 * * *',    // 2:00 AM IST daily (#57)
  '0 30 2 * * 1': '0 0 8 * * 1',     // Monday 8:00 AM IST (#28)
};

function fixCronInWorkflow(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  let changed = false;

  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.scheduleTrigger') continue;

    const params = node.parameters as
      | {
          rule?: { interval?: Array<{ field?: string; expression?: string }> };
        }
      | undefined;
    const interval = params?.rule?.interval?.[0];
    if (!interval || interval.field !== 'cronExpression' || !interval.expression) continue;

    const oldCron = interval.expression;
    const newCron = CRON_FIX_MAP[oldCron];
    if (!newCron) continue; // Not a known mis-IST pattern, skip

    interval.expression = newCron;

    // Drop "(NN:NN UTC)" parenthetical from trigger node name
    if (node.name) {
      node.name = node.name.replace(/\s*\([^)]*UTC\)\s*$/, '');
    }

    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  }

  return changed;
}

function main() {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let updated = 0;
  for (const file of files) {
    const fp = path.join(WORKFLOWS_DIR, file);
    if (fixCronInWorkflow(fp)) {
      console.log(`  [updt] ${file}`);
      updated++;
    }
  }
  console.log('');
  console.log(`Done. ${updated} workflow(s) had cron expressions corrected.`);
}

main();
