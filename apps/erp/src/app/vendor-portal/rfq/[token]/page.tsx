/**
 * Vendor Portal — RFQ quote submission page.
 *
 * This page is public: no auth, no layout chrome from (erp).
 * Middleware excludes /vendor-portal/* from the auth matcher.
 */

import { validateToken, type PublicRfqShape } from '@/lib/vendor-portal-queries';
import { markInvitationViewed } from '@/lib/vendor-portal-actions';
import { QuoteSubmitForm } from './_client/quote-submit-form';

type PageProps = { params: { token: string } };

export default async function VendorPortalRfqPage({ params }: PageProps) {
  const validation = await validateToken(params.token);

  if (!validation.ok) {
    if (validation.reason === 'expired') {
      return (
        <VendorPortalFrame title="Link expired">
          <p className="text-slate-600">
            This RFQ link has expired. Please contact Shiroi Energy if you need a new invitation.
          </p>
        </VendorPortalFrame>
      );
    }
    return (
      <VendorPortalFrame title="Invalid link">
        <p className="text-slate-600">
          This link is not valid. Please check your email or message for the correct URL.
        </p>
      </VendorPortalFrame>
    );
  }

  if (validation.alreadySubmitted) {
    return (
      <VendorPortalFrame title={`Quote received — RFQ ${validation.rfq.rfqNumber}`}>
        <p className="mb-6 text-slate-600">
          Thank you — we&apos;ve already received your quote for RFQ{' '}
          <strong>{validation.rfq.rfqNumber}</strong>. Our team will review it and get back to you.
        </p>
        <RfqHeader rfq={validation.rfq} />
        <ReadOnlyQuoteSummary rfq={validation.rfq} />
      </VendorPortalFrame>
    );
  }

  // Fire-and-forget: mark the invitation as viewed. Errors here must not
  // break the page render.
  try {
    await markInvitationViewed(params.token);
  } catch {
    // Already swallowed inside the action, but double-guard the render path.
  }

  return (
    <VendorPortalFrame title={`Submit quote — RFQ ${validation.rfq.rfqNumber}`}>
      <RfqHeader rfq={validation.rfq} />
      <div className="mt-6">
        <QuoteSubmitForm token={params.token} rfq={validation.rfq} />
      </div>
    </VendorPortalFrame>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Inline sub-components
// ──────────────────────────────────────────────────────────────────────

function VendorPortalFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold text-emerald-700">Shiroi Energy</span>
          <span className="text-xs text-slate-500">Procurement Portal</span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">{title}</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
      <footer className="mx-auto max-w-4xl px-6 py-6 text-center text-xs text-slate-400">
        © Shiroi Energy LLP · Chennai
      </footer>
    </main>
  );
}

function RfqHeader({ rfq }: { rfq: PublicRfqShape }) {
  const deadline = new Date(rfq.deadline).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <dl className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-4 text-sm md:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">RFQ Number</dt>
        <dd className="mt-1 font-medium">{rfq.rfqNumber}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Project</dt>
        <dd className="mt-1 font-medium">{rfq.projectName}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Vendor</dt>
        <dd className="mt-1 font-medium">{rfq.vendorName}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Deadline</dt>
        <dd className="mt-1 font-medium text-amber-700">{deadline}</dd>
      </div>
      {rfq.notes ? (
        <div className="col-span-full mt-2 rounded-md bg-slate-50 p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Notes from Shiroi</dt>
          <dd className="mt-1 whitespace-pre-wrap text-slate-700">{rfq.notes}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function ReadOnlyQuoteSummary({ rfq }: { rfq: PublicRfqShape }) {
  if (!rfq.submittedQuotes || rfq.submittedQuotes.length === 0) {
    return null;
  }
  const quoteByItem = new Map(rfq.submittedQuotes.map((q) => [q.rfq_item_id, q]));

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Item</th>
            <th className="py-2 pr-3">Qty</th>
            <th className="py-2 pr-3">Unit</th>
            <th className="py-2 pr-3 text-right">Unit Price</th>
            <th className="py-2 pr-3 text-right">GST %</th>
            <th className="py-2 pr-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rfq.items.map((item, idx) => {
            const q = quoteByItem.get(item.id);
            return (
              <tr key={item.id} className="border-b border-slate-50">
                <td className="py-2 pr-3 text-slate-500">{idx + 1}</td>
                <td className="py-2 pr-3">{item.item_description}</td>
                <td className="py-2 pr-3">{item.quantity}</td>
                <td className="py-2 pr-3">{item.unit}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {q ? formatINR(Number(q.unit_price)) : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {q ? `${Number(q.gst_rate).toFixed(1)}%` : '—'}
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">
                  {q ? formatINR(Number(q.total_price)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
