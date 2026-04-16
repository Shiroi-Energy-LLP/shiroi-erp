// ═══════════════════════════════════════════════════════════════════════
// Gmail + WhatsApp deep-link builders
//
// Pure functions — no side effects, no Supabase, no async.
// Generates deep links that the engineer opens in their own browser tab
// (no OAuth / SMTP / API key required).
// ═══════════════════════════════════════════════════════════════════════

export function buildGmailComposeUrl(input: {
  to: string;
  subject: string;
  body: string;
}): string {
  return (
    'https://mail.google.com/mail/?view=cm&fs=1' +
    `&to=${encodeURIComponent(input.to)}` +
    `&su=${encodeURIComponent(input.subject)}` +
    `&body=${encodeURIComponent(input.body)}`
  );
}

export function buildWhatsAppUrl(input: {
  phone: string;
  text: string;
}): string {
  // Strip all non-digit characters
  let digits = input.phone.replace(/\D/g, '');
  // Prepend India country code if not already present
  if (!digits.startsWith('91') && digits.length === 10) {
    digits = '91' + digits;
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(input.text)}`;
}

export function buildRfqEmailSubject(
  rfqNumber: string,
  projectName: string,
): string {
  return `RFQ ${rfqNumber} — ${projectName} — Shiroi Energy`;
}

export function buildRfqEmailBody(input: {
  vendorName: string;
  rfqNumber: string;
  projectName: string;
  deadline: string;
  portalUrl: string;
}): string {
  return `Dear ${input.vendorName},

Shiroi Energy is requesting a quote for the following materials for our project "${input.projectName}".

Please submit your quote via the secure portal:
${input.portalUrl}

Deadline: ${input.deadline}

The portal will walk you through item-by-item pricing, payment terms, and delivery period. Your response is saved automatically.

For any questions, reply to this email.

Regards,
Shiroi Energy Procurement Team`;
}

export function buildRfqWhatsAppText(input: {
  vendorName: string;
  rfqNumber: string;
  portalUrl: string;
  deadline: string;
}): string {
  return `Hi ${input.vendorName}, Shiroi Energy has a new RFQ for you. RFQ ${input.rfqNumber}, deadline ${input.deadline}. Please submit your quote here: ${input.portalUrl}`;
}

export function buildPoEmailBody(input: {
  vendorName: string;
  poNumber: string;
  projectName: string;
  portalUrl?: string;
  pdfUrl?: string;
}): string {
  const portalLine = input.portalUrl
    ? `\nYou can view and acknowledge the PO via our vendor portal:\n${input.portalUrl}\n`
    : '';
  const pdfLine = input.pdfUrl
    ? `\nDownload PDF: ${input.pdfUrl}\n`
    : '';

  return `Dear ${input.vendorName},

Please find attached the Purchase Order ${input.poNumber} for our project "${input.projectName}".
${portalLine}${pdfLine}
Kindly acknowledge receipt and confirm the expected delivery date at your earliest convenience.

For any questions or clarifications, please reply to this email.

Regards,
Shiroi Energy Procurement Team`;
}
