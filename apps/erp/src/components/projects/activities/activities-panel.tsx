import { Users } from 'lucide-react';
import {
  listProjectActivities,
  getActivitiesSummary,
  getActivityStageOptions,
} from '@/lib/project-activities-queries';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import { ActivitiesClient } from './activities-client';

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[110px]">
      <div className="text-[10px] text-n-500 mb-0.5">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

/** Per-project Activities sub-tab: PM (+founder) write, everyone reads. */
export async function ActivitiesPanel({ projectId }: { projectId: string }) {
  const [{ rows }, summary, stages, viewerRole] = await Promise.all([
    listProjectActivities({ projectId, paginate: false }),
    getActivitiesSummary({ projectId }),
    getActivityStageOptions(),
    getCurrentUserRoleForProject(),
  ]);

  const canManage = !!viewerRole && ['founder', 'project_manager'].includes(viewerRole);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <Users className="h-4 w-4 text-n-400" />
        <SummaryChip label="Activities" value={summary.total_activities} color="#1A1D24" />
        <SummaryChip label="SE (Shiroi)" value={summary.total_se} color="#065F46" />
        <SummaryChip label="OS (Outsourced)" value={summary.total_os} color="#1E40AF" />
        <SummaryChip label="Contractor" value={summary.total_contractor} color="#B45309" />
      </div>
      <ActivitiesClient
        projectId={projectId}
        rows={rows}
        stages={stages}
        canManage={canManage}
      />
    </div>
  );
}
