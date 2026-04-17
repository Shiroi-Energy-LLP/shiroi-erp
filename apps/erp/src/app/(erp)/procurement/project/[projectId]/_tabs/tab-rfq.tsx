/**
 * Tab 2 — RFQ: create + track outbound RFQs.
 *
 * Server component. Top section is the "create a new RFQ" panel (client
 * component that wraps vendor multi-select + deadline picker + notes).
 * Bottom section lists existing RFQs for this project with their invitation
 * status rollup — engineer clicks an RFQ to see per-vendor send/view/submitted
 * state and re-open Gmail / WhatsApp deep-links.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { FileText, Send } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import type { RfqSummary } from '@/lib/rfq-queries';
import { SendRfqPanel } from '../_client/send-rfq-panel';

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

export function TabRfq({ projectId, items, rfqs, vendors, viewerRole }: TabRfqProps) {
  // Only yet-to-place BOQ items are candidates for a new RFQ (already-ordered
  // items shouldn't re-enter competitive quoting).
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
                    <tr key={r.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-3 py-2 text-[11px] font-medium">
                        <Link
                          href={`/procurement/rfq/${r.id}`}
                          className="text-p-600 hover:underline"
                        >
                          {r.rfq_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2"><RfqStatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-[11px] text-right tabular-nums">{r.invitationCount}</td>
                      <td className="px-3 py-2 text-[11px] text-right tabular-nums">
                        <Badge variant={r.submittedCount > 0 ? 'default' : 'secondary'} className="h-4 px-1.5 text-[10px]">
                          {r.submittedCount}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-n-600">{formatDate(r.deadline)}</td>
                      <td className="px-3 py-2 text-[10px] text-n-500">{formatDate(r.created_at)}</td>
                    </tr>
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
