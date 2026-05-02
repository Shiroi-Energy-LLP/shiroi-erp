/**
 * Adds a parallel "Send to Vinodh (co-founder)" WhatsApp node alongside every
 * Vivek-targeted send in founder-tier workflows.
 *
 * Founder messages go to Vivek (+919444414087) AND Vinodh (+919444052787).
 * Each founder workflow is patched to fan-out: same upstream node now connects
 * to BOTH the original Vivek send AND a clone targeting $env.VINODH_WHATSAPP.
 *
 * Pattern handled:
 *   1. Single-send (01, 19, 28, 56, 58): one "Send WhatsApp" node → clone parallel
 *   2. Conditional cc (08): "Send to Vivek (cc high-value only)" → clone after the IF
 *
 * Idempotent — safe to re-run; checks if Vinodh node already exists.
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
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
  [key: string]: unknown;
}

// Workflows that send to Vivek as founder; each gets a parallel Vinodh send.
// originalSendNodeName = the node whose recipient is (effectively) VIVEK_WHATSAPP.
// upstreamNodeName     = the node that connects INTO the original send.
const FOUNDER_WORKFLOWS: Array<{
  file: string;
  originalSendNodeName: string;
  upstreamNodeName: string;
  vinodhNodeName: string;
}> = [
  {
    file: '01-bug-report.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose WhatsApp message',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '19-vivek-daily-7am.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose digest',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '28-vivek-weekly-monday-8am.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose placeholder weekly',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '56-droplet-health.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose alert',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '58-sentry-forwarder.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose alert',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  // Per Vivek's directive 2026-05-02: "Finance, OM, HR send to Vinodh and me".
  // Each *_HEAD_WHATSAPP env var is set to Vivek's phone on the droplet so the
  // existing "Send WhatsApp" node already routes to Vivek; this clone routes
  // the same message to Vinodh in parallel.
  {
    file: '24-finance-head-daily-8am.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose digest',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '25-om-head-daily-8am.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose digest',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
  {
    file: '27-hr-head-daily-8am.json',
    originalSendNodeName: 'Send WhatsApp',
    upstreamNodeName: 'Compose digest',
    vinodhNodeName: 'Send WhatsApp to Vinodh',
  },
];

function findNode(wf: N8nWorkflow, name: string): N8nNode | undefined {
  return wf.nodes.find((n) => n.name === name);
}

function cloneVinodhSendNode(
  original: N8nNode,
  vinodhNodeName: string,
): N8nNode {
  // Deep clone, then point recipient to VINODH_WHATSAPP and reposition slightly.
  const clone: N8nNode = JSON.parse(JSON.stringify(original));
  clone.id = `node-whatsapp-vinodh-${Math.random().toString(36).slice(2, 8)}`;
  clone.name = vinodhNodeName;
  clone.parameters = {
    ...(clone.parameters ?? {}),
    recipientPhoneNumber: '={{ $env.VINODH_WHATSAPP }}',
  };
  if (clone.position) {
    clone.position = [clone.position[0], clone.position[1] + 150];
  }
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
  // Skip if already connected
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

function patchSimpleFounderWorkflow(
  filePath: string,
  config: (typeof FOUNDER_WORKFLOWS)[number],
): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  // Idempotent: skip if Vinodh node already there.
  if (findNode(wf, config.vinodhNodeName)) {
    return false;
  }

  const original = findNode(wf, config.originalSendNodeName);
  if (!original) {
    console.warn(
      `  [skip] ${config.file}: original node "${config.originalSendNodeName}" not found`,
    );
    return false;
  }

  const upstream = findNode(wf, config.upstreamNodeName);
  if (!upstream) {
    console.warn(
      `  [skip] ${config.file}: upstream node "${config.upstreamNodeName}" not found`,
    );
    return false;
  }

  const vinodhNode = cloneVinodhSendNode(original, config.vinodhNodeName);
  wf.nodes.push(vinodhNode);

  addParallelConnection(wf.connections, config.upstreamNodeName, config.vinodhNodeName);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

// #08 has a different pattern: conditional cc via IF node. Add a parallel
// Vinodh send connected from the same IF "true" output, plus a `to_phone_vinodh`
// field in the compose Set node that mirrors `to_phone_vivek`.
function patchVendorPaymentDue(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  const VINODH_NODE_NAME = 'Send to Vinodh (cc high-value only)';
  if (findNode(wf, VINODH_NODE_NAME)) {
    return false;
  }

  const composeNode = findNode(wf, 'Compose WhatsApp per payment');
  const vivekNode = findNode(wf, 'Send to Vivek (cc high-value only)');
  const ifNode = findNode(wf, 'Is high value (>₹5L)?');

  if (!composeNode || !vivekNode || !ifNode) {
    console.warn(
      `  [skip] 08-vendor-payment-due.json: missing one of compose/vivek/if nodes`,
    );
    return false;
  }

  // Add to_phone_vinodh assignment to Compose Set node
  const params = composeNode.parameters as {
    assignments?: { assignments: Array<{ id: string; name: string; value: string; type: string }> };
  };
  const assignments = params.assignments?.assignments ?? [];
  if (!assignments.some((a) => a.name === 'to_phone_vinodh')) {
    // Insert after to_phone_vivek
    const vivekIdx = assignments.findIndex((a) => a.name === 'to_phone_vivek');
    const newAssignment = {
      id: 'm3v',
      name: 'to_phone_vinodh',
      value: "={{ Number($json.amount_outstanding) > 500000 ? $env.VINODH_WHATSAPP : '' }}",
      type: 'string',
    };
    if (vivekIdx >= 0) {
      assignments.splice(vivekIdx + 1, 0, newAssignment);
    } else {
      assignments.push(newAssignment);
    }
  }

  // Clone the Vivek send node, point at VINODH
  const vinodhNode: N8nNode = JSON.parse(JSON.stringify(vivekNode));
  vinodhNode.id = `node-whatsapp-vinodh-${Math.random().toString(36).slice(2, 8)}`;
  vinodhNode.name = VINODH_NODE_NAME;
  vinodhNode.parameters = {
    ...(vinodhNode.parameters ?? {}),
    recipientPhoneNumber: '={{ $json.to_phone_vinodh }}',
  };
  if (vinodhNode.position) {
    vinodhNode.position = [vinodhNode.position[0] + 200, vinodhNode.position[1] + 150];
  }
  wf.nodes.push(vinodhNode);

  // Connect IF "true" output → Vinodh send (alongside Vivek send)
  addParallelConnection(wf.connections, 'Is high value (>₹5L)?', VINODH_NODE_NAME);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

function main() {
  let updated = 0;

  for (const config of FOUNDER_WORKFLOWS) {
    const filePath = path.join(WORKFLOWS_DIR, config.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  [skip] ${config.file}: not found`);
      continue;
    }
    if (patchSimpleFounderWorkflow(filePath, config)) {
      console.log(`  [updt] ${config.file} → added "${config.vinodhNodeName}"`);
      updated++;
    } else {
      console.log(`  [-no ] ${config.file} (already patched or missing nodes)`);
    }
  }

  // #08 special case
  const vendorFile = path.join(WORKFLOWS_DIR, '08-vendor-payment-due.json');
  if (fs.existsSync(vendorFile)) {
    if (patchVendorPaymentDue(vendorFile)) {
      console.log(`  [updt] 08-vendor-payment-due.json → added "Send to Vinodh (cc high-value only)"`);
      updated++;
    } else {
      console.log(`  [-no ] 08-vendor-payment-due.json (already patched)`);
    }
  }

  console.log('');
  console.log(`Done. ${updated} workflow(s) patched.`);
}

main();
