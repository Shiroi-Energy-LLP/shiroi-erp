/**
 * inject-ai-personalise.ts
 *
 * Programmatically injects an "AI Personalise" HTTP Request node into each of the
 * 8 F1 customer drip workflows (40–47). The new node runs BEFORE the Meta Send node
 * and POSTs to /api/drip/personalise with the customer context.
 *
 * On success:  the response vars[] are used as the Meta template parameters.
 * On failure:  continueOnFail: true lets the workflow fall back to the existing
 *              static variable substitution already in the Meta Send node.
 *
 * Usage:
 *   npx tsx scripts/n8n/inject-ai-personalise.ts
 *
 * Idempotent: if a workflow already has a node named "AI Personalise", it is skipped.
 *
 * No n8n API call needed — this modifies the JSON files directly and the files are
 * pushed via scripts/push-n8n-workflows.ts (or imported manually via n8n UI).
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types matching n8n workflow JSON schema ────────────────────────────────────

interface N8nParameter {
  name: string;
  value: string;
}

interface N8nNodeParameters {
  url?: string;
  method?: string;
  sendHeaders?: boolean;
  headerParameters?: { parameters: N8nParameter[] };
  sendBody?: boolean;
  bodyParameters?: { parameters: N8nParameter[] };
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

interface N8nNode {
  parameters: N8nNodeParameters;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  continueOnFail?: boolean;
}

interface N8nConnectionEntry {
  node: string;
  type: string;
  index: number;
}

interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnectionEntry[][] }>;
  settings?: Record<string, unknown>;
  tags?: Array<{ name: string }>;
  meta?: Record<string, unknown>;
}

// ── Per-workflow configuration ─────────────────────────────────────────────────

/**
 * Describes what context each workflow can supply to the personaliser.
 * "extracted" fields are already set by the "Extract fields" Set node.
 *
 * pass_through: variable positions (1-based) that must NOT be AI-flavoured.
 *   These are URLs, phone numbers, or other values that must be passed through exactly.
 *   The key is the position number; the value is the n8n expression to use.
 *
 * extra_context: additional context fields to forward to the AI.
 *   Keys are human-readable labels; values are n8n expressions.
 */
interface WorkflowConfig {
  /** Template name matching DripTemplateName in drip-template-registry.ts */
  template_name: string;
  /** n8n expression for customer_name */
  customer_name_expr: string;
  /** n8n expression for project_number / project_id */
  project_number_expr: string;
  /** n8n expression for customer_segment (may be static string or expression) */
  customer_segment_expr: string;
  /** Which variable positions (1-based) are URLs/phones and must pass through unchanged */
  pass_through: Record<string, string>;
  /** Any additional context key → n8n expression pairs */
  extra_context: Record<string, string>;
  /** n8n expression for customer_phone (for the meta send node if we need to rebuild) */
  customer_phone_expr: string;
  /**
   * Node name BEFORE the Meta Send node that AI Personalise should be inserted after.
   * Usually "Extract fields" or the split node for cron workflows.
   */
  insert_after_node: string;
  /**
   * The name of the Meta Send node (so we can update its connections and body).
   * The script rewires: insert_after_node → AI Personalise → [existing next node]
   */
  meta_send_node: string;
}

const WORKFLOW_DIR = path.resolve(__dirname, '../../infrastructure/n8n/workflows');
const ERP_URL_EXPR = 'ERP_URL';

