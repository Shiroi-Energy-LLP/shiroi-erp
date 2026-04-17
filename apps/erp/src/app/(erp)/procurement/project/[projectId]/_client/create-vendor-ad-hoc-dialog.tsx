'use client';

/**
 * Create Vendor Ad-Hoc Dialog.
 *
 * Opened from `SendRfqPanel` via the "+ Add new vendor" button. Minimal form —
 * company_name + contact_person + phone + email. The Purchase Engineer fills
 * the rest in from /vendors when the vendor matures into a recurring supplier.
 *
 * Uses createVendorAdHoc server action which also revalidates the procurement
 * page so the new vendor appears in the vendor picker on router.refresh().
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
} from '@repo/ui';
import { createVendorAdHoc } from '@/lib/procurement-actions';

interface CreateVendorAdHocDialogProps {
  projectId: string;
  onClose: () => void;
  onCreated: (vendorId: string) => void;
}

export function CreateVendorAdHocDialog({
  projectId,
  onClose,
  onCreated,
}: CreateVendorAdHocDialogProps) {
  const [companyName, setCompanyName] = React.useState('');
  const [contactPerson, setContactPerson] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyName.trim()) {
      setError('Company name is required');
      return;
    }
    if (!phone.trim() && !email.trim()) {
      setError('Provide at least a phone or email');
      return;
    }

    setSubmitting(true);
    const res = await createVendorAdHoc({
      companyName: companyName.trim(),
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      projectId,
    });
    setSubmitting(false);

    if (!res.success) {
      setError(res.error ?? 'Failed to create vendor');
      return;
    }
    if (!res.vendorId) {
      setError('Vendor created but no ID returned');
      return;
    }
    onCreated(res.vendorId);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Add new vendor</DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Minimal details now — you can fill in bank / GSTIN / address from the Vendors page later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Company name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="ABC Traders Pvt Ltd"
              required
              className="w-full h-8 text-[12px] border border-n-200 rounded px-2"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Contact person
            </label>
            <input
              type="text"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="Mr. Ramesh Kumar"
              className="w-full h-8 text-[12px] border border-n-200 rounded px-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full h-8 text-[12px] border border-n-200 rounded px-2"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sales@abc.com"
                className="w-full h-8 text-[12px] border border-n-200 rounded px-2"
              />
            </div>
          </div>

          <p className="text-[10px] text-n-500">
            At least one of phone or email is required (so we can send the RFQ).
          </p>

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={submitting}
              className="h-8 text-[11px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="h-8 text-[11px]"
            >
              {submitting ? 'Creating…' : 'Create vendor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
