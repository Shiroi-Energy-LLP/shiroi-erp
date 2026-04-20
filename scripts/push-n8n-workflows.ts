/**
 * Push n8n workflow JSONs from infrastructure/n8n/workflows/ to n8n.shiroienergy.com.
 *
 * - Resolves placeholder IDs for credentials and cross-referenced workflows.
 * - Upserts by workflow name (create if missing, update if present).
 * - Never flips active state — activation is a deliberate UI step.
 *
 * Usage:
 *   pnpm tsx scripts/push-n8n-workflows.ts          # push all
 *   pnpm tsx scripts/push-n8n-workflows.ts --dry    # resolve + print, no upload
 *   pnpm tsx scripts/push-n8n-workflows.ts 00 55    # push specific file prefixes
 *
 * Required env (.env.local):
 *   N8N_BASE_URL   e.g. https://n8n.shiroienergy.com
 *   N8N_API_KEY    Generated in n8n Settings → API → Create API key
 */

import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const N8N_BASE_URL = process.env.N8N_BASE_URL ?? 'https://n8n.shiroienergy.com';
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error('Missing N8N_API_KEY in .env.local (Settings → API → Create API key in n8n UI)');
  process.exit(1);
}

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');

// Map placeholder strings in exported JSON → live resource.
// Sub-workflow placeholders resolve by n8n workflow name.
const WORKFLOW_PLACEHOLDERS: Record<string, string> = {
  REPLACE_WITH_LEAD_CREATED_WORKFLOW_ID: '02 — Lead created',
  REPLACE_WITH_PROPOSAL_APPROVED_WORKFLOW_ID: '06 — Proposal approved',
  REPLACE_WITH_PROJECT_COMMISSIONED_WORKFLOW_ID: '13 — Project commissioned',
  REPLACE_WITH_EXPENSE_SUBMITTED_WORKFLOW_ID: '16 — Expense submitted',
  REPLACE_WITH_BUG_REPORT_WORKFLOW_ID: '01 — Bug report',
  REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID: '55 — Global Error Handler',
  // Tier 1 webhook sub-workflows added April 20, 2026
  REPLACE_WITH_PROPOSAL_REQUESTED_WORKFLOW_ID: '04 — Proposal requested (Design)',
  REPLACE_WITH_PROPOSAL_SUBMITTED_WORKFLOW_ID: '05 — Proposal submitted (Design → Sales)',
  REPLACE_WITH_PO_APPROVED_WORKFLOW_ID: '07 — Purchase order approved',
  REPLACE_WITH_GRN_RECORDED_WORKFLOW_ID: '09 — GRN recorded',
  REPLACE_WITH_INSTALL_SCHEDULED_WORKFLOW_ID: '10 — Installation scheduled',
  REPLACE_WITH_INSTALL_COMPLETE_WORKFLOW_ID: '11 — Installation complete',
  REPLACE_WITH_CEIG_APPROVAL_WORKFLOW_ID: '12 — CEIG approval received',
  REPLACE_WITH_CUSTOMER_PAYMENT_WORKFLOW_ID: '14 — Customer payment received',
  REPLACE_WITH_OM_TICKET_WORKFLOW_ID: '15 — O&M ticket created',
  REPLACE_WITH_LEAVE_REQUEST_WORKFLOW_ID: '17 — Leave request submitted',
  REPLACE_WITH_EMPLOYEE_CREATED_WORKFLOW_ID: '18 — Employee created',
};

// Credential placeholders resolve by n8n credential name + type.
const CREDENTIAL_PLACEHOLDERS: Record<string, { name: string; type: string }> = {
  REPLACE_WITH_HEADER_AUTH_CRED_ID: { name: 'x-webhook-secret', type: 'httpHeaderAuth' },
  REPLACE_WITH_GMAIL_OAUTH_CRED_ID: { name: 'Gmail (Vivek)', type: 'gmailOAuth2' },
  // Supabase service-role HTTP Header Auth for cron workflows (03, 08, Tier 2 digests).
  // Credential header is `apikey: {sb_secret_...}` — create once in n8n Settings → Credentials.
  REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID: { name: 'Supabase service role', type: 'httpHeaderAuth' },
};

interface N8nWorkflow {
  id?: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  active?: boolean;
  settings?: Record<string, unknown>;
  tags?: Array<{ name: string }>;
  meta?: Record<string, unknown>;
  pinData?: Record<string, unknown>;
}

interface N8nCredential {
  id: string;
  name: string;
  type: string;
}

async function n8n<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const url = `${N8N_BASE_URL}/api/v1${pathname}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'X-N8N-API-KEY': N8N_API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`n8n ${method} ${pathname} → ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

async function fetchExistingWorkflows(): Promise<Map<string, N8nWorkflow>> {
  const resp = await n8n<{ data: N8nWorkflow[] }>('GET', '/workflows?limit=250');
  const map = new Map<string, N8nWorkflow>();
  for (const wf of resp.data) {
    map.set(wf.name, wf);
  }
  return map;
}

