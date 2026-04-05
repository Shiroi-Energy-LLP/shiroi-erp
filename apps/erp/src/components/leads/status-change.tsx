'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Select, Button } from '@repo/ui';
import { getValidNextStatuses } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  site_survey_scheduled: 'Survey Scheduled',
  site_survey_done: 'Survey Done',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  disqualified: 'Disqualified',
  on_hold: 'On Hold',
  design_confirmed: 'Design Confirmed',
  converted: 'Converted',
};

interface StatusChangeProps {
  leadId: string;
  currentStatus: LeadStatus;
}

export function StatusChange({ leadId, currentStatus }: StatusChangeProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | ''>('');
  const [error, setError] = useState<string | null>(null);

  const validStatuses = getValidNextStatuses(currentStatus);

  if (validStatuses.length === 0) {
    return null;
  }

  async function handleUpdate() {
    const op = '[StatusChange.handleUpdate]';
    if (!selectedStatus) return;

    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        status: selectedStatus,
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updateError) {
      console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message, leadId });
      setError(`Failed to update status: ${updateError.message}`);
      return;
    }

    setSelectedStatus('');
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedStatus}
        onChange={(e) => setSelectedStatus(e.target.value as LeadStatus | '')}
        className="w-48"
      >
        <option value="">Move to...</option>
        {validStatuses.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        onClick={handleUpdate}
        disabled={!selectedStatus || isPending}
      >
        {isPending ? 'Updating...' : 'Update'}
      </Button>
      {error && <span className="text-sm text-status-error-text">{error}</span>}
    </div>
  );
}
