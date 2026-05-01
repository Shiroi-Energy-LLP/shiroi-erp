/**
 * Fixes all n8n workflow JSONs in infrastructure/n8n/workflows/ to use the
 * canonical n8n WhatsApp Send schema.
 *
 * Phase 1 emitted nodes with parameters {phoneNumberId, toPhoneNumber, message}
 * and credential type `whatsAppBusinessAccountApi`. Both are wrong.
 *
 * The actual n8n WhatsApp Send schema (typeVersion 1.1, resource_message/operation_send):
 *   parameters: { operation, phoneNumberId, recipientPhoneNumber, messageType, textBody, additionalFields }
 *   credentials: { whatsAppApi: { id, name } }
 *
 * Idempotent — safe to re-run.
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
  credentials?: Record<string, { id: string; name: string }>;
  [key: string]: unknown;
}

interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  [key: string]: unknown;
}

function fixWhatsAppNode(node: N8nNode): boolean {
  if (node.type !== 'n8n-nodes-base.whatsApp') return false;

  const oldParams = node.parameters ?? {};

  const phoneNumberId = (oldParams.phoneNumberId as string) ?? '1140448799143790';

  // Phase 1 used `toPhoneNumber`; canonical is `recipientPhoneNumber`
  const recipientPhoneNumber =
    (oldParams.recipientPhoneNumber as string) ??
    (oldParams.toPhoneNumber as string) ??
    '';

  // Phase 1 used `message`; canonical is `textBody`
  const textBody =
    (oldParams.textBody as string) ?? (oldParams.message as string) ?? '';

  node.parameters = {
    operation: 'send',
    phoneNumberId,
    recipientPhoneNumber,
    messageType: 'text',
    textBody,
    additionalFields: {},
  };

  // Latest typeVersion is 1.1 (v11 directory in n8n package)
  node.typeVersion = 1.1;

  // Fix credential type key: whatsAppBusinessAccountApi → whatsAppApi
  if (node.credentials?.whatsAppBusinessAccountApi) {
    node.credentials = {
      whatsAppApi: node.credentials.whatsAppBusinessAccountApi,
    };
  }

  return true;
}

function main() {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let totalFiles = 0;
  let totalNodes = 0;

  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const wf = JSON.parse(raw) as N8nWorkflow;

    let changedNodes = 0;
    for (const node of wf.nodes) {
      if (fixWhatsAppNode(node)) {
        changedNodes++;
      }
    }

    if (changedNodes > 0) {
      // Pretty-print with 2-space indent to match repo style.
      fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
      console.log(`  [updt] ${file} → ${changedNodes} WhatsApp node(s) fixed`);
      totalFiles++;
      totalNodes += changedNodes;
    }
  }

  console.log('');
  console.log(`Done. ${totalNodes} WhatsApp Send node(s) across ${totalFiles} file(s) updated.`);
}

main();
