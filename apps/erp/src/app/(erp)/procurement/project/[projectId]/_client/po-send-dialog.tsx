'use client';

/**
 * PO Send dialog (Phase 5 feedback).
 *
 * Per-PO channel picker — Email (Gmail compose) / WhatsApp / Copy link.
 * Fires the `sendPOToVendor` server action on click so the PO is flagged
 * as "sent to vendor" (sets `sent_to_vendor_at` + appends channel to
 * `sent_via_channels`) and moves to Tab 5's dispatch board.
 *
 * Mirrors the behaviour of <InvitationActionButtons> but for POs instead
 * of RFQ invitations.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui';
import { Mail, MessageCircle, Copy, Check, Send } from 'lucide-react';
import {
  buildGmailComposeUrl,
  buildWhatsAppUrl,
  buildPoEmailSubject,
  buildPoEmailBody,
  buildPoWhatsAppText,
} from '@/lib/gmail-whatsapp-links';
import { sendPOToVendor } from '@/lib/po-actions';

interface POSendDialogProps {
  po: {
    id: string;
    po_number: string;
    total_amount: number;
    project_name: string;
  };
  vendor: {
    company_name: string;
    email: string | null;
    phone: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function buildPoPortalUrl(poId: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/procurement/${poId}`;
  }
  return `https://erp.shiroienergy.com/procurement/${poId}`;
}

export function POSendDialog({ po, vendor, open, onOpenChange }: POSendDialogProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'email' | 'whatsapp' | 'copy_link' | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function fire(channel: 'email' | 'whatsapp' | 'copy_link') {
    setError(null);
    setBusy(channel);
    const res = await sendPOToVendor({ poId: po.id, channel });
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleEmail() {
    if (!vendor.email) return;
    const url = buildGmailComposeUrl({
      to: vendor.email,
      subject: buildPoEmailSubject(po.po_number, po.project_name),
      body: buildPoEmailBody({
        vendorName: vendor.company_name,
        poNumber: po.po_number,
        projectName: po.project_name,
        portalUrl: buildPoPortalUrl(po.id),
      }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    await fire('email');
  }

  async function handleWhatsApp() {
    if (!vendor.phone) return;
    const url = buildWhatsAppUrl({
      phone: vendor.phone,
      text: buildPoWhatsAppText({
        vendorName: vendor.company_name,
        poNumber: po.po_number,
        projectName: po.project_name,
        totalAmount: Number(po.total_amount),
        portalUrl: buildPoPortalUrl(po.id),
      }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    await fire('whatsapp');
  }

  async function handleCopy() {
    const portalUrl = buildPoPortalUrl(po.id);
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API may be blocked — fall through and still fire the action
    }
    await fire('copy_link');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-1.5">
            <Send className="h-4 w-4 text-p-600" />
            Send PO {po.po_number} to {vendor.company_name}
          </DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Pick a channel below. Clicking fires the compose screen and logs
            the channel on the PO audit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <button
            type="button"
            disabled={!vendor.email || busy !== null}
            onClick={handleEmail}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-[11px] rounded border border-n-200 hover:bg-n-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-n-600" />
              <span className="font-medium text-n-800">Email via Gmail</span>
            </span>
            <span className="text-n-500">
              {vendor.email ?? 'No email on file'}
            </span>
          </button>

          <button
            type="button"
            disabled={!vendor.phone || busy !== null}
            onClick={handleWhatsApp}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-[11px] rounded border border-n-200 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-1.5">
              <MessageCircle className="h-3.5 w-3.5 text-green-700" />
              <span className="font-medium text-n-800">WhatsApp</span>
            </span>
            <span className="text-n-500">
              {vendor.phone ?? 'No phone on file'}
            </span>
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={handleCopy}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-[11px] rounded border border-n-200 hover:bg-n-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-1.5">
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-n-600" />
              )}
              <span className="font-medium text-n-800">
                {copied ? 'Link copied' : 'Copy PO link'}
              </span>
            </span>
            <span className="text-n-500">Use with any channel</span>
          </button>
        </div>

        {error && <p className="text-[11px] text-red-600">{error}</p>}

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[11px]"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
