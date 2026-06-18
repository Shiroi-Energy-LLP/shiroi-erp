import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';
// Single source of truth for the status→label map (no 'use server', client-safe).
import { STATUS_LABELS } from '@/lib/project-status-helpers';

type ProjectStatus = Database['public']['Enums']['project_status'];

const STATUS_VARIANT: Record<ProjectStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  order_received: 'info',
  yet_to_start: 'neutral',
  in_progress: 'pending',
  completed: 'success',
  holding_shiroi: 'warning',
  holding_client: 'error',
  waiting_net_metering: 'warning',
  meter_client_scope: 'info',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export { STATUS_LABELS as PROJECT_STATUS_LABELS };
