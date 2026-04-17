'use client';

/**
 * InvitationActionButtons — per-invitation Gmail / WhatsApp / Copy-link row.
 *
 * Extracted from send-rfq-modal.tsx so it can be re-used in the expandable
 * RFQ list (tab-rfq.tsx) without duplicating URL-builder logic.
 */

import * as React from 'react';
import { Mail, MessageCircle, Copy, Check } from 'lucide-react';
import {
  buildGmailComposeUrl,
  buildWhatsAppUrl,
  buildRfqEmailSubject,
  buildRfqEmailBody,
  buildRfqWhatsAppText,
} from '@/lib/gmail-whatsapp-links';
import { markInvitationSent } from '@/lib/rfq-actions';
import { formatDate } from '@repo/ui/formatters';

interface InvitationActionButtonsProps {
  invitation: {
    id: string;
    access_token: string;
    expires_at: string | null;
  };
  vendor: {
    company_name: string;
    email?: string | null;
    phone?: string | null;
  };
  rfqNumber?: string;
  projectName?: string;
}

function buildPortalUrl(token: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/vendor-portal/rfq/${token}`;
  }
  return `https://erp.shiroienergy.com/vendor-portal/rfq/${token}`;
}

export function InvitationActionButtons({
  invitation,
  vendor,
  rfqNumber = 'RFQ',
  projectName = 'Shiroi project',
}: InvitationActionButtonsProps) {
  const [copied, setCopied] = React.useState(false);

  function fire(channel: 'email' | 'whatsapp' | 'copy_link') {
    void markInvitationSent(invitation.id, channel).catch((e) => {
      console.error('[InvitationActionButtons] markInvitationSent failed', { channel, e });
    });
  }

  function handleGmail() {
    if (!vendor.email) return;
    const portalUrl = buildPortalUrl(invitation.access_token);
    const deadline = invitation.expires_at ? formatDate(invitation.expires_at) : 'TBD';
    const url = buildGmailComposeUrl({
      to: vendor.email,
      subject: buildRfqEmailSubject(rfqNumber, projectName),
      body: buildRfqEmailBody({ vendorName: vendor.company_name, rfqNumber, projectName, deadline, portalUrl }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    fire('email');
  }

  function handleWhatsApp() {
    if (!vendor.phone) return;
    const portalUrl = buildPortalUrl(invitation.access_token);
    const deadline = invitation.expires_at ? formatDate(invitation.expires_at) : 'TBD';
    const url = buildWhatsAppUrl({
      phone: vendor.phone,
      text: buildRfqWhatsAppText({ vendorName: vendor.company_name, rfqNumber, portalUrl, deadline }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    fire('whatsapp');
  }

  async function handleCopy() {
    const portalUrl = buildPortalUrl(invitation.access_token);
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: no-op
    }
    fire('copy_link');
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        title={vendor.email ? `Email ${vendor.company_name}` : 'No email on file'}
        disabled={!vendor.email}
        onClick={handleGmail}
        className="inline-flex items-center gap-0.5 h-5 px-1.5 text-[10px] rounded border border-n-200 text-n-700 hover:bg-n-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Mail className="h-2.5 w-2.5" /> Gmail
      </button>
      <button
        title={vendor.phone ? `WhatsApp ${vendor.company_name}` : 'No phone on file'}
        disabled={!vendor.phone}
        onClick={handleWhatsApp}
        className="inline-flex items-center gap-0.5 h-5 px-1.5 text-[10px] rounded border border-n-200 text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <MessageCircle className="h-2.5 w-2.5" /> WA
      </button>
      <button
        title="Copy portal link"
        onClick={handleCopy}
        className="inline-flex items-center gap-0.5 h-5 px-1.5 text-[10px] rounded border border-n-200 text-n-600 hover:bg-n-50"
      >
        {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
        {copied ? 'Copied' : 'Link'}
      </button>
    </div>
  );
}
