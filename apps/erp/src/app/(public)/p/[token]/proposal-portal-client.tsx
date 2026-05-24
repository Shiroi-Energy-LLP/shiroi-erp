'use client';

import { useState } from 'react';
import { CheckCircle, Download, MessageCircle, Sun, Zap, Calendar } from 'lucide-react';
import { Button } from '@repo/ui';
import { toast } from 'sonner';

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

const SHIROI_WHATSAPP = '+919876543210'; // Will be overridden by system settings in production

export function ProposalPortalClient({ proposal, formatINR, token }: Props) {
  const [accepted, setAccepted] = useState(proposal.status === 'approved');

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

  const pdfUrl = `/api/proposals/${token}/pdf`;

  function handleAccept() {
    setAccepted(true);
    toast.success('Thank you! Our team will reach out to you shortly to proceed.');
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-amber-400 flex items-center justify-center">
            <Sun className="h-5 w-5 text-amber-900" />
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
              <Button className="flex-1" onClick={handleAccept}>
                <CheckCircle className="h-4 w-4 mr-2" /> Accept proposal
              </Button>
              <Button variant="outline" className="flex-1" asChild>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4 mr-2" /> Ask a question
                </a>
              </Button>
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
          <br />
          Questions? WhatsApp us or call +91 98765 43210
        </p>
      </main>
    </div>
  );
}
