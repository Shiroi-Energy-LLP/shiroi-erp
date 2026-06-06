'use client';

/**
 * BulkActionTable — selectable WhatsApp Import queue table with a bulk action bar.
 *
 * Replaces the previous static table on /whatsapp-import. Users can check
 * individual rows (or select-all) and then run batchApproveQueueItems or
 * batchRejectQueueItems on the selected ids.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Check, X } from 'lucide-react';
import { batchApproveQueueItems, batchRejectQueueItems } from '@/lib/whatsapp-import-actions';

const PROFILE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  llp: 'LLP / Purchase',
  shiroi_energy: 'Shiroi Energy ⚡',
  site: 'Site',
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  customer_payment: { label: 'Payment',      color: 'bg-green-100 text-green-800' },
  vendor_payment:   { label: 'Vendor Pay',   color: 'bg-red-100 text-red-800' },
  purchase_order:   { label: 'PO',           color: 'bg-orange-100 text-orange-800' },
  boq_item:         { label: 'BOQ Item',     color: 'bg-blue-100 text-blue-800' },
  task:             { label: 'Task',         color: 'bg-purple-100 text-purple-800' },
  activity:         { label: 'Activity',     color: 'bg-gray-100 text-gray-700' },
  contact:          { label: 'Contact',      color: 'bg-indigo-100 text-indigo-800' },
  site_photo:       { label: 'Photo',        color: 'bg-yellow-100 text-yellow-800' },
  daily_report:     { label: 'Daily Report', color: 'bg-teal-100 text-teal-800' },
  milestone_update: { label: 'Milestone',    color: 'bg-cyan-100 text-cyan-800' },
  delivery:         { label: 'Delivery',     color: 'bg-sky-100 text-sky-800' },
  unknown:          { label: 'Unknown',      color: 'bg-gray-100 text-gray-500' },
};

export interface QueueItemRow {
  id: string;
  message_timestamp: string;
  sender_name: string;
  extraction_type: string;
  matched_project_name: string | null;
  confidence_score: number | null;
  extracted_data: Record<string, unknown>;
  chat_profile: string;
  review_status: string;
  requires_finance_review: boolean;
}

function extractSummary(data: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'customer_payment':
    case 'vendor_payment':
      if (data['amount']) return `₹${Number(data['amount']).toLocaleString('en-IN')}`;
      return 'Payment';
    case 'task':
      return String(data['title'] ?? 'Task').slice(0, 60);
    case 'activity':
      return String(data['title'] ?? data['body'] ?? 'Activity').slice(0, 60);
    case 'purchase_order':
      return String(data['po_number'] ?? data['pdf_filename'] ?? 'PO').slice(0, 60);
    case 'boq_item':
      return String(data['item_description'] ?? 'BOQ item').slice(0, 60);
    case 'contact':
      return `${data['name'] ?? ''} ${data['phone'] ?? ''}`.trim().slice(0, 60);
    case 'daily_report':
      return String(data['work_description'] ?? 'Daily report').slice(0, 60);
    case 'milestone_update':
      return String(data['milestone_name'] ?? 'Milestone').slice(0, 60);
    case 'delivery':
      return String(data['item_description'] ?? 'Delivery').slice(0, 60);
    default:
      return JSON.stringify(data).slice(0, 60);
  }
}

interface BulkActionTableProps {
  items: QueueItemRow[];
  status: string;
}

export function BulkActionTable({ items, status }: BulkActionTableProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<null | 'approve' | 'reject'>(null);
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Only pending items are eligible for bulk approve/reject.
  const canBulkAct = status === 'pending';

  // Reset selection when items change (page navigation, filter change).
  React.useEffect(() => {
    setSelected(new Set());
    setMessage(null);
  }, [items]);

  const selectedCount = selected.size;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  async function handleApprove() {
    if (selectedCount === 0) return;
    if (!confirm(`Approve ${selectedCount} item${selectedCount === 1 ? '' : 's'}?`)) return;

    setBusy('approve');
    setMessage(null);
    const ids = Array.from(selected);
    const result = await batchApproveQueueItems(ids);
    setBusy(null);

    if (result.success) {
      setMessage({ kind: 'ok', text: `Approved ${result.approved} item${result.approved === 1 ? '' : 's'}.` });
    } else {
      setMessage({
        kind: 'err',
        text: `Approved ${result.approved}, ${result.failed} failed. First error: ${result.errors[0] ?? '—'}`,
      });
    }
    setSelected(new Set());
    router.refresh();
  }

  async function handleReject() {
    if (selectedCount === 0) return;
    const reason = prompt(`Reason for rejecting ${selectedCount} item${selectedCount === 1 ? '' : 's'}? (optional)`);
    // null = cancel; '' or any string = proceed.
    if (reason === null) return;

    setBusy('reject');
    setMessage(null);
    const ids = Array.from(selected);
    const result = await batchRejectQueueItems(ids, reason || undefined);
    setBusy(null);

    if (result.success) {
      setMessage({ kind: 'ok', text: `Rejected ${result.rejected} item${result.rejected === 1 ? '' : 's'}.` });
    } else {
      setMessage({ kind: 'err', text: `Rejection failed (${result.failed} item${result.failed === 1 ? '' : 's'}).` });
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <>
      {/* Bulk action bar — sticky, only when one or more rows are selected */}
      {canBulkAct && selectedCount > 0 && (
        <div className="sticky top-2 z-30 mb-3 flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 shadow">
          <span className="text-sm font-medium text-blue-900">
            {selectedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set())}
              disabled={busy !== null}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleApprove}
              disabled={busy !== null}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              {busy === 'approve' ? 'Approving…' : `Approve ${selectedCount}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReject}
              disabled={busy !== null}
              className="text-red-700 border-red-300 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              {busy === 'reject' ? 'Rejecting…' : `Reject ${selectedCount}`}
            </Button>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`mb-3 rounded-md border px-4 py-2 text-sm ${
            message.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {canBulkAct && (
                <th className="text-left py-3 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-32">Date</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-36">Sender</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-28">Type</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Project Match</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-20">Conf.</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Summary</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-28">Chat</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600 w-20">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.length === 0 && (
              <tr>
                <td colSpan={canBulkAct ? 9 : 8} className="text-center py-16 text-gray-400">
                  No items in this queue
                </td>
              </tr>
            )}
            {items.map((item) => {
              const cfg = TYPE_CONFIG[item.extraction_type] ?? { label: item.extraction_type, color: 'bg-gray-100 text-gray-500' };
              const conf = item.confidence_score ?? 0;
              const confColor = conf >= 0.85 ? 'text-green-600' : conf >= 0.60 ? 'text-yellow-600' : 'text-red-500';
              const summary = extractSummary(item.extracted_data, item.extraction_type);
              const isSelected = selected.has(item.id);

              return (
                <tr
                  key={item.id}
                  className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  {canBulkAct && (
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(item.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        aria-label={`Select ${item.id}`}
                      />
                    </td>
                  )}
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(item.message_timestamp).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </td>
                  <td className="py-3 px-4 text-gray-700 text-xs truncate max-w-[140px]">{item.sender_name}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {item.requires_finance_review && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">₹</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-700 text-xs max-w-[160px]">
                    {item.matched_project_name
                      ? <span className="truncate block">{item.matched_project_name}</span>
                      : <span className="text-red-400 italic">unmatched</span>
                    }
                  </td>
                  <td className={`py-3 px-4 font-mono text-xs font-semibold ${confColor}`}>
                    {(conf * 100).toFixed(0)}%
                  </td>
                  <td className="py-3 px-4 text-gray-600 text-xs max-w-[200px]">
                    <span className="truncate block">{summary}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400">
                    {PROFILE_LABELS[item.chat_profile] ?? item.chat_profile}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      href={`/whatsapp-import/${item.id}`}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
