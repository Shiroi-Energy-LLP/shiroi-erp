import { Suspense } from 'react';
import Link from 'next/link';
import { Users, Plus } from 'lucide-react';
import { Button } from '@repo/ui';
import { ActivityFormDialog } from '@/components/projects/activities/activity-form-dialog';
import {
  listProjectActivities,
  getActivitiesSummary,
  getActivityStageOptions,
  getProjectOptionsForActivities,
  ACTIVITIES_PAGE_SIZE,
} from '@/lib/project-activities-queries';
import { getUserProfile } from '@/lib/auth';
import { ActivitiesClient } from '@/components/projects/activities/activities-client';
import { GlobalActivitiesFilters } from '@/components/activities/global-activities-filters';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    project?: string;
    search?: string;
    from?: string;
    to?: string;
    stage?: string;
    page?: string;
  }>;
}

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[110px]">
      <div className="text-[10px] text-n-500 mb-0.5">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

export default async function ActivitiesPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
  const filters = {
    projectId: params.project || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    stageId: params.stage || undefined,
  };

  const [{ rows, hasMore }, summary, stages, projects, profile] = await Promise.all([
    listProjectActivities({ ...filters, search: params.search || undefined, page }),
    getActivitiesSummary(filters),
    getActivityStageOptions(),
    getProjectOptionsForActivities(),
    getUserProfile(),
  ]);

  const canManage = !!profile && ['founder', 'project_manager'].includes(profile.role);

  function pageHref(p: number): string {
    const sp = new URLSearchParams();
    if (params.project) sp.set('project', params.project);
    if (params.search) sp.set('search', params.search);
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (params.stage) sp.set('stage', params.stage);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `/activities?${qs}` : '/activities';
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-n-500">Execution</div>
          <h1 className="text-2xl font-semibold">Activities — All Projects</h1>
        </div>
        {canManage && (
          <ActivityFormDialog
            stages={stages}
            projects={projects}
            trigger={<Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Add Activity</Button>}
          />
        )}
      </div>

      {/* Org-wide manpower + activity stats (SQL-aggregated, filter-aware) */}
      <div className="flex gap-3 flex-wrap items-center">
        <Users className="h-4 w-4 text-n-400" />
        <SummaryChip label="Activities" value={summary.total_activities} color="#1A1D24" />
        <SummaryChip label="Projects" value={summary.distinct_projects} color="#7C3AED" />
        <SummaryChip label="SE (Shiroi)" value={summary.total_se} color="#065F46" />
        <SummaryChip label="OS (Outsourced)" value={summary.total_os} color="#1E40AF" />
        <SummaryChip label="Contractor" value={summary.total_contractor} color="#B45309" />
      </div>

      <Suspense>
        <GlobalActivitiesFilters stages={stages} />
      </Suspense>

      <ActivitiesClient
        projectId=""
        rows={rows}
        stages={stages}
        canManage={canManage}
        showProject
        clientFilters={false}
      />

      <div className="flex items-center justify-between text-xs text-n-500">
        <span>Page {page} · {rows.length} row{rows.length === 1 ? '' : 's'}{hasMore ? '+' : ''}</span>
        <span className="flex gap-3">
          {page > 1 && <Link className="text-blue-600 hover:underline" href={pageHref(page - 1)}>← Previous</Link>}
          {hasMore && <Link className="text-blue-600 hover:underline" href={pageHref(page + 1)}>Next →</Link>}
        </span>
      </div>
      <p className="text-[10px] text-n-400">
        Showing up to {ACTIVITIES_PAGE_SIZE} per page.
      </p>
    </div>
  );
}