async function fetchCredentials(): Promise<Map<string, N8nCredential>> {
  // n8n returns credentials without secrets; IDs + names + types is enough.
  const resp = await n8n<{ data: N8nCredential[] } | N8nCredential[]>('GET', '/credentials');
  const data = Array.isArray(resp) ? resp : resp.data;
  const map = new Map<string, N8nCredential>();
  for (const cred of data) {
    map.set(`${cred.type}:${cred.name}`, cred);
  }
  return map;
}

function resolvePlaceholders(
  wfJson: string,
  workflowsByName: Map<string, N8nWorkflow>,
  credsByTypeName: Map<string, N8nCredential>,
): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];
  let resolved = wfJson;

  for (const [placeholder, targetName] of Object.entries(WORKFLOW_PLACEHOLDERS)) {
    if (!resolved.includes(placeholder)) continue;
    const target = workflowsByName.get(targetName);
    if (!target?.id) {
      unresolved.push(`${placeholder} → workflow "${targetName}" (not found in n8n yet)`);
      continue;
    }
    resolved = resolved.replaceAll(placeholder, target.id);
  }

  for (const [placeholder, { name, type }] of Object.entries(CREDENTIAL_PLACEHOLDERS)) {
    if (!resolved.includes(placeholder)) continue;
    const cred = credsByTypeName.get(`${type}:${name}`);
    if (!cred) {
      unresolved.push(`${placeholder} → credential "${name}" (type ${type}) — create it in n8n UI first`);
      continue;
    }
    resolved = resolved.replaceAll(placeholder, cred.id);
  }

  return { resolved, unresolved };
}

async function upsertWorkflow(
  wf: N8nWorkflow,
  existing: N8nWorkflow | undefined,
): Promise<{ id: string; created: boolean }> {
  // n8n rejects extra fields on PUT/POST. Keep the payload minimal.
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? { executionOrder: 'v1' },
  };
  if (existing?.id) {
    const updated = await n8n<N8nWorkflow>('PUT', `/workflows/${existing.id}`, payload);
    return { id: updated.id!, created: false };
  }
  const created = await n8n<N8nWorkflow>('POST', '/workflows', payload);
  return { id: created.id!, created: true };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const prefixFilter = args.filter((a) => !a.startsWith('--'));

  const allFiles = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const files =
    prefixFilter.length > 0
      ? allFiles.filter((f) => prefixFilter.some((p) => f.startsWith(p)))
      : allFiles;

  if (files.length === 0) {
    console.error(`No workflow JSONs matched in ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  console.log(`n8n push: ${files.length} file(s) from ${WORKFLOWS_DIR}`);
  console.log(`Target:   ${N8N_BASE_URL}${dryRun ? ' (DRY RUN — no upload)' : ''}`);
  console.log('');

  const [workflows, credentials] = await Promise.all([
    fetchExistingWorkflows(),
    fetchCredentials().catch((e) => {
      console.warn(`Could not fetch credentials (${(e as Error).message}). Credential placeholders will remain unresolved.`);
      return new Map<string, N8nCredential>();
    }),
  ]);

  console.log(`Fetched ${workflows.size} existing workflow(s), ${credentials.size} credential(s).`);
  console.log('');

  // Two-pass import: order matters when the router references sub-workflows.
  // First pass creates/updates all files; second pass re-runs the router-type
  // files so placeholder IDs resolve against freshly created sub-workflows.
  for (const pass of [1, 2] as const) {
    console.log(`── pass ${pass} ──`);
    for (const file of files) {
      const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
      const { resolved, unresolved } = resolvePlaceholders(raw, workflows, credentials);

      for (const u of unresolved) {
        console.warn(`  [warn] ${file}: ${u}`);
      }

      let wf: N8nWorkflow;
      try {
        wf = JSON.parse(resolved);
      } catch (e) {
        console.error(`  [fail] ${file}: JSON parse error after resolve: ${(e as Error).message}`);
        continue;
      }

      if (dryRun) {
        console.log(`  [dry ] ${file} (${wf.name}) — ${unresolved.length} unresolved`);
        continue;
      }

      const existing = workflows.get(wf.name);
      try {
        const { id, created } = await upsertWorkflow(wf, existing);
        workflows.set(wf.name, { ...wf, id });
        console.log(`  [${created ? 'new ' : 'updt'}] ${file} → ${wf.name} (${id})`);
      } catch (e) {
        console.error(`  [fail] ${file}: ${(e as Error).message}`);
      }
    }
    console.log('');
  }

  console.log('Done.');
  console.log('Next steps:');
  console.log('  1. In n8n UI, activate each workflow you want live (none are activated at import).');
  console.log('  2. If credentials were unresolved, create them in Settings → Credentials and re-run this script.');
  console.log('  3. The "55 — Global Error Handler" ID is now wired into every workflow\'s errorWorkflow setting.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
