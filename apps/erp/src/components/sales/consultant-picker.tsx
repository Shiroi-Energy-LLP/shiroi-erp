'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Select, Badge } from '@repo/ui';
import { Handshake, X } from 'lucide-react';
import { assignPartnerToLead, unassignPartnerFromLead } from '@/lib/partners-actions';

interface PartnerOption {
  id: string;
  partner_name: string;
  partner_type: string;
  commission_type: string;
  commission_rate: number;
  tds_applicable: boolean;
}

interface ConsultantPickerProps {
  leadId: string;
  currentPartner: PartnerOption | null;
  lockedCommissionAmount: number | null;
  basePrice: number | null;
  availablePartners: PartnerOption[];
}

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

const COMMISSION_TYPE_LABELS: Record<string, string> = {
  per_kwp: 'Per kWp',
  percentage_of_revenue: '% of Revenue',
  fixed_per_deal: 'Fixed per Deal',
};

function formatCommissionRate(type: string, rate: number): string {
  if (type === 'per_kwp') return `\u20B9${rate}/kWp`;
  if (type === 'percentage_of_revenue') return `${rate}%`;
  if (type === 'fixed_per_deal') return `\u20B9${rate.toLocaleString('en-IN')}`;
  return String(rate);
}

/**
 * ConsultantPicker — attach a channel_partner to a lead so the DB commission
 * lock trigger fires. Once assigned, the commission amount is locked (read-only
 * here) and flows into the Financial breakdown via closure-actions.computeMargin().
 *
 * Unassigning clears the lock so the partner can be changed, but only while
 * the lead is still in early stages — once the proposal is sent, the commission
 * is effectively immutable per plan D5.
 */
export function ConsultantPicker({
  leadId,
  currentPartner,
  lockedCommissionAmount,
  basePrice,
  availablePartners,
}: ConsultantPickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [selectedPartnerId, setSelectedPartnerId] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);

  function handleAssign() {
    if (!selectedPartnerId) {
      setError('Pick a partner to assign.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await assignPartnerToLead(leadId, selectedPartnerId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleUnassign() {
    if (
      !confirm(
        'Unassign this consultant? The locked commission amount will be cleared. You can reassign a different partner.',
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await unassignPartnerFromLead(leadId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Handshake className="w-4 h-4 text-n-500" />
          Consultant / Channel Partner
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentPartner ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="font-medium">{currentPartner.partner_name}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="neutral" className="text-xs">
                    {currentPartner.partner_type.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-n-500">
                    {COMMISSION_TYPE_LABELS[currentPartner.commission_type] ??
                      currentPartner.commission_type}
                    :{' '}
                    {formatCommissionRate(
                      currentPartner.commission_type,
                      Number(currentPartner.commission_rate),
                    )}
                  </span>
                  {currentPartner.tds_applicable && (
                    <Badge variant="warning" className="text-xs">
                      TDS 5%
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUnassign}
                disabled={isPending}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Unassign
              </Button>
            </div>
            <div className="rounded-md bg-n-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-n-500">Locked Commission</span>
                <span className="font-mono tabular-nums font-semibold text-n-900">
                  {lockedCommissionAmount !== null
                    ? formatINR(Number(lockedCommissionAmount))
                    : '—'}
                </span>
              </div>
              <p className="text-xs text-n-500 mt-1">
                Added on top of the Base Quote Price, paid in tranches matching customer
                payment receipts. Not visible to the customer.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-n-500">
              If this lead came through a consultant or referrer, assign them here so their
              commission gets baked into the quote math.
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
                className="flex-1 h-9 text-sm"
              >
                <option value="">Select a partner...</option>
                {availablePartners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partner_name} ({COMMISSION_TYPE_LABELS[p.commission_type] ?? p.commission_type}:{' '}
                    {formatCommissionRate(p.commission_type, Number(p.commission_rate))})
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={handleAssign}
                disabled={!selectedPartnerId || isPending}
              >
                {isPending ? '...' : 'Assign'}
              </Button>
            </div>
            {basePrice === null && (
              <p className="text-xs text-amber-700">
                Note: Base Quote Price is not set yet. Commission will compute once you
                generate a quote.
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
