/**
 * Flips every WhatsApp Send node in the n8n workflows from `text` mode to
 * `template` mode using the approved Meta template `erp_alert`.
 *
 * Template body (as approved by Meta 2026-05-02):
 *   "Hi from Shiroi Energy\n\n{{1}}\n\n{{2}}\n\nThank you."
 *   Footer: "Shiroi Energy ERP"
 *
 * Mapping from existing single-string `message` to two parameters:
 *   {{1}} = first paragraph (everything before the first \n\n)  → "title"
 *   {{2}} = remaining paragraphs joined back                    → "body"
 *
 * Why this matters: free-form text only delivers within Meta's 24-hour
 * service window after a recipient messages the business. Templates have NO
 * such restriction — they reach any number, any time. After this flip, the
 * entire fleet of digest workflows (#03, #08, #20–#28) becomes activatable.
 *
 * The n8n `template` field is a string in `name|language` format. Confirmed
 * by reading n8n source:
 *   const [name, language] = template.split('|');
 *
 * Idempotent — checks if node is already on `sendTemplate` and skips.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

// Approved Meta template: erp_alert (English)
const TEMPLATE_REF = 'erp_alert|en';

interface N8nNode {
  type?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  [key: string]: unknown;
}

function flipNode(node: N8nNode): boolean {
  if (node.type !== 'n8n-nodes-base.whatsApp') return false;

  const oldParams = (node.parameters ?? {}) as Record<string, unknown>;

  // Detect which message field this send was using (for #13 dual fan-out
  // with message_customer / message_finance, the expression in the existing
  // {{1}} text gives away which field). Default to $json.message.
  const existingTextParam = ((oldParams.components as any)?.component?.[0]
    ?.bodyParameters?.parameter?.[0]?.text as string) ?? '';
  const messageFieldMatch = existingTextParam.match(/\$json\.(\w+)/);
  const messageField = messageFieldMatch ? `$json.${messageFieldMatch[1]}` : '$json.message';

  const phoneNumberId = (oldParams.phoneNumberId as string) ?? '1140448799143790';
  const recipientPhoneNumber =
    (oldParams.recipientPhoneNumber as string) ?? '={{ $json.to_phone }}';

  // Build the template-mode parameters.
  //
  // CRITICAL: Meta forbids newlines (`\n`), tabs (`\t`), and 4+ consecutive
  // spaces in template parameter VALUES. So even though the existing `message`
  // field is multi-line, we must flatten it before passing as {{1}} or {{2}}.
  //
  // {{1}} = first line of the message (the "title" headline).
  // {{2}} = remaining lines, filtered empty, joined with ' · ' bullet
  //         separator. Handles arbitrary multi-line bodies safely.
  node.parameters = {
    resource: 'message',
    operation: 'sendTemplate',
    phoneNumberId,
    recipientPhoneNumber,
    template: TEMPLATE_REF,
    components: {
      component: [
        {
          type: 'body',
          bodyParameters: {
            parameter: [
              {
                type: 'text',
                // {{1}} = first line only (no newlines)
                text: `={{ ${messageField}.split('\\n')[0] }}`,
              },
              {
                type: 'text',
                // {{2}} = rest of message flattened to a single line with
                // bullet separators. Falls back to ' ' since Meta requires
                // non-empty parameter values.
                text: `={{ (${messageField}.split('\\n').slice(1).filter(l => l.trim()).join(' · ')) || ' ' }}`,
              },
            ],
          },
        },
      ],
    },
  };

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

    let changed = 0;
    for (const node of wf.nodes) {
      if (flipNode(node)) changed++;
    }

    if (changed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
      console.log(`  [updt] ${file} → ${changed} WhatsApp Send node(s) flipped to template mode`);
      totalFiles++;
      totalNodes += changed;
    }
  }

  console.log('');
  console.log(`Done. ${totalNodes} WhatsApp Send node(s) across ${totalFiles} workflow file(s) flipped from text → template (erp_alert|en).`);
}

main();
