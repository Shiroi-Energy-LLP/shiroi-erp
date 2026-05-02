/**
 * Adds a parallel "Send WhatsApp to Sridhar" (Chairman) node to the
 * report-tier workflows. Per Vivek's directive 2026-05-02: Sridhar receives
 * reports — daily/weekly digests + vendor-payment-due cron.
 *
 * Scope (smaller than Vinodh's founder fan-out):
 *   - 19 — Vivek daily 7AM digest         (always)
 *   - 28 — Vivek weekly Monday 8AM digest (always)
 *   - 08 — Vendor payment due (7d cron)   (always — financial report)
 *
 * Skips operational workflows (#01 bug-report, #56 droplet-heartbeat,
 * #58 sentry-forwarder) — those are noise for the chairman.
 *
 * Idempotent — won't duplicate if Sridhar node already exists.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

interface N8nNode {
  id?: string;
  name?: string;
  type?: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  position?: [number, number];
  [key: string]: unknown;
}

interface N8nConnections {
  [sourceNodeName: string]: {
    main?: Array<Array<{ node: string; type: string; index: number }>>;
  };
}

interface N8nWorkflow {
  nodes: N8nNode[];
  connections: N8nConnections;
  [key: string]: unknown;
}

const WHATSAPP_PHONE_NUMBER_ID = '1140448799143790';

function buildSridharSendNode(
  sourceNode: N8nNode,
  newName: string,
  position: [number, number],
): N8nNode {
  const clone: N8nNode = JSON.parse(JSON.stringify(sourceNode));
  clone.id = `node-whatsapp-sridhar-${Math.random().toString(36).slice(2, 8)}`;
  clone.name = newName;
  clone.parameters = {
    ...(clone.parameters ?? {}),
    recipientPhoneNumber: '={{ $env.SRIDHAR_WHATSAPP }}',
  };
  clone.position = position;
  return clone;
}

function addParallelConnection(
  connections: N8nConnections,
  fromNode: string,
  toNode: string,
): boolean {
  if (!connections[fromNode]) {
    connections[fromNode] = { main: [[]] };
  }
  if (!connections[fromNode].main) {
    connections[fromNode].main = [[]];
  }
  if (!connections[fromNode].main![0]) {
    connections[fromNode].main![0] = [];
  }
  if (
    connections[fromNode].main![0].some(
      (c) => c.node === toNode && c.type === 'main',
    )
  ) {
    return false;
  }
  connections[fromNode].main![0].push({
    node: toNode,
    type: 'main',
    index: 0,
  });
  return true;
}

interface SimpleConfig {
  file: string;
  upstreamNodeName: string;
  sourceSendName: string; // existing send node to clone for params/cred
  sridharNodeName: string;
}

const SIMPLE_FAN_OUT: SimpleConfig[] = [
  {
    file: '19-vivek-daily-7am.json',
    upstreamNodeName: 'Compose digest',
    sourceSendName: 'Send WhatsApp',
    sridharNodeName: 'Send WhatsApp to Sridhar',
  },
  {
    file: '28-vivek-weekly-monday-8am.json',
    upstreamNodeName: 'Compose placeholder weekly',
    sourceSendName: 'Send WhatsApp',
    sridharNodeName: 'Send WhatsApp to Sridhar',
  },
];

function patchSimple(filePath: string, cfg: SimpleConfig): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  if (wf.nodes.some((n) => n.name === cfg.sridharNodeName)) return false;

  const source = wf.nodes.find((n) => n.name === cfg.sourceSendName);
  if (!source) {
    console.warn(`  [skip] ${cfg.file}: source send "${cfg.sourceSendName}" not found`);
    return false;
  }

  const basePos = source.position ?? [500, 300];
  const sridhar = buildSridharSendNode(source, cfg.sridharNodeName, [
    basePos[0],
    basePos[1] + 300,
  ]);
  wf.nodes.push(sridhar);
  addParallelConnection(wf.connections, cfg.upstreamNodeName, cfg.sridharNodeName);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

// #08 vendor-payment-due: add "Send to Sridhar (always)" parallel to
// "Send to Finance (always)" — Compose feeds both. Mirrors the existing
// Vinodh always-send pattern.
function patchVendorPaymentDue(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  const SRIDHAR_NODE_NAME = 'Send to Sridhar (always)';
  if (wf.nodes.some((n) => n.name === SRIDHAR_NODE_NAME)) return false;

  const sourceSend =
    wf.nodes.find((n) => n.name === 'Send to Vinodh (always)') ??
    wf.nodes.find((n) => n.name === 'Send to Finance (always)');
  if (!sourceSend) {
    console.warn(`  [skip] 08-vendor-payment-due.json: no "Send to Finance/Vinodh (always)" found`);
    return false;
  }

  const basePos = sourceSend.position ?? [900, 100];
  const sridhar = buildSridharSendNode(sourceSend, SRIDHAR_NODE_NAME, [
    basePos[0],
    basePos[1] - 100,
  ]);
  wf.nodes.push(sridhar);
  addParallelConnection(wf.connections, 'Compose WhatsApp per payment', SRIDHAR_NODE_NAME);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

function main() {
  let updated = 0;
  for (const cfg of SIMPLE_FAN_OUT) {
    const fp = path.join(WORKFLOWS_DIR, cfg.file);
    if (!fs.existsSync(fp)) {
      console.warn(`  [skip] ${cfg.file}: not found`);
      continue;
    }
    if (patchSimple(fp, cfg)) {
      console.log(`  [updt] ${cfg.file} → added "${cfg.sridharNodeName}"`);
      updated++;
    } else {
      console.log(`  [-no ] ${cfg.file} (already patched or missing source)`);
    }
  }

  const vendor = path.join(WORKFLOWS_DIR, '08-vendor-payment-due.json');
  if (fs.existsSync(vendor)) {
    if (patchVendorPaymentDue(vendor)) {
      console.log(`  [updt] 08-vendor-payment-due.json → added "Send to Sridhar (always)"`);
      updated++;
    } else {
      console.log(`  [-no ] 08-vendor-payment-due.json (already patched)`);
    }
  }

  console.log('');
  console.log(`Done. ${updated} workflow(s) patched.`);
}

main();
