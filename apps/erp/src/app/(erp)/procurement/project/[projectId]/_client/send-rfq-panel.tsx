'use client';

/**
 * Send RFQ panel (Tab 2 top section).
 *
 * Select BOQ items (pre-populated from Tab 1 sessionStorage hand-off) + vendors
 * + deadline, then Create RFQ → returns invitations with access_tokens, opens
 * SendRfqModal showing per-vendor Gmail / WhatsApp / copy-link buttons.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { UserPlus, Send } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import { createRfqWithInvitations } from '@/lib/rfq-actions';
import { SendRfqModal } from './send-rfq-modal';
import { CreateVendorAdHocDialog } from './create-vendor-ad-hoc-dialog';

type AppRole = Database['public']['Enums']['app_role'];
type RfqInvitation = Database['public']['Tables']['rfq_invitations']['Row'];

interface SendRfqPanelProps {
  projectId: string;
  boqItems: PurchaseDetailItem[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  viewerRole: AppRole;
}

function defaultDeadline(): string {
  // 7 days from now, truncated to date (YYYY-MM-DDT18:00 IST → stored as ISO)
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(18, 0, 0, 0);
  // Return a value compatible with <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SendRfqPanel({
  projectId,
  boqItems,
  vendors,
  viewerRole: _viewerRole,
}: SendRfqPanelProps) {
  const router = useRouter();
  const [selectedBoq, setSelectedBoq] = React.useState<Set<string>>(new Set());
  const [selectedVendors, setSelectedVendors] = React.useState<Set<string>>(new Set());
  const [deadline, setDeadline] = React.useState<string>(defaultDeadline());
  const [notes, setNotes] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [invitationsSent, setInvitationsSent] = React.useState<{
    rfqId: string;
    invitations: RfqInvitation[];
  } | null>(null);
  const [showVendorDialog, setShowVendorDialog] = React.useState(false);

  // On mount: read pre-selected BOQ items from sessionStorage (handed off
  // from Tab 1) and clear the storage key so it doesn't linger.
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

  function toggleVendor(id: string) {
    setSelectedVendors((prev) => {
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
    if (selectedVendors.size === 0) {
      setError('Select at least one vendor');
      return;
    }
    if (!deadline) {
      setError('Deadline is required');
      return;
    }

    setSubmitting(true);
    // Convert datetime-local to ISO
    const deadlineIso = new Date(deadline).toISOString();
    const res = await createRfqWithInvitations({
      projectId,
      boqItemIds: Array.from(selectedBoq),
      vendorIds: Array.from(selectedVendors),
      deadline: deadlineIso,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!res.success) {
      setError(res.error);
      return;
    }
    setInvitationsSent({ rfqId: res.data.rfqId, invitations: res.data.invitations });
    // Clear the form — the modal stays up
    setSelectedBoq(new Set());
    setSelectedVendors(new Set());
    setNotes('');
    router.refresh();
  }

  if (boqItems.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-n-600">
          No BOQ items available for RFQ.
        </p>
        <p className="text-[11px] text-n-500 mt-1">
          All items are already assigned to vendors or ordered.
        </p>
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

      {/* Vendor picker */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium">
            Vendors ({selectedVendors.size}/{vendors.length})
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2 gap-1"
            onClick={() => setShowVendorDialog(true)}
          >
            <UserPlus className="h-3 w-3" /> Add new vendor
          </Button>
        </div>
        <div className="border border-n-200 rounded max-h-48 overflow-y-auto">
          {vendors.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-n-500 text-center">
              No vendors. Add one with the button above.
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {vendors.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-n-100 hover:bg-n-50 cursor-pointer"
                    onClick={() => toggleVendor(v.id)}
                  >
                    <td className="px-2 py-1.5 w-6">
                      <input
                        type="checkbox"
                        checked={selectedVendors.has(v.id)}
                        onChange={() => toggleVendor(v.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3 w-3"
                      />
                    </td>
                    <td className="px-2 py-1.5">{v.company_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
          disabled={submitting || selectedBoq.size === 0 || selectedVendors.size === 0}
          onClick={handleCreate}
        >
          <Send className="h-3.5 w-3.5" />
          {submitting
            ? 'Creating…'
            : `Create RFQ (${selectedBoq.size} items × ${selectedVendors.size} vendors)`}
        </Button>
      </div>

      {/* Post-create modal with Gmail / WhatsApp / copy-link buttons */}
      {invitationsSent && (
        <SendRfqModal
          rfqId={invitationsSent.rfqId}
          invitations={invitationsSent.invitations}
          vendors={vendors}
          projectName=""
          onClose={() => setInvitationsSent(null)}
        />
      )}

      {/* Add vendor dialog */}
      {showVendorDialog && (
        <CreateVendorAdHocDialog
          projectId={projectId}
          onClose={() => setShowVendorDialog(false)}
          onCreated={(vendorId) => {
            setShowVendorDialog(false);
            // Auto-select the new vendor so the engineer's next click is Create RFQ.
            setSelectedVendors((prev) => {
              const next = new Set(prev);
              next.add(vendorId);
              return next;
            });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