const WORKFLOW_CONFIGS: Record<string, WorkflowConfig> = {
  '40-customer-proposal-sent.json': {
    template_name: 'customer_proposal_sent',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "3": "$json.proposal_link",  // URL — pass through exactly
    },
    extra_context: {
      system_size_kwp: "$json.system_size_kwp",
      proposal_number: "$json.proposal_number",
    },
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },

  '41-customer-order-received.json': {
    template_name: 'customer_order_received',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "4": "$json.pm_phone",  // phone number — pass through exactly
    },
    extra_context: {
      start_date: "$json.start_date",
      pm_name: "$json.pm_name",
    },
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },

  '42-customer-net-metering-applied.json': {
    template_name: 'customer_net_metering_applied',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {},  // only 1 var (customer name) — AI personalises it
    extra_context: {},
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },

  '43-customer-install-milestone.json': {
    template_name: 'customer_install_milestone',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {},
    extra_context: {
      milestone_label: "$json.milestone_label",
      next_step: "$json.next_step",
    },
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },

  '44-customer-payment-reminder.json': {
    template_name: 'customer_payment_reminder',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "2": "$json.amount_due",        // formatted INR string — pass through
      "3": "$json.due_date",          // date string — pass through
      "4": "$json.project_reference", // project ref code — pass through
      "5": "$json.payment_link",      // URL — pass through exactly
    },
    extra_context: {},
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Split payment rows',
    meta_send_node: 'Send payment reminder',
  },

  '45-customer-om-ticket-created.json': {
    template_name: 'customer_om_ticket_created',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "2": "$json.ticket_number",  // ticket ref — pass through
    },
    extra_context: {
      tech_name: "$json.tech_name",
      visit_date: "$json.visit_date",
    },
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },

  '46-customer-annual-checkup.json': {
    template_name: 'customer_annual_checkup',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "2": "$json.booking_link",  // URL — pass through exactly
    },
    extra_context: {},
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Split project rows',
    meta_send_node: 'Send annual checkup reminder',
  },

  '47-customer-commissioning-complete.json': {
    template_name: 'customer_commissioning_complete',
    customer_name_expr: "$json.customer_name",
    project_number_expr: "$json.project_id",
    customer_segment_expr: "'residential'",
    pass_through: {
      "4": "$json.monitoring_link",  // URL — pass through exactly
    },
    extra_context: {
      system_size_kwp: "$json.system_size_kwp",
      commissioned_date: "$json.commissioned_date",
    },
    customer_phone_expr: "$json.customer_phone",
    insert_after_node: 'Extract fields',
    meta_send_node: 'Send WhatsApp template',
  },
};

// ── Node builder ───────────────────────────────────────────────────────────────

/**
 * Builds the JSON body expression for the AI Personalise HTTP Request node.
 * Uses n8n expression syntax.
 */
function buildAiPersonaliseBodyExpr(config: WorkflowConfig): string {
  // Build pass_through object (if any)
  const passThroughParts = Object.entries(config.pass_through)
    .map(([pos, expr]) => `"${pos}": ${expr}`)
    .join(', ');

  const passThroughExpr = passThroughParts ? `{ ${passThroughParts} }` : '{}';

  // Build extra_context fields inlined directly into customer_context
  // (avoid JS spread operator — n8n expression engine doesn't support it)
  const extraParts = Object.entries(config.extra_context)
    .map(([key, expr]) => `"${key}": ${expr}`)
    .join(', ');

  const extraContextFields = extraParts ? `, ${extraParts}` : '';

  return (
    `={{ JSON.stringify({` +
    ` queue_id: $json.queue_id || '',` +
    ` template_name: '${config.template_name}',` +
    ` customer_context: {` +
    ` customer_name: ${config.customer_name_expr},` +
    ` customer_segment: ${config.customer_segment_expr},` +
    ` project_number: ${config.project_number_expr},` +
    ` pass_through: ${passThroughExpr}` +
    `${extraContextFields}` +
    ` }` +
    `}) }}`
  );
}

function buildAiPersonaliseNode(
  config: WorkflowConfig,
  position: [number, number],
): N8nNode {
  return {
    parameters: {
      url: `={{ $env.${ERP_URL_EXPR} + '/api/drip/personalise' }}`,
      method: 'POST',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'x-webhook-secret', value: '={{ $env.ERP_WEBHOOK_SECRET }}' },
        ],
      },
      sendBody: true,
      bodyParameters: {
        parameters: [
          {
            name: 'body',
            value: buildAiPersonaliseBodyExpr(config),
          },
        ],
      },
      options: {},
    },
    id: `node-ai-personalise-${config.template_name}`,
    name: 'AI Personalise',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    continueOnFail: true,  // CRITICAL: fall back to static vars on Haiku timeout/error
  };
}

