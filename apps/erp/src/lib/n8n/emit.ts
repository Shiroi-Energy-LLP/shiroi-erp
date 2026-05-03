/**
 * Single-ingress event bus emitter for n8n.
 *
 * Every ERP state transition fires one of these events. An n8n router workflow
 * (`infrastructure/n8n/workflows/00-event-bus-router.json`) receives the event,
 * switches on the `event` field, and fans out to the appropriate notification
 * workflow. See `docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md`.
 *
 * Fire-and-forget semantics:
 *   - 3-second timeout via AbortSignal — never holds a server action thread
 *   - Errors are logged, NEVER thrown — a failed webhook must not fail the
 *     originating write (e.g. a `createLead` action must succeed even if n8n
 *     is down)
 *   - Unconfigured env vars → silent no-op (dev/local friendly)
 *
 * Env vars:
 *   N8N_EVENT_BUS_URL  — router webhook URL, e.g.
 *                        https://n8n.shiroienergy.com/webhook/erp-event-bus
 *   N8N_WEBHOOK_SECRET — shared secret, sent as x-webhook-secret header and
 *                        matched on the n8n side via Header Auth credential
 */

export type ErpEventName =
  // Sales / leads
  | 'lead.created'
  | 'lead.stage_changed'
  | 'lead.stale_24h'
  | 'lead.quick_quote_sent'
  | 'lead.drive_folder_requested'
  // Design / proposals
  | 'proposal.requested'
  | 'proposal.submitted'
  | 'proposal.approved'
  | 'proposal.rejected'
  // Projects
  | 'project.installation_scheduled'
  | 'project.installation_complete'
  | 'project.commissioned'
  | 'project.milestone_complete'
  // Purchase / finance
  | 'purchase_order.created'
  | 'purchase_order.approved'
  | 'grn.recorded'
  | 'vendor_payment.due'
  | 'customer_payment.received'
  | 'invoice.overdue'
  // O&M
  | 'om_ticket.created'
  | 'om_ticket.resolved'
  | 'ceig_approval.received'
  // HR
  | 'expense_claim.submitted'
  | 'leave_request.submitted'
  | 'employee.created'
  // Compliance
  | 'document.expiring'
  // Meta
  | 'bug_report.submitted'
  | 'workflow.error';

export type ErpEventPayload = Record<string, unknown>;

export async function emitErpEvent(
  event: ErpEventName,
  payload: ErpEventPayload,
): Promise<void> {
  const op = '[emitErpEvent]';
  const webhookUrl = process.env.N8N_EVENT_BUS_URL;
  if (!webhookUrl) return;

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': process.env.N8N_WEBHOOK_SECRET ?? '',
      },
      body: JSON.stringify({
        event,
        emitted_at: new Date().toISOString(),
        payload,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      console.error(`${op} webhook non-2xx`, {
        event,
        status: resp.status,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error(`${op} webhook failure (non-blocking)`, {
      event,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}
