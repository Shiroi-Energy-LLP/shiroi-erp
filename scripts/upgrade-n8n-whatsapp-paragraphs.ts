/**
 * Upgrades every WhatsApp Send node from the single-blob `erp_alert` template
 * to the multi-paragraph `erp_alert_v2` template, so digests and alerts render
 * as readable paragraphs instead of one ` · ` / ` | ` flattened line.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Meta's WhatsApp Cloud API REJECTS newline/tab/4+ space characters inside
 * template PARAMETER values (error #132000, tightened Jan 2025). The only
 * place real line breaks survive is the STATIC template body. `erp_alert` had
 * just two slots ({{1}} title, {{2}} body) so the entire body collapsed onto
 * one line. `erp_alert_v2` adds blank-line-separated slots:
 *
 *   Hi from Shiroi Energy
 *
 *   {{1}}        ← title / headline (its own paragraph)
 *
 *   {{2}}        ← body paragraph 1
 *
 *   {{3}}        ← body paragraph 2
 *
 *   {{4}}        ← body paragraph 3 (remaining paragraphs joined)
 *
 *   Thank you.
 *
 * Each {{n}} still cannot contain a newline, so list ITEMS within a paragraph
 * stay ` · `-joined (a hard Meta limit — per-item line breaks are impossible
 * inside a template). But each logical SECTION now gets its own paragraph.
 *
 * ── How the source string is chosen ─────────────────────────────────────
 * The existing {{1}} expression reveals which field held the message:
 *   - `$json.<field>.split('\n')[0]`  → SRC = `$json.<field>`
 *                                       (covers message / message_customer /
 *                                        message_finance)
 *   - `$json.title`                   → SRC = `$json.title + '\n\n' + $json.body`
 *   - `$json.title_param`             → SRC = `$json.title_param + '\n\n'
 *                                                + $json.body_param`
 *
 * The chosen SRC is split on '\n\n' into paragraphs; inner '\n' lines are
 * flattened to ' · '. Empty paragraphs are dropped and slots pack from the
 * front, so any empty slots only ever trail (rendered as a blank line, then
 * "Thank you."). Empty slots fall back to ' ' because Meta requires non-empty
 * parameter values — matching the prior `erp_alert` convention.
 *
 * NOTE: `erp_alert_v2` must be submitted to and approved by Meta BEFORE these
 * workflows go live (see infrastructure/n8n/templates.md). Until then the old
 * `erp_alert` template keeps working for anything not yet re-pushed.
 *
 * Idempotent — skips nodes already on `erp_alert_v2`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

const OLD_TEMPLATE = 'erp_alert|en';
const NEW_TEMPLATE = 'erp_alert_v2|en';

interface N8nNode {
  type?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  [key: string]: unknown;
}

/**
 * Build the four template-parameter expressions from a source expression `src`
 * (the JS shown inside `={{ ... }}`, e.g. `$json.message`).
 *
 * Paragraph pipeline (identical in each slot, only the index differs):
 *   ((src) || '')
 *     .split('\n\n')                                   ← paragraphs
 *     .map(p => p.split('\n').map(l => l.trim())       ← flatten inner lines
 *               .filter(Boolean).join(' · '))
 *     .filter(Boolean)                                 ← drop empty paragraphs
 */
function buildParameters(src: string) {
  // In the JSON file, '\n' must be written as '\\n' so it survives JSON.parse
  // as a real newline character that n8n then splits on.
  const pipeline = `((${src}) || '').split('\\n\\n').map(p => p.split('\\n').map(l => l.trim()).filter(Boolean).join(' · ')).filter(Boolean)`;

  const slot = (i: number) => `={{ ((${pipeline})[${i}] || ' ').slice(0, 1000) }}`;
  const rest = (i: number) =>
    `={{ (((${pipeline}).slice(${i}).join(' · ')) || ' ').slice(0, 1000) }}`;

  return [
    { type: 'text', text: slot(0) }, // {{1}} title
    { type: 'text', text: slot(1) }, // {{2}} body paragraph 1
    { type: 'text', text: slot(2) }, // {{3}} body paragraph 2
    { type: 'text', text: rest(3) }, // {{4}} remaining paragraphs
  ];
}

/** Derive the source expression from the node's existing {{1}} parameter. */
function deriveSource(node: N8nNode): string | null {
  const param0 = (
    (node.parameters?.components as any)?.component?.[0]?.bodyParameters
      ?.parameter?.[0]?.text as string
  )?.trim();
  if (!param0) return null;

  // `$json.<field>.split('\n')[0]` → message-style single string.
  const fieldMatch = param0.match(/\$json\.(\w+)\.split\(/);
  if (fieldMatch) return `$json.${fieldMatch[1]}`;

  if (/\$json\.title_param/.test(param0)) {
    return `$json.title_param + '\\n\\n' + $json.body_param`;
  }
  if (/\$json\.title\b/.test(param0)) {
    return `$json.title + '\\n\\n' + $json.body`;
  }
  return null;
}

function upgradeNode(node: N8nNode): boolean {
  if (node.type !== 'n8n-nodes-base.whatsApp') return false;
  const params = node.parameters ?? {};
  if (params.template === NEW_TEMPLATE) return false; // idempotent
  if (params.template !== OLD_TEMPLATE) return false; // leave other templates alone

  const src = deriveSource(node);
  if (!src) {
    console.warn('  [skip] WhatsApp node with unrecognised parameter shape');
    return false;
  }

  params.template = NEW_TEMPLATE;
  (params.components as any) = {
    component: [
      {
        type: 'body',
        bodyParameters: { parameter: buildParameters(src) },
      },
    ],
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
    const wf = JSON.parse(fs.readFileSync(filePath, 'utf8')) as N8nWorkflow;

    let changed = 0;
    for (const node of wf.nodes) {
      if (upgradeNode(node)) changed++;
    }

    if (changed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
      console.log(`  [updt] ${file} → ${changed} node(s) upgraded to ${NEW_TEMPLATE}`);
      totalFiles++;
      totalNodes += changed;
    }
  }

  console.log('');
  console.log(
    `Done. ${totalNodes} WhatsApp Send node(s) across ${totalFiles} workflow file(s) upgraded ${OLD_TEMPLATE} → ${NEW_TEMPLATE}.`
  );
}

main();