/**
 * Builds the updated Meta Send node body that uses AI vars when available,
 * falling back to the static values when the AI call failed.
 *
 * The fallback logic uses n8n's expression: if the AI Personalise node succeeded,
 * $('AI Personalise').item.json.vars[N] is defined; otherwise use the static value.
 *
 * This replaces the hard-coded static expression in the existing Meta Send node body.
 */
function buildMetaSendBodyExpr(
  templateMetaName: string,
  staticParams: Array<{ static_expr: string; position: number }>,
): string {
  // Build parameters array with AI-first, static fallback
  const parametersExpr = staticParams
    .map(({ static_expr, position }) => {
      const aiExpr = `$('AI Personalise').item?.json?.vars?.[${position - 1}]`;
      return `{ type: 'text', text: (${aiExpr} || ${static_expr}) }`;
    })
    .join(', ');

  return (
    `={{ JSON.stringify({` +
    ` messaging_product: 'whatsapp',` +
    ` to: $json.customer_phone,` +
    ` type: 'template',` +
    ` template: {` +
    `   name: '${templateMetaName}',` +
    `   language: { code: 'en' },` +
    `   components: [{` +
    `     type: 'body',` +
    `     parameters: [${parametersExpr}]` +
    `   }]` +
    ` }` +
    `}) }}`
  );
}

// ── Static parameter maps per workflow ────────────────────────────────────────

// These mirror the original static expressions so the fallback is identical to
// the pre-AI behaviour.
const STATIC_PARAMS: Record<string, Array<{ static_expr: string; position: number }>> = {
  '40-customer-proposal-sent.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
    { position: 2, static_expr: "$('Extract fields').item.json.system_size_kwp" },
    { position: 3, static_expr: "$('Extract fields').item.json.proposal_link" },
  ],
  '41-customer-order-received.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
    { position: 2, static_expr: "$('Extract fields').item.json.start_date" },
    { position: 3, static_expr: "$('Extract fields').item.json.pm_name" },
    { position: 4, static_expr: "$('Extract fields').item.json.pm_phone" },
  ],
  '42-customer-net-metering-applied.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
  ],
  '43-customer-install-milestone.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
    { position: 2, static_expr: "$('Extract fields').item.json.milestone_label" },
    { position: 3, static_expr: "$('Extract fields').item.json.next_step" },
  ],
  '44-customer-payment-reminder.json': [
    { position: 1, static_expr: "$('Split payment rows').item.json.customer_name" },
    { position: 2, static_expr: "$('Split payment rows').item.json.amount_due" },
    { position: 3, static_expr: "$('Split payment rows').item.json.due_date" },
    { position: 4, static_expr: "$('Split payment rows').item.json.project_reference" },
    { position: 5, static_expr: "$('Split payment rows').item.json.payment_link" },
  ],
  '45-customer-om-ticket-created.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
    { position: 2, static_expr: "$('Extract fields').item.json.ticket_number" },
    { position: 3, static_expr: "$('Extract fields').item.json.tech_name" },
    { position: 4, static_expr: "$('Extract fields').item.json.visit_date" },
  ],
  '46-customer-annual-checkup.json': [
    { position: 1, static_expr: "$('Split project rows').item.json.customer_name" },
    { position: 2, static_expr: "$('Split project rows').item.json.booking_link" },
  ],
  '47-customer-commissioning-complete.json': [
    { position: 1, static_expr: "$('Extract fields').item.json.customer_name" },
    { position: 2, static_expr: "$('Extract fields').item.json.system_size_kwp" },
    { position: 3, static_expr: "$('Extract fields').item.json.commissioned_date" },
    { position: 4, static_expr: "$('Extract fields').item.json.monitoring_link" },
  ],
};

// Meta template names indexed by filename
const META_TEMPLATE_NAMES: Record<string, string> = {
  '40-customer-proposal-sent.json': 'shiroi_cust_proposal_ready',
  '41-customer-order-received.json': 'shiroi_cust_order_received',
  '42-customer-net-metering-applied.json': 'shiroi_cust_net_metering_applied',
  '43-customer-install-milestone.json': 'shiroi_cust_install_milestone',
  '44-customer-payment-reminder.json': 'shiroi_cust_payment_reminder',
  '45-customer-om-ticket-created.json': 'shiroi_cust_om_ticket_created',
  '46-customer-annual-checkup.json': 'shiroi_cust_annual_checkup',
  '47-customer-commissioning-complete.json': 'shiroi_cust_commissioning_complete',
};

