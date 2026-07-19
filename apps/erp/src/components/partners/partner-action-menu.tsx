'use client';

/**
 * PartnerActionMenu — Edit / Disable / Enable controls for /partners/[id].
 *
 * Edit: opens a dialog to update partner master fields (calls updatePartner).
 * Disable / Enable: inline toggle backed by disablePartner / enablePartner.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Select,
  Checkbox,
} from '@repo/ui';
import { Pencil, Power, PowerOff } from 'lucide-react';
import {
  updatePartner,
  disablePartner,
  enablePartner,
  type CreatePartnerInput,
} from '@/lib/partners-actions';

const PARTNER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'individual_broker', label: 'Individual Broker' },
  { value: 'aggregator', label: 'Aggregator' },
  { value: 'ngo', label: 'NGO' },
  { value: 'housing_society', label: 'Housing Society' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'referral', label: 'Referral' },
  { value: 'electrical_contractor', label: 'Electrical Contractor' },
  { value: 'architect', label: 'Architect' },
  { value: 'mep_firm', label: 'MEP Firm' },
  { value: 'other', label: 'Other' },
];

const COMMISSION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'per_kwp', label: 'Per kWp' },
  { value: 'percentage_of_revenue', label: '% of Revenue' },
  { value: 'fixed_per_deal', label: 'Fixed per Deal' },
];

interface PartnerActionMenuProps {
  partner: {
    id: string;
    partner_name: string;
    contact_person: string;
    phone: string;
    email: string | null;
    whatsapp: string | null;
    partner_type: string;
    commission_type: string;
    commission_rate: number;
    pan_number: string | null;
    tds_applicable: boolean | null;
    agreement_start_date: string | null;
    agreement_end_date: string | null;
    is_active: boolean;
  };
}

export function PartnerActionMenu({ partner }: PartnerActionMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [toggleError, setToggleError] = React.useState<string | null>(null);

  async function handleToggleActive() {
    const action = partner.is_active ? 'disable' : 'enable';
    const verb = partner.is_active ? 'Disable' : 'Enable';
    if (!confirm(`${verb} partner "${partner.partner_name}"?`)) return;

    setToggling(true);
    setToggleError(null);
    const result = action === 'disable'
      ? await disablePartner(partner.id)
      : await enablePartner(partner.id);
    setToggling(false);

    if (!result.success) {
      setToggleError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditOpen(true)}
          className="h-8 gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          size="sm"
          variant={partner.is_active ? 'outline' : 'default'}
          onClick={handleToggleActive}
          disabled={toggling}
          className="h-8 gap-1.5"
        >
          {partner.is_active ? (
            <>
              <PowerOff className="h-3.5 w-3.5" />
              {toggling ? 'Disabling…' : 'Disable'}
            </>
          ) : (
            <>
              <Power className="h-3.5 w-3.5" />
              {toggling ? 'Enabling…' : 'Enable'}
            </>
          )}
        </Button>
        {toggleError && <span className="text-xs text-red-600">{toggleError}</span>}
      </div>

      {editOpen && (
        <EditPartnerDialog
          partner={partner}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

function EditPartnerDialog({
  partner,
  onClose,
}: {
  partner: PartnerActionMenuProps['partner'];
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [partnerName, setPartnerName] = React.useState(partner.partner_name);
  const [contactPerson, setContactPerson] = React.useState(partner.contact_person);
  const [phone, setPhone] = React.useState(partner.phone);
  const [email, setEmail] = React.useState(partner.email ?? '');
  const [whatsapp, setWhatsapp] = React.useState(partner.whatsapp ?? '');
  const [partnerType, setPartnerType] = React.useState(partner.partner_type);
  const [commissionType, setCommissionType] = React.useState(partner.commission_type);
  const [commissionRate, setCommissionRate] = React.useState(String(partner.commission_rate));
  const [panNumber, setPanNumber] = React.useState(partner.pan_number ?? '');
  const [tdsApplicable, setTdsApplicable] = React.useState(Boolean(partner.tds_applicable));
  const [agreementStart, setAgreementStart] = React.useState(partner.agreement_start_date ?? '');
  const [agreementEnd, setAgreementEnd] = React.useState(partner.agreement_end_date ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!partnerName.trim() || !contactPerson.trim() || !phone.trim()) {
      return setError('Partner name, contact person, and phone are required');
    }
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0) {
      return setError('Commission rate must be a non-negative number');
    }

    setSaving(true);
    const patch: Partial<CreatePartnerInput> = {
      partner_name: partnerName.trim(),
      contact_person: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      whatsapp: whatsapp.trim() || null,
      partner_type: partnerType as CreatePartnerInput['partner_type'],
      commission_type: commissionType as CreatePartnerInput['commission_type'],
      commission_rate: rate,
      pan_number: panNumber.trim() || null,
      tds_applicable: tdsApplicable,
      agreement_start_date: agreementStart || null,
      agreement_end_date: agreementEnd || null,
    };
    const res = await updatePartner(partner.id, patch);
    setSaving(false);

    if (!res.success) return setError(res.error);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Edit Partner</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Identity */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">
              Identity
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="partnerName">
                  Partner name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="partnerName"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="partnerType">
                  Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  id="partnerType"
                  value={partnerType}
                  onChange={(e) => setPartnerType(e.target.value)}
                  required
                >
                  {PARTNER_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="contactPerson">
                  Contact person <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="contactPerson"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="phone">
                  Phone <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="whatsapp">WhatsApp</Label>
                <Input
                  id="whatsapp"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Commission */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">
              Commission
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="commissionType">
                  Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  id="commissionType"
                  value={commissionType}
                  onChange={(e) => setCommissionType(e.target.value)}
                  required
                >
                  {COMMISSION_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="commissionRate">
                  Rate <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="commissionRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  required
                />
              </div>
            </div>
          </section>

          {/* Compliance */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-n-500">
              Compliance & Agreement
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="panNumber">PAN</Label>
                <Input
                  id="panNumber"
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  maxLength={10}
                  className="font-mono"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={tdsApplicable}
                    onCheckedChange={(v) => setTdsApplicable(Boolean(v))}
                  />
                  <span>TDS applicable (5% u/s 194H)</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="agreementStart">Agreement start</Label>
                <Input
                  id="agreementStart"
                  type="date"
                  value={agreementStart}
                  onChange={(e) => setAgreementStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="agreementEnd">Agreement end</Label>
                <Input
                  id="agreementEnd"
                  type="date"
                  value={agreementEnd}
                  onChange={(e) => setAgreementEnd(e.target.value)}
                />
              </div>
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
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
