'use client';

/**
 * Send RFQ Modal (Tab 2 post-create).
 *
 * Renders after a successful `createRfqWithInvitations` server action. Shows one
 * row per vendor invitation with:
 *   - Gmail compose deep-link (disabled if vendor has no email)
 *   - WhatsApp wa.me deep-link (disabled if vendor has no phone)
 *   - Copy-link button (falls back if neither channel available)
 *   - Status pill showing whether the invitation has been marked sent via any channel
 *
 * Every channel click calls `markInvitationSent(invitationId, channel)` in the
 * background so we get per-channel audit trail and the UI can show confirmation
 * that "the engineer at least attempted to contact this vendor through this channel".
 *
 * No OAuth / SMTP — the engineer completes the send in their own Gmail/WhatsApp
 * tab. Gmail pre-fills everything; WhatsApp pre-fills the message.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Badge,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { Mail, MessageCircle, Copy, Check, ExternalLink } from 'lucide-react';
import type { Database } from '@repo/types/database';
import {
  buildGmailComposeUrl,
  buildWhatsAppUrl,
  buildRfqEmailSubject,
  buildRfqEmailBody,
  buildRfqWhatsAppText,
} from '@/lib/gmail-whatsapp-links';
import { markInvitationSent } from '@/lib/rfq-actions';

type RfqInvitation = Database['public']['Tables']['rfq_invitations']['Row'];

interface SendRfqModalProps {
  rfqId: string;
  invitations: RfqInvitation[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  projectName: string;
  onClose: () => void;
}

interface ChannelState {
  email: boolean;
  whatsapp: boolean;
  copy_link: boolean;
}

function buildPortalUrl(token: string): string {
  // Works in browser — falls back to the ERP's canonical host at build time.
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/vendor-portal/rfq/${token}`;
  }
  return `https://erp.shiroienergy.com/vendor-portal/rfq/${token}`;
}

function rfqNumberFromInvitation(inv: RfqInvitation): string {
  // The RFQ number isn't on the invitation row — we display the access_token
  // short code as a disambiguator in the email body. The real rfq_number is
  // rendered in the RFQ list on the parent page.
  return `RFQ-${inv.rfq_id.slice(0, 8)}`;
}

export function SendRfqModal({
  rfqId: _rfqId,
  invitations,
  vendors,
  projectName,
  onClose,
}: SendRfqModalProps) {
  // Track which channels have been clicked per invitation (local only — the
  // server action is fire-and-forget; any open channel stays toggled in this
  // session regardless of network).
  const [clickedChannels, setClickedChannels] = React.useState<Record<string, ChannelState>>({});
  const [copiedInvitationId, setCopiedInvitationId] = React.useState<string | null>(null);

  // Build a vendor lookup by id so we don't loop inside the render.
  const vendorById = React.useMemo(() => {
    const m = new Map<string, { id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>();
    for (const v of vendors) m.set(v.id, v);
    return m;
  }, [vendors]);

  function markChannelClicked(invitationId: string, channel: 'email' | 'whatsapp' | 'copy_link') {
    setClickedChannels((prev) => {
      const cur = prev[invitationId] ?? { email: false, whatsapp: false, copy_link: false };
      return { ...prev, [invitationId]: { ...cur, [channel]: true } };
    });
    // Fire-and-forget server action — we don't block the UI.
    void markInvitationSent(invitationId, channel).catch((e) => {
      console.error('[SendRfqModal] markInvitationSent failed', { invitationId, channel, e });
    });
  }

  async function handleCopyLink(invitation: RfqInvitation) {
    const portalUrl = buildPortalUrl(invitation.access_token);
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopiedInvitationId(invitation.id);
      window.setTimeout(() => setCopiedInvitationId((id) => (id === invitation.id ? null : id)), 2000);
      markChannelClicked(invitation.id, 'copy_link');
    } catch (e) {
      console.error('[SendRfqModal] Clipboard write failed', e);
      // Older browsers — user can still select-copy from the portal URL shown below
    }
  }

  function handleOpenGmail(invitation: RfqInvitation, vendorEmail: string, vendorName: string) {
    const portalUrl = buildPortalUrl(invitation.access_token);
    const rfqNumber = rfqNumberFromInvitation(invitation);
    const deadline = formatDate(invitation.expires_at);
    const url = buildGmailComposeUrl({
      to: vendorEmail,
      subject: buildRfqEmailSubject(rfqNumber, projectName || 'Shiroi project'),
      body: buildRfqEmailBody({
        vendorName,
        rfqNumber,
        projectName: projectName || 'Shiroi project',
        deadline,
        portalUrl,
      }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    markChannelClicked(invitation.id, 'email');
  }

  function handleOpenWhatsApp(invitation: RfqInvitation, vendorPhone: string, vendorName: string) {
    const portalUrl = buildPortalUrl(invitation.access_token);
    const rfqNumber = rfqNumberFromInvitation(invitation);
    const deadline = formatDate(invitation.expires_at);
    const url = buildWhatsAppUrl({
      phone: vendorPhone,
      text: buildRfqWhatsAppText({ vendorName, rfqNumber, portalUrl, deadline }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    markChannelClicked(invitation.id, 'whatsapp');
  }

  const anySent = invitations.some((inv) => {
    const state = clickedChannels[inv.id];
    return state && (state.email || state.whatsapp || state.copy_link);
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Send RFQ to {invitations.length} vendor{invitations.length === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Click Gmail or WhatsApp to open a pre-filled message in a new tab. Copy link
            hands you the portal URL if you prefer another channel. Every click is logged.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-n-200 rounded max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-n-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left text-[10px] font-semibold text-n-500 uppercase">Vendor</th>
                <th className="px-2 py-2 text-left text-[10px] font-semibold text-n-500 uppercase">Channels</th>
                <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">Send</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const vendor = vendorById.get(inv.vendor_id);
                if (!vendor) {
                  return (
                    <tr key={inv.id} className="border-t border-n-100">
                      <td className="px-2 py-2 text-red-600">Unknown vendor ({inv.vendor_id.slice(0, 8)})</td>
                      <td className="px-2 py-2 text-n-500">—</td>
                      <td className="px-2 py-2" />
                    </tr>
                  );
                }
                const state = clickedChannels[inv.id] ?? { email: false, whatsapp: false, copy_link: false };
                const hasAny = state.email || state.whatsapp || state.copy_link;

                return (
                  <tr key={inv.id} className="border-t border-n-100 align-top">
                    <td className="px-2 py-2">
                      <div className="font-medium text-n-800">{vendor.company_name}</div>
                      {vendor.contact_person && (
                        <div className="text-[10px] text-n-500">{vendor.contact_person}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3 text-n-400" />
                          <span className={vendor.email ? 'text-n-700' : 'text-n-400 italic'}>
                            {vendor.email ?? 'no email on file'}
                          </span>
                          {state.email && <Check className="h-3 w-3 text-green-600" />}
                        </div>
                        <div className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3 text-n-400" />
                          <span className={vendor.phone ? 'text-n-700' : 'text-n-400 italic'}>
                            {vendor.phone ?? 'no phone on file'}
                          </span>
                          {state.whatsapp && <Check className="h-3 w-3 text-green-600" />}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="inline-flex flex-wrap gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-1.5 gap-1"
                          disabled={!vendor.email}
                          title={vendor.email ? 'Opens Gmail compose in new tab' : 'No email on file'}
                          onClick={() => vendor.email && handleOpenGmail(inv, vendor.email, vendor.company_name)}
                        >
                          <Mail className="h-3 w-3" />
                          Gmail
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-1.5 gap-1"
                          disabled={!vendor.phone}
                          title={vendor.phone ? 'Opens WhatsApp in new tab' : 'No phone on file'}
                          onClick={() => vendor.phone && handleOpenWhatsApp(inv, vendor.phone, vendor.company_name)}
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-1.5 gap-1"
                          onClick={() => handleCopyLink(inv)}
                        >
                          {copiedInvitationId === inv.id ? (
                            <>
                              <Check className="h-3 w-3 text-green-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy link
                            </>
                          )}
                        </Button>
                      </div>
                      {hasAny && (
                        <Badge variant="secondary" className="mt-1 h-4 px-1 text-[9px] bg-green-100 text-green-700">
                          Sent
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-n-500">
          Each invitation has its own unique portal link (access token). Vendors submit quotes
          without logging in. You can re-open this dialog later from the RFQ detail page.
        </p>

        <DialogFooter>
          <Button
            size="sm"
            variant={anySent ? 'default' : 'outline'}
            onClick={onClose}
            className="h-8 text-[11px]"
          >
            {anySent ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
