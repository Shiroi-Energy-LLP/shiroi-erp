import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

type MilestoneStatus = Database['public']['Enums']['milestone_status'];

const STATUS_VARIANT: Record<MilestoneStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
  blocked: 'error',
  skipped: 'neutral',
};

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  blocked: 'Blocked',
  skipped: 'Skipped',
};

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
