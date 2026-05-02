/**
 * Replaces "SIMULATED SEND" placeholder Set nodes with real WhatsApp Send Message nodes.
 *
 * Five Tier 1 webhook workflows shipped Phase 1 with simulated sends that were
 * never converted: 12, 15, 16, 17, 18. Each has a Compose Set node that builds
 * `to_phone` (or to_phone_hr / to_phone_it for #18) and `message`, followed by
 * a SIMULATED SEND Set that just records "would send to X".
 *
 * This script swaps each SIMULATED SEND for a real WhatsApp Send (typeVersion
 * 1.1, whatsAppApi credential, canonical schema). For #18 which fans out to
 * two recipients, swaps for two parallel WhatsApp Send nodes.
 *
 * Idempotent — checks if real WhatsApp Send already exists.
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
  notes?: string;
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

const WHATSAPP_PHONE_NUMBER_ID = '1140448799143790';

function buildWhatsAppSendNode(
  name: string,
  recipientPhoneExpression: string,
  position: [number, number],
): N8nNode {
  return {
    parameters: {
      operation: 'send',
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      recipientPhoneNumber: recipientPhoneExpression,
      messageType: 'text',
      textBody: '={{ $json.message }}',
      additionalFields: {},
    },
    id: `node-whatsapp-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type: 'n8n-nodes-base.whatsApp',
    typeVersion: 1.1,
    position,
    credentials: {
      whatsAppApi: {
        id: 'REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID',
        name: 'WhatsApp (Shiroi)',
      },
    },
  };
}

function rewireConnection(
  connections: N8nConnections,
  oldDownstreamName: string,
  newDownstreamNames: string[],
): void {
  for (const sourceName of Object.keys(connections)) {
    const branches = connections[sourceName].main;
    if (!branches) continue;
    for (const branch of branches) {
      for (let i = branch.length - 1; i >= 0; i--) {
        if (branch[i].node === oldDownstreamName) {
          // Remove old, append all new
          branch.splice(i, 1);
          for (const nn of newDownstreamNames) {
            branch.push({ node: nn, type: 'main', index: 0 });
          }
        }
      }
    }
  }
  // Drop any connection lines originating FROM the old simulated node (it's gone)
  delete connections[oldDownstreamName];
}

interface SimpleConfig {
  file: string;
  newSendNodeName: string;
  recipientField: string; // e.g. 'to_phone'
}

const SIMPLE_FIX: SimpleConfig[] = [
  { file: '12-ceig-approval-received.json', newSendNodeName: 'Send WhatsApp', recipientField: 'to_phone' },
  { file: '15-om-ticket-created.json', newSendNodeName: 'Send WhatsApp', recipientField: 'to_phone' },
  { file: '16-expense-submitted.json', newSendNodeName: 'Send WhatsApp', recipientField: 'to_phone' },
  { file: '17-leave-request-submitted.json', newSendNodeName: 'Send WhatsApp', recipientField: 'to_phone' },
];

function patchSimple(filePath: string, cfg: SimpleConfig): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  // Skip if already has a WhatsApp Send node
  if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.whatsApp')) {
    return false;
  }

  const simIdx = wf.nodes.findIndex(
    (n) => n.type === 'n8n-nodes-base.set' && (n.name?.includes('SIMULATED SEND') ?? false),
  );
  if (simIdx === -1) return false;
  const simNode = wf.nodes[simIdx];

  const newSend = buildWhatsAppSendNode(
    cfg.newSendNodeName,
    `={{ $json.${cfg.recipientField} }}`,
    simNode.position ?? [750, 300],
  );

  // Replace simulated with real send (preserve position)
  wf.nodes.splice(simIdx, 1, newSend);
  rewireConnection(wf.connections, simNode.name!, [newSend.name!]);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

// #18 fans out to HR + IT via to_phone_hr / to_phone_it
function patchEmployeeCreated(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.whatsApp')) {
    return false;
  }

  const simIdx = wf.nodes.findIndex(
    (n) => n.type === 'n8n-nodes-base.set' && (n.name?.includes('SIMULATED SEND') ?? false),
  );
  if (simIdx === -1) return false;
  const simNode = wf.nodes[simIdx];
  const basePos = simNode.position ?? [750, 300];

  const sendHR = buildWhatsAppSendNode(
    'Send WhatsApp to HR',
    '={{ $json.to_phone_hr }}',
    [basePos[0], basePos[1] - 100],
  );
  const sendIT = buildWhatsAppSendNode(
    'Send WhatsApp to IT',
    '={{ $json.to_phone_it }}',
    [basePos[0], basePos[1] + 100],
  );

  wf.nodes.splice(simIdx, 1, sendHR, sendIT);
  rewireConnection(wf.connections, simNode.name!, [sendHR.name!, sendIT.name!]);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

function main() {
  let updated = 0;

  for (const cfg of SIMPLE_FIX) {
    const fp = path.join(WORKFLOWS_DIR, cfg.file);
    if (!fs.existsSync(fp)) {
      console.warn(`  [skip] ${cfg.file}: not found`);
      continue;
    }
    if (patchSimple(fp, cfg)) {
      console.log(`  [updt] ${cfg.file} → SIMULATED SEND replaced with "${cfg.newSendNodeName}"`);
      updated++;
    } else {
      console.log(`  [-no ] ${cfg.file} (already has WhatsApp Send or no SIMULATED SEND found)`);
    }
  }

  const employeeFile = path.join(WORKFLOWS_DIR, '18-employee-created.json');
  if (fs.existsSync(employeeFile)) {
    if (patchEmployeeCreated(employeeFile)) {
      console.log(`  [updt] 18-employee-created.json → SIMULATED SEND replaced with HR + IT fan-out`);
      updated++;
    } else {
      console.log(`  [-no ] 18-employee-created.json (already patched)`);
    }
  }

  console.log('');
  console.log(`Done. ${updated} workflow(s) patched.`);
}

main();
