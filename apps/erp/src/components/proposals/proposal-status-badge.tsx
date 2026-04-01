import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

const STATUS_VARIANT: Record<ProposalStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'pending',
  negotiating: 'warning',
  accepted: 'success',
  rejected: 'error',
  expired: 'error',
  superseded: 'neutral',
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  negotiating: 'Negotiating',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  superseded: 'Superseded',
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
