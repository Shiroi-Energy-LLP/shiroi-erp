'use client';

/**
 * Send RFQ panel (Tab 2 top section).
 *
 * Select BOQ items (pre-populated from Tab 1 sessionStorage hand-off) + vendors
 * (via VendorSearchCombobox typeahead) + deadline, then Create RFQ → returns
 * invitations with access_tokens, opens SendRfqModal showing per-vendor Gmail /
 * WhatsApp / copy-link buttons.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Send } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import type { VendorSearchResult } from '@/lib/procurement-queries';
import { createRfqWithInvitations } from '@/lib/rfq-actions';
import { SendRfqModal } from './send-rfq-modal';
import { VendorSearchCombobox } from './vendor-search-combobox';

type AppRole = Database['public']['Enums']['app_role'];
type RfqInvitation = Database['public']['Tables']['rfq_invitations']['Row'];

interface SendRfqPanelProps {
  projectId: string;
  boqItems: PurchaseDetailItem[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  viewerRole: AppRole;
}

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SendRfqPanel({
  projectId,
  boqItems,
  viewerRole: _viewerRole,
}: SendRfqPanelProps) {
  const router = useRouter();
  const [selectedBoq, setSelectedBoq] = React.useState<Set<string>>(new Set());
  const [selectedVendors, setSelectedVendors] = React.useState<VendorSearchResult[]>([]);
  const [deadline, setDeadline] = React.useState<string>(defaultDeadline());
  const [notes, setNotes] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [invitationsSent, setInvitationsSent] = React.useState<{
    rfqId: string;
    invitations: RfqInvitation[];
  } | null>(null);

  // On mount: read pre-selected BOQ items from sessionStorage (handed off from Tab 1).
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`rfq-preselect-${projectId}`);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        setSelectedBoq(new Set(ids));
        sessionStorage.removeItem(`rfq-preselect-${projectId}`);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  function toggleBoq(id: string) {
    setSelectedBoq((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    setError(null);
    if (selectedBoq.size === 0) {
      setError('Select at least one BOQ item');
      return;
    }
    if (selectedVendors.length === 0) {
      setError('Select at least one vendor');
      return;
    }
    if (!deadline) {
      setError('Deadline is required');
      return;
    }

    setSubmitting(true);
    const deadlineIso = new Date(deadline).toISOString();
    const res = await createRfqWithInvitations({
      projectId,
      boqItemIds: Array.from(selectedBoq),
      vendorIds: selectedVendors.map((v) => v.id),
      deadline: deadlineIso,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!res.success) {
      setError(res.error);
      return;
    }
    setInvitationsSent({ rfqId: res.data.rfqId, invitations: res.data.invitations });
    setSelectedBoq(new Set());
    setSelectedVendors([]);
    setNotes('');
    router.refresh();
  }

  if (boqItems.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-n-600">No BOQ items available for RFQ.</p>
        <p className="text-[11px] text-n-500 mt-1">All items are already assigned to vendors or ordered.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* BOQ item picker */}
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
          BOQ items ({selectedBoq.size}/{boqItems.length})
        </label>
        <div className="border border-n-200 rounded max-h-48 overflow-y-auto">
          <table className="w-full text-[11px]">
            <tbody>
              {boqItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-n-100 hover:bg-n-50 cursor-pointer"
                  onClick={() => toggleBoq(item.id)}
                >
                  <td className="px-2 py-1.5 w-6">
                    <input
                      type="checkbox"
                      checked={selectedBoq.has(item.id)}
                      onChange={() => toggleBoq(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3 w-3"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-n-800">{item.item_description}</span>
                    <span className="text-[10px] text-n-500 ml-2">
                      {item.quantity} {item.unit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vendor typeahead */}
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
          Vendors ({selectedVendors.length} selected)
        </label>
        <VendorSearchCombobox
          projectId={projectId}
          selected={selectedVendors}
          onChange={setSelectedVendors}
        />
      </div>

      {/* Deadline + notes */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
            Deadline
          </label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
            Notes (optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Delivery schedule, payment terms, etc."
            className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
          />
        </div>
      </div>

      {/* Submit + errors */}
      <div className="flex items-center justify-between">
        <div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
        <Button
          size="sm"
          className="h-8 text-[11px] px-3 gap-1"
          disabled={submitting || selectedBoq.size === 0 || selectedVendors.length === 0}
          onClick={handleCreate}
        >
          <Send className="h-3.5 w-3.5" />
          {submitting
            ? 'Creating…'
            : `Create RFQ (${selectedBoq.size} items × ${selectedVendors.length} vendors)`}
        </Button>
      </div>

      {/* Post-create modal with Gmail / WhatsApp / copy-link buttons */}
      {invitationsSent && (
        <SendRfqModal
          rfqId={invitationsSent.rfqId}
          invitations={invitationsSent.invitations}
          vendors={selectedVendors.map((v) => ({
            id: v.id,
            company_name: v.company_name,
            phone: v.phone,
            email: v.email,
            contact_person: v.contact_person,
          }))}
          projectName=""
          onClose={() => setInvitationsSent(null)}
        />
      )}
    </div>
  );
}
