'use client';

import * as React from 'react';
import { Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@repo/ui';
import { mergeLeads } from '@/lib/leads-actions';

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  status: string;
}

interface MergeLeadsModalProps {
  leadA: Lead;
  leadB: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export function MergeLeadsModal({ leadA, leadB, open, onOpenChange, onMergeComplete }: MergeLeadsModalProps) {
  const [primaryId, setPrimaryId] = React.useState<string>(leadA.id);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const primary = primaryId === leadA.id ? leadA : leadB;
  const secondary = primaryId === leadA.id ? leadB : leadA;

  async function handleMerge() {
    setLoading(true);
    setError(null);
    const result = await mergeLeads(primary.id, secondary.id);
    setLoading(false);

    if (result.success) {
      onOpenChange(false);
      onMergeComplete();
    } else {
      setError(result.error ?? 'Merge failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge Leads</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-[#7C818E] mb-4">
          Select the primary lead to keep. The other lead&apos;s activities and proposals will be transferred, and it will be soft-deleted.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {[leadA, leadB].map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => setPrimaryId(lead.id)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                primaryId === lead.id
                  ? 'border-[#00B050] bg-[#ECFDF5]'
                  : 'border-[#DFE2E8] bg-white hover:border-[#BFC3CC]'
              }`}
            >
              {primaryId === lead.id && (
                <Badge variant="success" className="mb-2">Primary (Keep)</Badge>
              )}
              {primaryId !== lead.id && (
                <Badge variant="error" className="mb-2">Will be merged</Badge>
              )}
              <div className="mt-1">
                <p className="font-medium text-[#1A1D24]">{lead.customer_name}</p>
                <p className="text-sm font-mono text-[#7C818E]">{lead.phone}</p>
                <p className="text-xs text-[#9CA0AB] capitalize mt-1">
                  {lead.status.replace(/_/g, ' ')}
                </p>
              </div>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-[#991B1B] mt-2">{error}</p>
        )}

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={loading}>
            {loading ? 'Merging...' : `Merge into ${primary.customer_name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
