/**
 * Fixes orphaned `connections` keys after node renames.
 *
 * Bug: yesterday's `fix-n8n-cron-timezones.ts` renamed scheduleTrigger
 * nodes from e.g. "Daily 7:00 IST (01:30 UTC)" → "Daily 7:00 IST" but did
 * NOT update the workflow's `connections` map, which still references
 * the old name as the source key. n8n looks up connections by node name
 * — when the source key doesn't match any current node, the trigger
 * fires but no downstream nodes run.
 *
 * Symptom on 2026-05-03 7AM IST: every cron-triggered workflow only
 * ran the trigger node, then stopped silently. Founders received nothing.
 *
 * Fix: walk each workflow, detect orphaned connection keys (key !== any
 * node's name), guess the renamed source by stripping the same regex,
 * and rewire the connection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

interface N8nNode {
  name?: string;
  [key: string]: unknown;
}

interface N8nConnections {
  [sourceNodeName: string]: unknown;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  connections: N8nConnections;
  [key: string]: unknown;
}

function findCurrentNodeForOldKey(
  oldKey: string,
  nodeNames: Set<string>,
): string | null {
  // 1. Already matches?
  if (nodeNames.has(oldKey)) return oldKey;
  // 2. Strip "(NN:NN UTC)" parenthetical (the rename pattern)
  const stripped = oldKey.replace(/\s*\([^)]*UTC\)\s*$/, '').trim();
  if (nodeNames.has(stripped)) return stripped;
  // 3. Strip any parenthetical
  const noParens = oldKey.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (nodeNames.has(noParens)) return noParens;
  return null;
}

function fixWorkflow(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  const nodeNames = new Set<string>(
    wf.nodes.map((n) => n.name).filter((n): n is string => Boolean(n)),
  );

  const oldKeys = Object.keys(wf.connections);
  let changed = false;
  const newConnections: N8nConnections = {};

  for (const oldKey of oldKeys) {
    if (nodeNames.has(oldKey)) {
      // Already healthy
      newConnections[oldKey] = wf.connections[oldKey];
      continue;
    }
    const target = findCurrentNodeForOldKey(oldKey, nodeNames);
    if (target) {
      newConnections[target] = wf.connections[oldKey];
      changed = true;
      console.log(
        `    rewire: "${oldKey}" → "${target}"`,
      );
    } else {
      // Couldn't find a target — leave it alone, will surface as warning below
      newConnections[oldKey] = wf.connections[oldKey];
      console.warn(
        `    [warn] orphaned connection key with no matching node: "${oldKey}"`,
      );
    }
  }

  if (changed) {
    wf.connections = newConnections;
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
    console.log(file);
    if (fixWorkflow(fp)) updated++;
  }
  console.log('');
  console.log(`Done. ${updated} workflow file(s) had orphaned connections rewired.`);
}

main();
