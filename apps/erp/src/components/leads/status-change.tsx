'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Select, Button, Input } from '@repo/ui';
import { getValidNextStatuses, requiresFollowUp, DEFAULT_PROBABILITY, STAGE_LABELS } from '@/lib/leads-helpers';
import { upsertLeadFollowupTask } from '@/lib/leads-task-actions';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

// Reuse STAGE_LABELS from leads-helpers.ts so we have one source of truth for display names.
const STATUS_LABEL = STAGE_LABELS;

interface StatusChangeProps {
  leadId: string;
  currentStatus: LeadStatus;
  currentExpectedCloseDate?: string | null;
}

/** ISO YYYY-MM-DD for today + N days (client-side, no timezone needed) */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}

export function StatusChange({ leadId, currentStatus, currentExpectedCloseDate }: StatusChangeProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | ''>('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validStatuses = getValidNextStatuses(currentStatus);

  if (validStatuses.length === 0) {
    return null;
  }

  const needsFollowup = selectedStatus !== '' && requiresFollowUp(selectedStatus);

  // When the user picks negotiation or closure_soon, default expected_close_date
  // to today+14 if the lead doesn't already have one.
  function handleStatusSelect(status: LeadStatus | '') {
    setSelectedStatus(status);
    setError(null);
    if (
      (status === 'negotiation' || status === 'closure_soon') &&
      !currentExpectedCloseDate
    ) {
      setExpectedCloseDate((prev) => prev || offsetDate(14));
    } else if (status !== 'negotiation' && status !== 'closure_soon') {
      setExpectedCloseDate('');
    }
  }

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

    // Include expected_close_date if set/changed
    if (expectedCloseDate) {
      updates.expected_close_date = expectedCloseDate;
    }

    // Auto-set probability based on stage
    const defaultProb = DEFAULT_PROBABILITY[selectedStatus];
    if (defaultProb !== undefined) {
      updates.close_probability = defaultProb;
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', leadId)
      .select('id');

    if (updateError) {
      console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message, leadId });
      setError(`Failed to update status: ${updateError.message}`);
      return;
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error(`${op} 0 rows affected — RLS blocked or lead missing:`, { leadId, timestamp: new Date().toISOString() });
      setError('Update blocked — you may not have permission, or the lead no longer exists.');
      return;
    }

    // Fire-and-forget: upsert follow-up task if a date was set (non-blocking)
    if (nextFollowupDate) {
      upsertLeadFollowupTask(leadId, nextFollowupDate).catch((e) => {
        console.error(`${op} upsertLeadFollowupTask failed:`, { leadId, nextFollowupDate, error: e });
      });
    }

    setSelectedStatus('');
    setNextFollowupDate('');
    setExpectedCloseDate('');
    startTransition(() => {
      router.refresh();
    });
  }

  const showExpectedCloseInput =
    (selectedStatus === 'negotiation' || selectedStatus === 'closure_soon') &&
    !currentExpectedCloseDate;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={selectedStatus}
        onChange={(e) => handleStatusSelect(e.target.value as LeadStatus | '')}
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

      {showExpectedCloseInput && (
        <div className="flex items-center gap-1">
          <label className="text-xs text-n-500 whitespace-nowrap">Exp. close:</label>
          <Input
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="w-36 h-8 text-sm"
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
