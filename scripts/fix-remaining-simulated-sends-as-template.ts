/**
 * Replaces SIMULATED SEND placeholder Set nodes with real WhatsApp Send
 * Message nodes — directly in template mode (skipping the text-mode
 * intermediate step).
 *
 * Five workflows still had SIMULATED SEND nodes (`03, 09, 10, 11, 13`)
 * that the earlier `fix-simulated-send-nodes.ts` missed. Now that the
 * `erp_alert` Meta template is approved, build them as template-mode
 * sends from the start.
 *
 * Patterns handled:
 *   #03 — single recipient via to_phone (cron, per-item)
 *   #09, #10, #11 — single recipient via to_phone (webhook handoff)
 *   #13 — DUAL recipient: customer (message_customer + customer_phone) +
 *         finance (message_finance + finance_head_whatsapp)
 *
 * Idempotent — skips if a real WhatsApp Send is already present.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');
const TEMPLATE_REF = 'erp_alert|en';
const WHATSAPP_PHONE_NUMBER_ID = '1140448799143790';

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

function buildTemplateSendNode(
  name: string,
  recipientPhoneExpression: string,
  messageFieldExpression: string,
  position: [number, number],
): N8nNode {
  return {
    parameters: {
      resource: 'message',
      operation: 'sendTemplate',
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      recipientPhoneNumber: recipientPhoneExpression,
      template: TEMPLATE_REF,
      components: {
        component: [
          {
            type: 'body',
            bodyParameters: {
              parameter: [
                {
                  type: 'text',
                  // {{1}} = first line only (Meta forbids newlines in params)
                  text: `=${'{{'} ${messageFieldExpression}.split('\\n')[0] ${'}}'}`,
                },
                {
                  type: 'text',
                  // {{2}} = rest flattened with ' · ' bullets
                  text: `=${'{{'} (${messageFieldExpression}.split('\\n').slice(1).filter(l => l.trim()).join(' · ')) || ' ' ${'}}'}`,
                },
              ],
            },
          },
        ],
      },
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
          branch.splice(i, 1);
          for (const nn of newDownstreamNames) {
            branch.push({ node: nn, type: 'main', index: 0 });
          }
        }
      }
    }
  }
  delete connections[oldDownstreamName];
}

interface SimpleConfig {
  file: string;
  newSendName: string;
  recipientField: string; // e.g. '$json.to_phone'
  messageField: string;   // e.g. '$json.message'
}

const SIMPLE_FIX: SimpleConfig[] = [
  {
    file: '03-lead-stale-24h.json',
    newSendName: 'Send WhatsApp',
    recipientField: '$json.to_phone',
    messageField: '$json.message',
  },
  {
    file: '09-grn-recorded.json',
    newSendName: 'Send WhatsApp',
    recipientField: '$json.to_phone',
    messageField: '$json.message',
  },
  {
    file: '10-installation-scheduled.json',
    newSendName: 'Send WhatsApp',
    recipientField: '$json.to_phone',
    messageField: '$json.message',
  },
  {
    file: '11-installation-complete.json',
    newSendName: 'Send WhatsApp',
    recipientField: '$json.to_phone',
    messageField: '$json.message',
  },
];

function patchSimple(filePath: string, cfg: SimpleConfig): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.whatsApp')) return false;

  const simIdx = wf.nodes.findIndex(
    (n) => n.type === 'n8n-nodes-base.set' && (n.name?.includes('SIMULATED SEND') ?? false),
  );
  if (simIdx === -1) return false;
  const simNode = wf.nodes[simIdx];

  const newSend = buildTemplateSendNode(
    cfg.newSendName,
    `={{ ${cfg.recipientField} }}`,
    cfg.messageField,
    simNode.position ?? [750, 300],
  );

  wf.nodes.splice(simIdx, 1, newSend);
  rewireConnection(wf.connections, simNode.name!, [newSend.name!]);

  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

// #13 dual fan-out: customer (message_customer + customer_phone) +
// finance (message_finance + finance_head_whatsapp)
function patchProjectCommissioned(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.whatsApp')) return false;

  const simIdx = wf.nodes.findIndex(
    (n) => n.type === 'n8n-nodes-base.set' && (n.name?.includes('SIMULATED SEND') ?? false),
  );
  if (simIdx === -1) return false;
  const simNode = wf.nodes[simIdx];
  const basePos = simNode.position ?? [750, 300];

  const sendCustomer = buildTemplateSendNode(
    'Send WhatsApp to Customer',
    '={{ $json.customer_phone }}',
    '$json.message_customer',
    [basePos[0], basePos[1] - 100],
  );
  const sendFinance = buildTemplateSendNode(
    'Send WhatsApp to Finance',
    '={{ $json.finance_head_whatsapp }}',
    '$json.message_finance',
    [basePos[0], basePos[1] + 100],
  );

  wf.nodes.splice(simIdx, 1, sendCustomer, sendFinance);
  rewireConnection(wf.connections, simNode.name!, [sendCustomer.name!, sendFinance.name!]);

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
      console.log(`  [updt] ${cfg.file} → SIMULATED SEND replaced with template-mode send`);
      updated++;
    } else {
      console.log(`  [-no ] ${cfg.file} (already has WhatsApp Send or no SIMULATED SEND)`);
    }
  }

  const commissioned = path.join(WORKFLOWS_DIR, '13-project-commissioned.json');
  if (fs.existsSync(commissioned)) {
    if (patchProjectCommissioned(commissioned)) {
      console.log(`  [updt] 13-project-commissioned.json → SIMULATED SEND replaced with Customer + Finance fan-out (template)`);
      updated++;
    } else {
      console.log(`  [-no ] 13-project-commissioned.json (already patched)`);
    }
  }

  console.log('');
  console.log(`Done. ${updated} workflow(s) patched.`);
}

main();
