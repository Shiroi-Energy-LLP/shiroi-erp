'use client';

/**
 * Tab 2 — RFQ: create + track outbound RFQs.
 *
 * Expandable parent rows (per-RFQ) → invitation-level children (per vendor).
 * Each child row: Vendor Name | Category | Items | Created | Deadline | Status | Actions.
 */

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { FileText, Send, ChevronDown, ChevronRight } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import type { RfqSummary } from '@/lib/rfq-queries';
import { SendRfqPanel } from '../_client/send-rfq-panel';
import { InvitationActionButtons } from '../_client/invitation-action-buttons';

type AppRole = Database['public']['Enums']['app_role'];

interface TabRfqProps {
  projectId: string;
  items: PurchaseDetailItem[];
  rfqs: RfqSummary[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  viewerRole: AppRole;
}

function RfqStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-n-100 text-n-700' },
    sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700' },
    comparing: { label: 'Comparing', className: 'bg-amber-100 text-amber-700' },
    awarded: { label: 'Awarded', className: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700' },
    expired: { label: 'Expired', className: 'bg-n-200 text-n-600' },
  };
  const c = config[status] ?? { label: status, className: 'bg-n-100 text-n-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

function InvStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-n-100 text-n-600' },
    sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700' },
    viewed: { label: 'Viewed', className: 'bg-sky-100 text-sky-700' },
    submitted: { label: 'Submitted', className: 'bg-green-100 text-green-700' },
    declined: { label: 'Declined', className: 'bg-red-100 text-red-700' },
    expired: { label: 'Expired', className: 'bg-n-200 text-n-600' },
  };
  const c = config[status] ?? { label: status, className: 'bg-n-100 text-n-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${c.className}`}>
      {c.label}
    </span>
  );
}

/** Formats a datetime string as "DD-MMM-YYYY HH:mm" */
function formatDateTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
}

function CategoryCell({ categories }: { categories: string[] }) {
  const shown = categories.slice(0, 2).map((c) => c.replace(/_/g, ' ')).join(', ');
  const extra = categories.length - 2;
  const full = categories.map((c) => c.replace(/_/g, ' ')).join(', ');
  return (
    <span title={full} className="text-n-700">
      {shown}
      {extra > 0 && <span className="text-n-400 ml-1">+{extra} more</span>}
    </span>
  );
}

function RfqRow({ rfq, vendors }: { rfq: RfqSummary; vendors: TabRfqProps['vendors'] }) {
  const [expanded, setExpanded] = React.useState(false);
  const vendorById = React.useMemo(() => {
    const m = new Map<string, typeof vendors[number]>();
    for (const v of vendors) m.set(v.id, v);
    return m;
  }, [vendors]);

  return (
    <>
      {/* Parent row */}
      <tr
        className="border-b border-n-100 hover:bg-n-50 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-[11px] font-medium w-6">
          {rfq.invitations.length > 0 ? (
            expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-n-500" />
              : <ChevronRight className="h-3.5 w-3.5 text-n-500" />
          ) : (
            <span className="w-3.5 inline-block" />
          )}
        </td>
        <td className="px-3 py-2 text-[11px] font-medium">
          <Link
            href={`/procurement/rfq/${rfq.id}`}
            className="text-p-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {rfq.rfq_number}
          </Link>
        </td>
        <td className="px-3 py-2"><RfqStatusBadge status={rfq.status} /></td>
        <td className="px-3 py-2 text-[11px] text-right tabular-nums">{rfq.invitationCount}</td>
        <td className="px-3 py-2 text-[11px] text-right tabular-nums">
          <Badge variant={rfq.submittedCount > 0 ? 'default' : 'secondary'} className="h-4 px-1.5 text-[10px]">
            {rfq.submittedCount}
          </Badge>
        </td>
        <td className="px-3 py-2 text-[10px] text-n-600">{formatDate(rfq.deadline)}</td>
        <td className="px-3 py-2 text-[10px] text-n-500">{formatDateTime(rfq.created_at)}</td>
      </tr>

      {/* Invitation child rows */}
      {expanded && rfq.invitations.map((inv) => {
        const vendorRow = inv.vendor ? vendorById.get(inv.vendor.id) ?? null : null;
        return (
          <tr key={inv.id} className="border-b border-n-50 bg-n-25 hover:bg-n-50">
            <td className="px-3 py-1.5 pl-8" />
            <td className="px-3 py-1.5 text-[11px] font-medium text-n-800" colSpan={1}>
              {inv.vendor?.company_name ?? '—'}
            </td>
            <td className="px-3 py-1.5 text-[10px]" colSpan={1}>
              <CategoryCell categories={inv.categories} />
            </td>
            <td className="px-3 py-1.5 text-[11px] text-right tabular-nums text-n-600">
              {inv.itemCount}
            </td>
            <td className="px-3 py-1.5 text-[10px] text-n-500">
              {formatDateTime(inv.created_at)}
            </td>
            <td className="px-3 py-1.5 text-[10px] text-n-600">
              {inv.expires_at ? formatDate(inv.expires_at) : '—'}
            </td>
            <td className="px-3 py-1.5">
              <InvStatusBadge status={inv.status} />
            </td>
            <td className="px-3 py-1.5">
              <InvitationActionButtons
                invitation={{
                  id: inv.id,
                  access_token: inv.access_token,
                  expires_at: inv.expires_at,
                }}
                vendor={{
                  company_name: inv.vendor?.company_name ?? '—',
                  email: vendorRow?.email ?? null,
                  phone: vendorRow?.phone ?? null,
                }}
                rfqNumber={rfq.rfq_number}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function TabRfq({ projectId, items, rfqs, vendors, viewerRole }: TabRfqProps) {
  const rfqCandidateItems = items.filter((i) => i.procurement_status === 'yet_to_place');

  return (
    <div className="space-y-4">
      {/* ── Create RFQ panel ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Send className="h-4 w-4 text-p-600" />
            Send new RFQ
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <SendRfqPanel
            projectId={projectId}
            boqItems={rfqCandidateItems}
            vendors={vendors}
            viewerRole={viewerRole}
          />
        </CardContent>
      </Card>

      {/* ── Existing RFQs list ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">
            RFQs ({rfqs.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-10 h-10 text-n-300 mb-2" />
              <p className="text-sm font-medium text-n-700">No RFQs yet</p>
              <p className="text-xs text-n-500 mt-1">
                Select BOQ items and vendors above to send your first RFQ.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 w-6" />
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">RFQ #</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Status</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Vendors</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Submitted</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Deadline</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rfqs.map((r) => (
                    <RfqRow key={r.id} rfq={r} vendors={vendors} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
