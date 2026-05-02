'use client';

// apps/erp/src/app/(erp)/data-review/projects/_components/project-edit-row.tsx
// Inline edit form: kWp + ₹, three action buttons, duplicate-search dialog.

import { useState, useTransition } from 'react';
import { Button, Input, useToast } from '@repo/ui';
import { Loader2 } from 'lucide-react';
import type { ReviewProjectRow } from '@/lib/data-review-queries';
import {
  confirmProjectReview,
  markProjectDuplicate,
} from '@/lib/data-review-actions';
import { DuplicateSearch } from './duplicate-search';

interface Props {
  row: ReviewProjectRow;
  onDone: () => void;
}

export function ProjectEditRow({ row, onDone }: Props) {
  const { addToast } = useToast();
  const [sizeKwp, setSizeKwp] = useState(String(row.system_size_kwp || ''));
  const [contractedValue, setContractedValue] = useState(
    String(row.contracted_value || ''),
  );
  const [dupOpen, setDupOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = (useCurrentValues: boolean) => {
    const kwp = useCurrentValues
      ? row.system_size_kwp
      : Number(sizeKwp);
    const cv = useCurrentValues
      ? row.contracted_value
      : Number(contractedValue);

    if (!kwp || kwp <= 0) {
      addToast({ title: 'System size must be greater than 0', variant: 'destructive' });
      return;
    }

    startTransition(async () => {
      const result = await confirmProjectReview({
        projectId: row.id,
        newSizeKwp: kwp,
        newContractedValue: cv,
      });
      if (!result.success) {
        addToast({ title: result.error ?? result.code ?? 'Confirm failed', variant: 'destructive' });
        return;
      }
      addToast({ title: `${row.project_number} confirmed`, variant: 'success' });
      onDone();
    });
  };

  const handleDuplicateMerge = async (
    canonicalId: string,
    notes: string,
  ) => {
    const result = await markProjectDuplicate({
      projectAId: row.id,
      projectBId: canonicalId,
      notes,
    });
    if (!result.success) {
      addToast({ title: result.error ?? 'Merge failed', variant: 'destructive' });
      return false;
    }
    addToast({
      title: `Marked as duplicate — kept project ${result.data.keptId === row.id ? row.project_number : canonicalId}`,
      variant: 'success',
    });
    setDupOpen(false);
    onDone();
    return true;
  };

  return (
    <div className="space-y-4">
      {/* Source info */}
      <div className="text-xs text-[#7C818E] space-y-0.5">
        {row.pv_ref_in_notes && (
          <p>PV ref: <span className="font-mono">{row.pv_ref_in_notes}</span></p>
        )}
        {row.hubspot_deal_id && (
          <p>HubSpot deal: <span className="font-mono">{row.hubspot_deal_id}</span></p>
        )}
        {row.drive_link && (
          <p>
            Drive:{' '}
            <a
              href={row.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              open →
            </a>
          </p>
        )}
        {(row.financials_invalidated || row.system_size_uncertain) && (
          <p className="text-amber-600">
            {row.financials_invalidated && 'Financials invalidated · '}
            {row.system_size_uncertain && 'System size uncertain'}
          </p>
        )}
      </div>

      {/* Edit inputs */}
      <div className="flex items-end gap-4">
        <div>
          <label className="text-xs font-medium text-[#7C818E] mb-1 block">
            System size (kWp)
          </label>
          <Input
            type="number"
            min="0.1"
            step="0.1"
            className="h-8 w-28 text-sm"
            value={sizeKwp}
            onChange={(e) => setSizeKwp(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[#7C818E] mb-1 block">
            Order value (₹)
          </label>
          <Input
            type="number"
            min="0"
            step="1000"
            className="h-8 w-40 text-sm"
            value={contractedValue}
            onChange={(e) => setContractedValue(e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => handleConfirm(false)}
        >
          {isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Save &amp; Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => handleConfirm(true)}
        >
          Confirm — no change
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => setDupOpen(true)}
        >
          Mark Duplicate
        </Button>
      </div>

      {/* Duplicate search dialog */}
      {dupOpen && (
        <DuplicateSearch
          currentProjectId={row.id}
          currentProjectNumber={row.project_number}
          onConfirm={handleDuplicateMerge}
          onClose={() => setDupOpen(false)}
        />
      )}
    </div>
  );
}
