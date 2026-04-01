import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

const STATUS_VARIANT: Record<ProjectStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  advance_received: 'info',
  planning: 'info',
  material_procurement: 'pending',
  installation: 'pending',
  electrical_work: 'pending',
  testing: 'warning',
  commissioned: 'success',
  net_metering_pending: 'warning',
  completed: 'success',
  on_hold: 'error',
  cancelled: 'error',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  advance_received: 'Advance Received',
  planning: 'Planning',
  material_procurement: 'Material Procurement',
  installation: 'Installation',
  electrical_work: 'Electrical Work',
  testing: 'Testing',
  commissioned: 'Commissioned',
  net_metering_pending: 'Net Metering Pending',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export { STATUS_LABEL as PROJECT_STATUS_LABELS };
