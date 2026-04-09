import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

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

const STATUS_LABEL: Record<ProjectStatus, string> = {
  order_received: 'Order Received',
  yet_to_start: 'Yet to Start',
  in_progress: 'In Progress',
  completed: 'Completed',
  holding_shiroi: 'Holding from Shiroi',
  holding_client: 'Holding from Client',
  waiting_net_metering: 'Waiting for Net Metering',
  meter_client_scope: 'Meter - Client Scope',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export { STATUS_LABEL as PROJECT_STATUS_LABELS };
