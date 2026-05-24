/**
 * POST /api/drip/personalise
 *
 * Called by n8n drip workflows (40–47) before firing the Meta WhatsApp template.
 * Generates AI-personalised variable values for the specified template via Claude Haiku.
 *
 * Auth: x-webhook-secret header (same secret used by all n8n → ERP webhook calls).
 *
 * Request body:
 * {
 *   queue_id:        string,              // customer_outreach_queue.id — for audit
 *   template_name:   DripTemplateName,    // e.g. "customer_proposal_sent"
 *   customer_context: {
 *     customer_name:     string,
 *     customer_segment?: string,          // defaults to "residential"
 *     project_number:    string,          // used as project_id for history lookup
 *     pass_through?:     Record<string, string>,  // key = "1"|"2"... value = exact string
 *     [key: string]:     unknown,         // any extra context forwarded to AI
 *   }
 * }
 *
 * Response (200):
 * {
 *   vars: string[],                       // ordered variable values: [v1, v2, v3, ...]
 *   ai_model: string,
 *   ai_tokens_in: number,
 *   ai_tokens_out: number
 * }
 *
 * On AI failure the route returns 500 and n8n's continueOnFail causes the workflow
 * to fall back to static variable substitution.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  personaliseDripMessage,
  type DripTemplateName,
} from '@/lib/ai/drip-personaliser';
import { DRIP_TEMPLATES } from '@/lib/ai/drip-template-registry';

// ── Request shape ──────────────────────────────────────────────────────────────

interface PersonaliseRequestBody {
  queue_id: string;
  template_name: DripTemplateName;
  customer_context: {
    customer_name: string;
    customer_segment?: string;
    project_number: string;
    /** Variable positions (1-based) that must be passed through unchanged. */
    pass_through?: Record<string, string>;
    [key: string]: unknown;
  };
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const op = '[POST /api/drip/personalise]';

  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret || !secret || secret !== expectedSecret) {
    console.warn(`${op} unauthorized — secret mismatch`, {
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: PersonaliseRequestBody;
  try {
    body = (await req.json()) as PersonaliseRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { queue_id, template_name, customer_context } = body;

  if (!queue_id || typeof queue_id !== 'string') {
    return NextResponse.json({ error: 'queue_id is required' }, { status: 400 });
  }

  if (!template_name || !(template_name in DRIP_TEMPLATES)) {
    return NextResponse.json(
      {
        error: `template_name must be one of: ${Object.keys(DRIP_TEMPLATES).join(', ')}`,
      },
      { status: 400 },
    );
  }

  if (!customer_context?.customer_name || !customer_context?.project_number) {
    return NextResponse.json(
      { error: 'customer_context.customer_name and customer_context.project_number are required' },
      { status: 400 },
    );
  }

  // ── Build pass-through map (string keys → number keys) ────────────────────
  const passThroughRaw = customer_context.pass_through ?? {};
  const passThrough: Record<number, string> = {};
  for (const [k, v] of Object.entries(passThroughRaw)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx) && typeof v === 'string') {
      passThrough[idx] = v;
    }
  }

  // ── Build context overrides (everything except known keys) ─────────────────
  const { customer_name, customer_segment, project_number, pass_through: _pt, ...rest } =
    customer_context;
  const contextOverrides: Record<string, unknown> = rest;

  console.log(`${op} starting`, {
    queue_id,
    template_name,
    customer_name,
    project_number,
    timestamp: new Date().toISOString(),
  });

  // ── Personalise ────────────────────────────────────────────────────────────
  const result = await personaliseDripMessage(queue_id, {
    templateName: template_name,
    customerName: customer_name,
    customerSegment: customer_segment ?? 'residential',
    projectNumber: project_number,
    passThrough: Object.keys(passThrough).length > 0 ? passThrough : undefined,
    contextOverrides: Object.keys(contextOverrides).length > 0 ? contextOverrides : undefined,
  });

  if (!result.success) {
    console.error(`${op} personaliseDripMessage failed`, {
      queue_id,
      template_name,
      error: result.error,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const { vars, ai_tokens_in, ai_tokens_out, ai_model } = result.data;

  console.log(`${op} success`, {
    queue_id,
    template_name,
    var_count: vars.length,
    ai_tokens_in,
    ai_tokens_out,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    vars,
    ai_model,
    ai_tokens_in,
    ai_tokens_out,
  });
}

export const dynamic = 'force-dynamic';
