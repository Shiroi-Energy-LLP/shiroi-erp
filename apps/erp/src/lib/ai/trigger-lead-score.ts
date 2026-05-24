/**
 * trigger-lead-score.ts — client-side fire-and-forget helper.
 *
 * Calls POST /api/leads/score with the webhook secret from the public
 * NEXT_PUBLIC_LEAD_SCORE_SECRET env var (an ERP-internal, non-sensitive
 * key — it's the same N8N_WEBHOOK_SECRET exposed to n8n, not a user secret).
 *
 * Because this runs in the browser, we can only use NEXT_PUBLIC_ env vars.
 * The route validates the same secret server-side via N8N_WEBHOOK_SECRET.
 *
 * Usage (fire-and-forget — NEVER await):
 *   void triggerLeadScore(leadId);
 *
 * Note: if N8N_WEBHOOK_SECRET is not set server-side, the route returns 401
 * and the error is silently logged — scoring is non-critical, never blocks UX.
 */

export function triggerLeadScore(leadId: string): void {
  const op = '[triggerLeadScore]';
  const secret = process.env.NEXT_PUBLIC_LEAD_SCORE_SECRET ?? '';

  if (!secret) {
    // In dev with no secret configured: skip silently (scoring is best-effort)
    console.warn(`${op} NEXT_PUBLIC_LEAD_SCORE_SECRET not set — lead scoring skipped for ${leadId}`);
    return;
  }

  fetch('/api/leads/score', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': secret,
    },
    body: JSON.stringify({ lead_id: leadId }),
    signal: AbortSignal.timeout(15_000), // 15s — AI inference can be slow
  }).catch((e: unknown) => {
    // Non-blocking: scoring failure must never surface as a UI error
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} fetch failed (non-blocking)`, {
      leadId,
      error: msg,
      timestamp: new Date().toISOString(),
    });
  });
}
