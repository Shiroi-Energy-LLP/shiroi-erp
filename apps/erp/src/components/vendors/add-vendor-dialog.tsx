'use client';

/**
 * Add Vendor dialog — full schema entry on /vendors.
 *
 * Calls createVendor from vendor-actions. RLS enforces that only founder /
 * finance / project_manager / purchase_officer can write — the dialog itself
 * is rendered conditionally on viewerRole, the server action is the source of
 * truth on the role gate.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Select,
  Label,
  Checkbox,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createVendor, type VendorType } from '@/lib/vendor-actions';

const VENDOR_TYPE_OPTIONS: { value: VendorType; label: string }[] = [
  { value: 'panel_supplier', label: 'Panel Supplier' },
  { value: 'inverter_supplier', label: 'Inverter Supplier' },
  { value: 'structure_supplier', label: 'Structure Supplier' },
  { value: 'cable_supplier', label: 'Cable Supplier' },
  { value: 'electrical_supplier', label: 'Electrical Supplier' },
  { value: 'civil_contractor', label: 'Civil Contractor' },
  { value: 'labour_contractor', label: 'Labour Contractor' },
  { value: 'transport', label: 'Transport / Logistics' },
  { value: 'other', label: 'Other' },
];

export function AddVendorButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="h-9 gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add Vendor
      </Button>
      {open && <AddVendorDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AddVendorDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [companyName, setCompanyName] = React.useState('');
  const [vendorType, setVendorType] = React.useState<VendorType>('other');
  const [contactPerson, setContactPerson] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [addressLine1, setAddressLine1] = React.useState('');
  const [addressLine2, setAddressLine2] = React.useState('');
  const [city, setCity] = React.useState('');
  const [state, setState] = React.useState('Tamil Nadu');
  const [pincode, setPincode] = React.useState('');
  const [gstin, setGstin] = React.useState('');
  const [panNumber, setPanNumber] = React.useState('');
  const [paymentTermsDays, setPaymentTermsDays] = React.useState('30');
  const [isMsme, setIsMsme] = React.useState(false);
  const [isPreferred, setIsPreferred] = React.useState(false);
  const [notes, setNotes] = React.useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyName.trim()) return setError('Company name is required');
    if (!phone.trim() && !email.trim()) {
      return setError('Provide at least a phone or email');
    }
    const ptd = Number(paymentTermsDays);
    if (!Number.isInteger(ptd) || ptd < 0 || ptd > 365) {
      return setError('Payment terms must be 0–365 days');
    }

    setSubmitting(true);
    const res = await createVendor({
      companyName: companyName.trim(),
      vendorType,
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      addressLine1: addressLine1.trim() || undefined,
      addressLine2: addressLine2.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      pincode: pincode.trim() || undefined,
      gstin: gstin.trim() || undefined,
      panNumber: panNumber.trim() || undefined,
      paymentTermsDays: ptd,
      isMsme,
      isPreferred,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!res.success) return setError(res.error);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Add Vendor</DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Vendor code is auto-generated. Required: company name, vendor type, and at least one of phone/email.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Identity */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">Identity</h4>
            <div>
              <Label htmlFor="companyName">Company name <span className="text-red-500">*</span></Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="ABC Traders Pvt Ltd"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="vendorType">Vendor type <span className="text-red-500">*</span></Label>
                <Select
                  id="vendorType"
                  value={vendorType}
                  onChange={(e) => setVendorType(e.target.value as VendorType)}
                  required
                >
                  {VENDOR_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="contactPerson">Contact person</Label>
                <Input
                  id="contactPerson"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="Mr. Ramesh Kumar"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="sales@abc.com"
                />
              </div>
            </div>
          </section>

          {/* Address */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">Address</h4>
            <div>
              <Label htmlFor="addressLine1">Address line 1</Label>
              <Input
                id="addressLine1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Plot 12, MGR Industrial Estate"
              />
            </div>
            <div>
              <Label htmlFor="addressLine2">Address line 2</Label>
              <Input
                id="addressLine2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Phase 2, Guindy"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chennai"
                />
              </div>
              <div>
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="Tamil Nadu"
                />
              </div>
              <div>
                <Label htmlFor="pincode">Pincode</Label>
                <Input
                  id="pincode"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="600032"
                />
              </div>
            </div>
          </section>

          {/* Compliance */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">Tax & Compliance</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="gstin">GSTIN</Label>
                <Input
                  id="gstin"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="33AABCU9603R1Z2"
                  maxLength={15}
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="panNumber">PAN</Label>
                <Input
                  id="panNumber"
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  placeholder="AABCU9603R"
                  maxLength={10}
                  className="font-mono"
                />
              </div>
            </div>
          </section>

          {/* Terms */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">Payment & Flags</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="paymentTermsDays">Payment terms (days)</Label>
                <Input
                  id="paymentTermsDays"
                  type="number"
                  min={0}
                  max={365}
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <label className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={isMsme}
                    onCheckedChange={(v) => setIsMsme(Boolean(v))}
                  />
                  <span>MSME vendor (45-day SLA)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={isPreferred}
                    onCheckedChange={(v) => setIsPreferred(Boolean(v))}
                  />
                  <span>Preferred vendor</span>
                </label>
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional internal notes — quality history, payment behaviour, etc."
                className="w-full text-sm border border-n-200 rounded px-3 py-2"
              />
            </div>
          </section>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create vendor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
