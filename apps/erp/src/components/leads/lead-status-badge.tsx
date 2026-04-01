import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

const STATUS_VARIANT: Record<LeadStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  new: 'info',
  contacted: 'pending',
  site_survey_scheduled: 'pending',
  site_survey_done: 'pending',
  proposal_sent: 'warning',
  negotiation: 'warning',
  won: 'success',
  lost: 'error',
  disqualified: 'error',
  on_hold: 'neutral',
};

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
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