// ── Main injection logic ───────────────────────────────────────────────────────

function injectWorkflow(filename: string, config: WorkflowConfig): void {
  const filePath = path.join(WORKFLOW_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const workflow = JSON.parse(raw) as N8nWorkflow;

  // Idempotency guard
  const alreadyInjected = workflow.nodes.some((n) => n.name === 'AI Personalise');
  if (alreadyInjected) {
    console.log(`  [SKIP] ${filename} — "AI Personalise" node already present`);
    return;
  }

  // Find the node we insert after
  const insertAfterNode = workflow.nodes.find((n) => n.name === config.insert_after_node);
  if (!insertAfterNode) {
    console.error(`  [ERROR] ${filename} — could not find node "${config.insert_after_node}"`);
    process.exit(1);
  }

  // Find the Meta Send node
  const metaSendNode = workflow.nodes.find((n) => n.name === config.meta_send_node);
  if (!metaSendNode) {
    console.error(`  [ERROR] ${filename} — could not find node "${config.meta_send_node}"`);
    process.exit(1);
  }

  // Position the new node between insertAfter and metaSend
  const aiPosition: [number, number] = [
    Math.round((insertAfterNode.position[0] + metaSendNode.position[0]) / 2),
    insertAfterNode.position[1],
  ];

  // Shift the Meta Send node and all downstream nodes 250px right to make room
  const insertAfterX = insertAfterNode.position[0];
  for (const node of workflow.nodes) {
    if (node.position[0] > insertAfterX) {
      node.position[0] += 250;
    }
  }

  // Build and insert the AI Personalise node
  const aiNode = buildAiPersonaliseNode(config, aiPosition);
  workflow.nodes.push(aiNode);

  // Rewire connections:
  //   Before: insertAfterNode → metaSendNode
  //   After:  insertAfterNode → AI Personalise → metaSendNode
  const insertAfterConnections = workflow.connections[config.insert_after_node];
  if (insertAfterConnections?.main?.[0]) {
    // Re-point insertAfter → AI Personalise
    insertAfterConnections.main[0] = [
      { node: 'AI Personalise', type: 'main', index: 0 },
    ];
  }

  // AI Personalise → metaSendNode
  workflow.connections['AI Personalise'] = {
    main: [[{ node: config.meta_send_node, type: 'main', index: 0 }]],
  };

  // Update the Meta Send node body to use AI vars with static fallback
  const staticParams = STATIC_PARAMS[filename];
  const metaTemplateName = META_TEMPLATE_NAMES[filename];
  if (staticParams && metaTemplateName) {
    const bodyParam = metaSendNode.parameters.bodyParameters?.parameters?.find(
      (p) => p.name === 'body',
    );
    if (bodyParam) {
      bodyParam.value = buildMetaSendBodyExpr(metaTemplateName, staticParams);
    }
  }

  // Write back
  fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
  console.log(`  [OK]   ${filename} — injected "AI Personalise" node`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

function main(): void {
  console.log('inject-ai-personalise: starting...\n');
  console.log(`Workflow directory: ${WORKFLOW_DIR}\n`);

  let ok = 0;
  let skipped = 0;
  let errors = 0;

  for (const [filename, config] of Object.entries(WORKFLOW_CONFIGS)) {
    const filePath = path.join(WORKFLOW_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.error(`  [MISS] ${filename} — file not found`);
      errors++;
      continue;
    }
    try {
      const before = fs.readFileSync(filePath, 'utf-8');
      injectWorkflow(filename, config);
      const after = fs.readFileSync(filePath, 'utf-8');
      if (before === after) {
        skipped++;
      } else {
        ok++;
      }
    } catch (e) {
      console.error(`  [ERR]  ${filename} — ${e instanceof Error ? e.message : String(e)}`);
      errors++;
    }
  }

  console.log(`\nDone. Modified: ${ok}  Skipped (already injected): ${skipped}  Errors: ${errors}`);
  if (errors > 0) process.exit(1);
}

main();
