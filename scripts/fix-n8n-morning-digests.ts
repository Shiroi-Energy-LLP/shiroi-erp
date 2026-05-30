/**
 * One-shot fix for the May-26-to-May-30 morning digest failures.
 *
 * Two root causes found in n8n execution logs:
 *
 *  1. Meta error 132018 ("Param text cannot have new-line/tab characters or
 *     more than 4 consecutive spaces") — body field had \n separators.
 *     Affects #19, #20, #21, #22. Fix: wrap every WhatsApp Send node's body
 *     and title parameter expressions with a sanitizing chain that strips
 *     \n/\t and collapses 4+ spaces.
 *
 *  2. Compose runs once per parent completion when the cron fans out into
 *     N parallel branches with no Merge node. The first run hits
 *     $('UnexecutedNode').all() which throws an n8n ExpressionError whose
 *     constructor itself throws TypeError ("Cannot assign to read-only
 *     property 'name'"). That TypeError escapes the user-JS try/catch,
 *     killing the workflow before any data arrives.
 *     Affects #19 (4 parents) and #20 (2 parents). Fix: rewire the cron
 *     into a serial chain so Compose runs once after all parents complete.
 *
 * Run:
 *   pnpm tsx scripts/fix-n8n-morning-digests.ts          # rewrite JSONs
 *   pnpm tsx scripts/fix-n8n-morning-digests.ts --check  # report diffs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

const TARGET_FILES = [
  '19-vivek-daily-7am.json',
  '20-sales-head-daily-8am.json',
  '21-design-head-daily-8am.json',
  '22-projects-head-daily-8am.json',
];

interface SerialChain {
  cron: string;
  chain: string[];
  compose: string;
}

const SERIAL: Record<string, SerialChain> = {
  '19-vivek-daily-7am.json': {
    cron: 'Daily 7:00 IST',
    chain: ['AI Briefing — founder', 'Fetch new leads (24h)', 'Fetch tasks done (24h)', 'Fetch lead activities (24h)'],
    compose: 'Compose digest (AI or fallback)',
  },
  '20-sales-head-daily-8am.json': {
    cron: 'Daily 8:00 IST',
    chain: ['Fetch expected orders (7d)', 'Fetch expected payments (7d)'],
    compose: 'Compose digest',
  },
};

/**
 * Re-wraps a Send-node text expression so Meta won't reject it.
 *
 * Input is the OLD expression string verbatim, e.g.
 *   `={{ $json.title }}`
 *   `={{ ($json.body || ' ').slice(0, 900) }}`
 *
 * We strip the outer `={{ … }}` wrapper, look at the inner JS expression,
 * pick the source field (whichever $json.X it references), and rebuild as
 * a single sanitizing expression.
 */
function sanitizedExpr(field: string): string {
  // Cap at 1024 — Meta's hard limit per body parameter is 1024 chars.
  return `={{ ($json.${field} || '').replace(/[\\n\\t]+/g, ' | ').replace(/ {4,}/g, ' ').slice(0, 1024) }}`;
}

const FIELD_RE = /\$json\.(\w+)/;

function fixSendNodes(wf: any): boolean {
  let changed = false;
  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.whatsApp') continue;
    const params = node.parameters?.components?.component;
    if (!Array.isArray(params)) continue;
    for (const comp of params) {
      if (comp.type !== 'body') continue;
      const bps = comp.bodyParameters?.parameter;
      if (!Array.isArray(bps)) continue;
      for (const bp of bps) {
        if (typeof bp.text !== 'string' || !bp.text.startsWith('={{')) continue;
        const m = bp.text.match(FIELD_RE);
        if (!m) continue;
        const field = m[1]; // e.g. "title" or "body"
        const fixed = sanitizedExpr(field);
        if (bp.text !== fixed) {
          bp.text = fixed;
          changed = true;
        }
      }
    }
  }
  return changed;
}

function serializeConnections(wf: any, plan: SerialChain): boolean {
  const before = JSON.stringify(wf.connections);
  const conns = wf.connections;
  conns[plan.cron] = { main: [[{ node: plan.chain[0], type: 'main', index: 0 }]] };
  for (let i = 0; i < plan.chain.length; i++) {
    const from = plan.chain[i];
    const to = i + 1 < plan.chain.length ? plan.chain[i + 1] : plan.compose;
    conns[from] = { main: [[{ node: to, type: 'main', index: 0 }]] };
  }
  for (const name of plan.chain) {
    const node = wf.nodes.find((n: any) => n.name === name);
    if (node && node.continueOnFail !== true) node.continueOnFail = true;
  }
  return JSON.stringify(wf.connections) !== before;
}

function processFile(file: string, check: boolean) {
  const full = path.join(DIR, file);
  const raw = fs.readFileSync(full, 'utf8');
  const wf = JSON.parse(raw);

  const sendChanged = fixSendNodes(wf);
  const plan = SERIAL[file];
  const connsChanged = plan ? serializeConnections(wf, plan) : false;

  const after = JSON.stringify(wf, null, 2) + '\n';
  if (after === raw) {
    console.log(`  [noop ] ${file}`);
    return;
  }
  if (check) {
    console.log(`  [diff ] ${file}: send=${sendChanged}, conns=${connsChanged}`);
    return;
  }
  fs.writeFileSync(full, after);
  console.log(`  [wrote] ${file}: send=${sendChanged}, conns=${connsChanged}`);
}

const check = process.argv.includes('--check');
console.log(`fix-n8n-morning-digests${check ? ' (--check)' : ''}`);
for (const f of TARGET_FILES) processFile(f, check);
console.log('Done.');
