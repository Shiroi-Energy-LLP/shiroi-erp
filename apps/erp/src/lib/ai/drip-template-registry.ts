/**
 * drip-template-registry.ts — static registry of the 8 F1 customer drip templates.
 *
 * Each entry holds:
 *   body            — verbatim template body from templates.md (with {{N}} placeholders)
 *   variable_count  — how many {{N}} placeholders the body contains
 *   meta_name       — Meta template name (snake_case, as submitted to Meta Business Manager)
 *
 * Used by drip-personaliser.ts so it knows the template structure when generating
 * AI variable values without hard-coding the templates inside the personaliser.
 *
 * Source of truth: infrastructure/n8n/templates.md (Phase F1 section).
 * Do NOT edit these bodies independently — they must match what is submitted to Meta.
 */

export type DripTemplateName =
  | 'customer_proposal_sent'
  | 'customer_order_received'
  | 'customer_net_metering_applied'
  | 'customer_install_milestone'
  | 'customer_payment_reminder'
  | 'customer_om_ticket_created'
  | 'customer_annual_checkup'
  | 'customer_commissioning_complete';

export interface DripTemplateEntry {
  /** Meta template identifier (as registered in Meta Business Manager). */
  meta_name: string;
  /** Verbatim body with {{N}} placeholders, as submitted to Meta. */
  body: string;
  /** Number of {{N}} variables in the body. AI must return exactly this many values. */
  variable_count: number;
  /**
   * Describes each variable position so the AI personaliser knows what it is generating.
   * Index 0 = {{1}}, index 1 = {{2}}, etc.
   */
  variable_descriptions: string[];
}

export const DRIP_TEMPLATES: Record<DripTemplateName, DripTemplateEntry> = {
  customer_proposal_sent: {
    meta_name: 'shiroi_cust_proposal_ready',
    body: 'Hi {{1}}, your solar proposal for {{2}} kWp is ready to view.\n\nProposal link: {{3}}\n\nQuestions? Reply here and we\'ll get back to you right away.',
    variable_count: 3,
    variable_descriptions: [
      '{{1}} Customer first name (personalised greeting)',
      '{{2}} System size in kWp (numeric, e.g. "8")',
      '{{3}} Proposal URL link (pass through as-is — do not personalise)',
    ],
  },

  customer_order_received: {
    meta_name: 'shiroi_cust_order_received',
    body: 'Welcome to the Shiroi family, {{1}}!\n\nYour solar installation begins on {{2}}. Your dedicated Project Manager is {{3}} ({{4}}).\n\nFeel free to reach out to them directly for any on-site queries.',
    variable_count: 4,
    variable_descriptions: [
      '{{1}} Customer first name (warm, personalised)',
      '{{2}} Installation start date (formatted, e.g. "15 Jun 2026")',
      '{{3}} Project Manager name',
      '{{4}} PM phone number',
    ],
  },

  customer_net_metering_applied: {
    meta_name: 'shiroi_cust_net_metering_applied',
    body: 'Hi {{1}}, your net metering application has been submitted to the utility.\n\nTypical approval time: 30 days. We\'ll update you at each milestone — application received, inspection scheduled, meter installation.\n\nNo action needed from your side right now.',
    variable_count: 1,
    variable_descriptions: [
      '{{1}} Customer first name (personalised greeting)',
    ],
  },

  customer_install_milestone: {
    meta_name: 'shiroi_cust_install_milestone',
    body: 'Hi {{1}}, great progress on your solar project!\n\nMilestone completed: {{2}}\n\nNext step: {{3}}\n\nWe\'ll keep you updated as work progresses.',
    variable_count: 3,
    variable_descriptions: [
      '{{1}} Customer first name (personalised greeting)',
      '{{2}} Milestone label completed (e.g. "Panels mounted") — can add a warm remark',
      '{{3}} Next step description (e.g. "Inverter installation") — brief, factual',
    ],
  },

  customer_payment_reminder: {
    meta_name: 'shiroi_cust_payment_reminder',
    body: 'Hi {{1}}, a friendly reminder that ₹{{2}} is due by {{3}} for your solar project ({{4}}).\n\nPay securely here: {{5}}\n\nIf you\'ve already paid, please ignore this message.',
    variable_count: 5,
    variable_descriptions: [
      '{{1}} Customer first name (personalised greeting)',
      '{{2}} Amount due in Indian format without ₹ sign (e.g. "1,50,000")',
      '{{3}} Due date (formatted, e.g. "30 Jun 2026")',
      '{{4}} Project reference code (pass through as-is)',
      '{{5}} Payment URL link (pass through as-is — do not personalise)',
    ],
  },

  customer_om_ticket_created: {
    meta_name: 'shiroi_cust_om_ticket_created',
    body: 'Hi {{1}}, we\'ve received your service request (Ticket {{2}}).\n\nOur technician {{3}} will visit on {{4}}. They\'ll call before arriving.\n\nReply here if you need to reschedule.',
    variable_count: 4,
    variable_descriptions: [
      '{{1}} Customer first name (personalised greeting)',
      '{{2}} Ticket number (pass through as-is, e.g. "SVC-042")',
      '{{3}} Technician name',
      '{{4}} Visit date (formatted, e.g. "25 Jun 2026")',
    ],
  },

  customer_annual_checkup: {
    meta_name: 'shiroi_cust_annual_checkup',
    body: 'Hi {{1}}, it\'s been a year since your solar system was commissioned — congratulations!\n\nTime for your free annual health check. Book a slot here: {{2}}\n\nThis ensures your system is running at peak efficiency and any warranty claims are logged on time.',
    variable_count: 2,
    variable_descriptions: [
      '{{1}} Customer first name (warm, personalised — can add a milestone remark)',
      '{{2}} Booking URL link (pass through as-is — do not personalise)',
    ],
  },

  customer_commissioning_complete: {
    meta_name: 'shiroi_cust_commissioning_complete',
    body: 'Congratulations, {{1}}! Your {{2}} kWp solar system is now live as of {{3}}.\n\nTrack your generation in real time: {{4}}\n\nThank you for choosing Shiroi Energy. Welcome to clean energy!',
    variable_count: 4,
    variable_descriptions: [
      '{{1}} Customer first name (celebratory, personalised)',
      '{{2}} System size in kWp (numeric, e.g. "8")',
      '{{3}} Commissioned date (formatted, e.g. "15 Jun 2026")',
      '{{4}} Monitoring portal URL (pass through as-is — do not personalise)',
    ],
  },
};
