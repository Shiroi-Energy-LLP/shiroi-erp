'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Card, CardContent } from '@repo/ui';
import { createBudgetaryQuoteAction } from '@/lib/proposal-actions';

interface QuickQuoteModalProps {
  leadId: string;
  defaultSystemType: string | null;
  defaultSizeKwp: number | null;
  defaultSegment: string | null;
  onClose: () => void;
}

const SYSTEM_TYPES = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];

const STRUCTURE_TYPES = [
  { value: 'flush_mount', label: 'Flush Mount (Flat Roof)' },
  { value: 'elevated', label: 'Elevated (+15%)' },
  { value: 'high_rise', label: 'High Rise (+10%)' },
];

const SEGMENTS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

export function QuickQuoteModal({ leadId, defaultSystemType, defaultSizeKwp, defaultSegment, onClose }: QuickQuoteModalProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [systemSizeKwp, setSystemSizeKwp] = useState(String(defaultSizeKwp ?? ''));
  const [systemType, setSystemType] = useState(defaultSystemType ?? 'on_grid');
  const [segment, setSegment] = useState(defaultSegment ?? 'residential');
  const [structureType, setStructureType] = useState('flush_mount');
  const [includeLiaison, setIncludeLiaison] = useState(true);
  const [includeCivil, setIncludeCivil] = useState(true);

  const handleSubmit = useCallback(async () => {
    const size = Number(systemSizeKwp);
    if (!size || size <= 0) {
      setError('Enter a valid system size');
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await createBudgetaryQuoteAction({
      leadId,
      systemSizeKwp: size,
      systemType: systemType as 'on_grid' | 'hybrid' | 'off_grid',
      segment,
      structureType,
      includeLiaison,
      includeCivil,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else if (result.proposalId) {
      // /proposals/[id] was removed in the Marketing + Design revamp — the
      // quote now lives inside the lead's Quote tab on the sales URL space.
      // Land the user there so they see the newly created BOM + totals
      // without leaving the lead.
      router.push(`/sales/${leadId}/proposal`);
      router.refresh();
    }
  }, [leadId, systemSizeKwp, systemType, segment, structureType, includeLiaison, includeCivil, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#1A1D24]">Quick Budgetary Quote</h2>
            <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
          </div>

          {error && (
            <div className="rounded-md bg-[#FEF2F2] border border-[#FCA5A5] px-3 py-2 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>System Size (kWp) *</Label>
              <Input
                type="number"
                step="0.01"
                value={systemSizeKwp}
                onChange={(e) => setSystemSizeKwp(e.target.value)}
                placeholder="e.g. 10.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label>System Type *</Label>
              <select
                value={systemType}
                onChange={(e) => setSystemType(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SYSTEM_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Customer Segment</Label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SEGMENTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Structure Type</Label>
              <select
                value={structureType}
                onChange={(e) => setStructureType(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {STRUCTURE_TYPES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeLiaison} onChange={(e) => setIncludeLiaison(e.target.checked)} className="rounded" />
              Include Liaison / Net Metering
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeCivil} onChange={(e) => setIncludeCivil(e.target.checked)} className="rounded" />
              Include Civil Works
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Generating...' : 'Generate Quote'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
