import { requireRole } from '@/lib/auth';
import { getSheetSyncData } from '@/lib/gsheet-sync-queries';
import { getProjectOptionsForActivities } from '@/lib/project-activities-queries';
import { SheetSyncClient } from '@/components/sheet-sync/sheet-sync-client';
import { KpiCard } from '@repo/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sheet Sync · Shiroi ERP' };

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export default async function SheetSyncPage({ searchParams }: Props) {
  await requireRole(['founder', 'project_manager']);
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const [data, projects] = await Promise.all([getSheetSyncData(page), getProjectOptionsForActivities()]);
  const lastRun = data.sources
    .map((s) => s.last_run_at)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sheet Sync</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Live mirror of Manivel&apos;s Google Sheets, refreshed every 10 minutes. Every edit he makes in the sheet
          shows up below as a change. Link sheet projects that weren&apos;t matched automatically. Nothing here
          modifies ERP projects yet.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Rows mirrored" value={data.mirroredRows} icon="Activity"
          subNote={lastRun ? `last run ${new Date(lastRun).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}` : 'never run'} />
        <KpiCard label="Pending changes" value={data.pendingChanges} icon="AlertTriangle" />
        <KpiCard label="Linked projects" value={data.linkedProjects} icon="CheckCircle" />
        <KpiCard label="Unlinked projects" value={data.unlinked.length} icon="Clock" subNote="Projects tab" />
      </div>

      <SheetSyncClient data={data} projects={projects} />
    </div>
  );
}
