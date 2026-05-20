/**
 * Adds executeOnce: true to every WhatsApp Send node in the daily digest
 * workflows (#19–#28). Without this, n8n loops the Send node once per item
 * emitted from the upstream Set node — sending the SAME digest text 27, 54,
 * or 760+ times in a burst. That floods Meta's anti-spam silent throttle and
 * causes accept-but-no-deliver (root cause of the May 17–20 2026 morning
 * outages — see docs/CHANGELOG.md).
 *
 * Workflows #03 (lead-stale, per-assignee fan-out) and #08 (vendor-payment,
 * pre-aggregated to 3 fixed recipients) are correctly per-item / single-item
 * by design and must NOT have executeOnce added. Skipped.
 *
 * Usage:
 *   pnpm tsx scripts/fix-n8n-whatsapp-execute-once.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

// Digest workflows: Set node emits N items with identical message → Send must run once.
const TARGET_PREFIXES = [
  '19-', // Vivek daily 7AM digest
  '20-', // Sales head 8AM digest
  '21-', // Design head 8AM digest
  '22-', // Projects head 8AM digest
  '23-', // Purchase head 8AM digest
  '24-', // Finance head 8AM digest
  '25-', // O&M head 8AM digest
  '26-', // Liaison head 8AM digest
  '27-', // HR head 8AM digest
  '28-', // Vivek weekly Monday 8AM digest
];

interface N8nNode {
  id: string;
  name: string;
  type: string;
  executeOnce?: boolean;
  [key: string]: unknown;
}

interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  [key: string]: unknown;
}

let totalFiles = 0;
let totalNodesFixed = 0;
let totalNodesAlreadyOk = 0;

for (const file of fs.readdirSync(WORKFLOWS_DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  if (!TARGET_PREFIXES.some((p) => file.startsWith(p))) continue;

  const fullPath = path.join(WORKFLOWS_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  let changed = false;
  let nodesFixed = 0;

  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.whatsApp') continue;
    if (node.executeOnce === true) {
      totalNodesAlreadyOk++;
      continue;
    }
    node.executeOnce = true;
    nodesFixed++;
    totalNodesFixed++;
    changed = true;
  }

  if (changed) {
    // Preserve original key ordering by mutating in place; JSON.stringify with
    // 2-space indent matches existing file formatting.
    fs.writeFileSync(fullPath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
    console.log(`  ${file} → fixed ${nodesFixed} Send WhatsApp node(s)`);
  } else {
    console.log(`  ${file} → no changes needed (already fixed)`);
  }
  totalFiles++;
}

console.log('');
console.log(`Done. Scanned ${totalFiles} digest workflows.`);
console.log(`Fixed: ${totalNodesFixed} Send WhatsApp node(s) (added executeOnce:true).`);
console.log(`Already OK: ${totalNodesAlreadyOk} node(s).`);
console.log('');
console.log('Next: push the workflows to n8n with `pnpm tsx scripts/push-n8n-workflows.ts 19 20 21 22 23 24 25 26 27 28`');
