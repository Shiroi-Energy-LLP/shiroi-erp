'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Select, Button, Input } from '@repo/ui';
import { getValidNextStatuses, requiresFollowUp, DEFAULT_PROBABILITY, STAGE_LABELS } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

// Reuse STAGE_LABELS from leads-helpers.ts so we have one source of truth for display names.
const STATUS_LABEL = STAGE_LABELS;

interface StatusChangeProps {
  leadId: string;
  currentStatus: LeadStatus;
}

export function StatusChange({ leadId, currentStatus }: StatusChangeProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | ''>('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validStatuses = getValidNextStatuses(currentStatus);

  if (validStatuses.length === 0) {
    return null;
  }

  const needsFollowup = selectedStatus !== '' && requiresFollowUp(selectedStatus);

  async function handleUpdate() {
    const op = '[StatusChange.handleUpdate]';
    if (!selectedStatus) return;

    // Enforce mandatory follow-up
    if (requiresFollowUp(selectedStatus) && !nextFollowupDate) {
      setError('Next follow-up date is required for this status');
      return;
    }

    setError(null);
    const supabase = createClient();

    const updates: Record<string, unknown> = {
      status: selectedStatus,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Set follow-up date if provided
    if (nextFollowupDate) {
      updates.next_followup_date = nextFollowupDate;
    }

    // Auto-set probability based on stage
    const defaultProb = DEFAULT_PROBABILITY[selectedStatus];
    if (defaultProb !== undefined) {
      updates.close_probability = defaultProb;
    }

    const { error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', leadId);

    if (updateError) {
      console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message, leadId });
      setError(`Failed to update status: ${updateError.message}`);
      return;
    }

    setSelectedStatus('');
    setNextFollowupDate('');
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={selectedStatus}
        onChange={(e) => {
          setSelectedStatus(e.target.value as LeadStatus | '');
          setError(null);
        }}
        className="w-48"
      >
        <option value="">Move to...</option>
        {validStatuses.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </Select>

      {needsFollowup && (
        <div className="flex items-center gap-1">
          <label className="text-xs text-n-500 whitespace-nowrap">Follow-up:</label>
          <Input
            type="date"
            value={nextFollowupDate}
            onChange={(e) => {
              setNextFollowupDate(e.target.value);
              setError(null);
            }}
            min={new Date().toISOString().split('T')[0]}
            className="w-36 h-8 text-sm"
            required
          />
        </div>
      )}

      <Button
        size="sm"
        onClick={handleUpdate}
        disabled={!selectedStatus || isPending}
      >
        {isPending ? 'Updating...' : 'Update'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
