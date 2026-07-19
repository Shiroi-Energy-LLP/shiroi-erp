'use client';

import { useState, useTransition } from 'react';
import { CheckCircle, Download, MessageCircle, Sun, Zap, Calendar } from 'lucide-react';
import { Button, useToast } from '@repo/ui';
import { acceptProposalFromPortal } from '@/lib/proposal-share-actions';

interface ProposalData {
  proposalNumber: string;
  systemSizeKw: number;
  totalAfterDiscount: number;
  status: string;
  customerName: string;
  city: string;
  segment: string;
  createdAt: string;
  expiresAt: string;
}

interface Props {
  proposal: ProposalData;
  formatINR: (n: number) => string;
  token: string;
}

// Pulled from public env var at build time so we don't hardcode a fake number.
// Set NEXT_PUBLIC_SHIROI_WHATSAPP in .env.local (e.g. '+919444414087').
// Falls back to an empty string — the UI hides the WA button when not set.
const SHIROI_WHATSAPP = process.env.NEXT_PUBLIC_SHIROI_WHATSAPP ?? '';
const SHIROI_PHONE_DISPLAY = SHIROI_WHATSAPP
  ? SHIROI_WHATSAPP.replace(/^\+?91/, '+91 ').replace(/(\d{5})(\d{5})/, '$1 $2')
  : '';

export function ProposalPortalClient({ proposal, formatINR, token }: Props) {
  const [accepted, setAccepted] = useState(proposal.status === 'approved');
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  const expiryDate = new Date(proposal.expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const proposalDate = new Date(proposal.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const whatsappMessage = encodeURIComponent(
    `Hi Shiroi Energy, I've reviewed my solar proposal ${proposal.proposalNumber}. `,
  );
  const whatsappUrl = `https://wa.me/${SHIROI_WHATSAPP.replace(/\D/g, '')}?text=${whatsappMessage}`;

  const pdfUrl = `/p/${token}/pdf`;

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptProposalFromPortal(token);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not record acceptance',
          description: result.error,
        });
        return;
      }
      setAccepted(true);
      addToast({
        variant: 'success',
        title: 'Proposal accepted',
        description: 'Our team will reach out to you shortly to proceed.',
      });
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-shiroi-gold flex items-center justify-center text-shiroi-ink">
            <Sun className="h-5 w-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Shiroi Energy</span>
          <span className="ml-auto text-xs text-muted-foreground">Solar EPC · Chennai</span>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        {/* Greeting */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Solar proposal for</p>
          <h1 className="text-3xl font-bold">{proposal.customerName}</h1>
          <p className="text-muted-foreground">{proposal.city}</p>
        </div>

        {/* Proposal summary card */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Proposal reference</span>
            <span className="font-mono text-sm font-medium">{proposal.proposalNumber}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Proposal date</span>
            <span className="text-sm font-medium">{proposalDate}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Link valid until</span>
            <div className="flex items-center gap-1.5 text-sm">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {expiryDate}
            </div>
          </div>
          <hr />
          {/* System size */}
          <div className="flex items-center gap-4 rounded-xl bg-amber-50 p-4">
            <Zap className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-sm text-muted-foreground">Proposed system size</p>
              <p className="text-2xl font-bold">{proposal.systemSizeKw} kWp</p>
            </div>
          </div>
          {/* Total */}
          <div className="rounded-xl bg-slate-50 p-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Total project cost</p>
            <p className="text-2xl font-bold">{formatINR(proposal.totalAfterDiscount)}</p>
          </div>
        </div>

        {/* Accept / reject */}
        {accepted ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-6 flex items-center gap-4">
            <CheckCircle className="h-8 w-8 text-green-600 shrink-0" />
            <div>
              <p className="font-semibold text-green-800">Proposal accepted</p>
              <p className="text-sm text-green-700 mt-0.5">
                Our team will contact you within 24 hours to discuss next steps.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border bg-white p-6 space-y-4">
            <p className="font-semibold">Ready to go solar?</p>
            <p className="text-sm text-muted-foreground">
              Accept the proposal and our team will reach out to schedule the next steps — site
              survey, payment plan, and installation timeline.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button className="flex-1" onClick={handleAccept} disabled={isPending}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {isPending ? 'Recording…' : 'Accept proposal'}
              </Button>
              {SHIROI_WHATSAPP && (
                <Button variant="outline" className="flex-1" asChild>
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4 mr-2" /> Ask a question
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Download */}
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" asChild>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4 mr-2" /> Download PDF
            </a>
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pb-6">
          This proposal was prepared by Shiroi Energy LLP · Chennai, Tamil Nadu · shiroienergy.com
          {SHIROI_PHONE_DISPLAY && (
            <>
              <br />
              Questions? WhatsApp us or call {SHIROI_PHONE_DISPLAY}
            </>
          )}
        </p>
      </main>
    </div>
  );
}
