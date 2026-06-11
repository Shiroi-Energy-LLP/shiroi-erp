'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@repo/ui';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { ActivityFormDialog } from './activity-form-dialog';
import { deleteProjectActivity } from '@/lib/project-activities-actions';
import {
  MANPOWER_LABELS, MANPOWER_ORDER,
  type ActivityStageOption, type ManpowerType, type ProjectActivityRow,
} from '@/lib/project-activities-constants';

function formatDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function DeleteActivityButton({ projectId, activityId }: { projectId: string; activityId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm('Delete this activity?')) return;
    setDeleting(true);
    const result = await deleteProjectActivity({ projectId, activityId });
    setDeleting(false);
    if (result.success) router.refresh();
    else alert(result.error);
  }

  return (
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete} disabled={deleting}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

interface ActivitiesClientProps {
  projectId: string;
  rows: ProjectActivityRow[];
  stages: ActivityStageOption[];
  canManage: boolean;
  /** Global view: show the Project column + skip client-side filters (server filters instead). */
  showProject?: boolean;
  clientFilters?: boolean;
}

export function ActivitiesClient({
  projectId, rows, stages, canManage, showProject = false, clientFilters = true,
}: ActivitiesClientProps) {
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [stageId, setStageId] = React.useState('');
  const [manpower, setManpower] = React.useState<'' | ManpowerType>('');

  const filtered = React.useMemo(() => {
    if (!clientFilters) return rows;
    return rows.filter((r) => {
      if (from && r.activity_date < from) return false;
      if (to && r.activity_date > to) return false;
      if (stageId && r.stage_id !== stageId) return false;
      if (manpower === 'se' && r.se_count <= 0) return false;
      if (manpower === 'os' && r.os_count <= 0) return false;
      if (manpower === 'contractor' && r.contractor_count <= 0) return false;
      return true;
    });
  }, [rows, from, to, stageId, manpower, clientFilters]);

  return (
    <div className="space-y-3">
      {clientFilters && (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Stage</label>
            <Select value={stageId} onChange={(e) => setStageId(e.target.value)} className="h-8 text-xs w-[180px]">
              <option value="">All stages</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Manpower</label>
            <Select value={manpower} onChange={(e) => setManpower(e.target.value as '' | ManpowerType)} className="h-8 text-xs w-[150px]">
              <option value="">All types</option>
              {MANPOWER_ORDER.map((m) => <option key={m} value={m}>{MANPOWER_LABELS[m]}</option>)}
            </Select>
          </div>
          {canManage && (
            <div className="ml-auto">
              <ActivityFormDialog
                projectId={projectId}
                stages={stages}
                trigger={<Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Add Activity</Button>}
              />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto border border-n-200 rounded-lg">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-n-200 bg-n-50">
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[30px]">#</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[90px]">Date</th>
              {showProject && (
                <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Project</th>
              )}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[140px]">Stage</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[110px]">Done By</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Description</th>
              <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[40px]">SE</th>
              <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[40px]">OS</th>
              <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[70px]">Contractor</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[120px]">Notes</th>
              {canManage && (
                <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[60px]">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showProject ? 11 : 10} className="px-3 py-6 text-center text-n-400">
                  No activities recorded{canManage ? ' — use “Add Activity” to log the first one.' : ' yet.'}
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <tr key={r.id} className="border-b border-n-100 hover:bg-n-50">
                <td className="px-2 py-1.5 font-mono text-n-400">{i + 1}</td>
                <td className="px-2 py-1.5 text-n-700 whitespace-nowrap">{formatDay(r.activity_date)}</td>
                {showProject && (
                  <td className="px-2 py-1.5">
                    <a href={`/projects/${r.project_id}?tab=execution`} className="text-blue-600 hover:underline">
                      {r.project_display ?? '—'}
                    </a>
                  </td>
                )}
                <td className="px-2 py-1.5 text-n-700">{r.stage_label ?? r.stage_custom ?? '—'}</td>
                <td className="px-2 py-1.5 text-n-700">{r.done_by ?? '—'}</td>
                <td className="px-2 py-1.5 text-n-900 max-w-[420px]">
                  <span className="whitespace-normal break-words">{r.description}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{r.se_count || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.os_count || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.contractor_count || '—'}</td>
                <td className="px-2 py-1.5 text-n-500 max-w-[200px]">
                  <span className="whitespace-normal break-words">{r.notes ?? '—'}</span>
                </td>
                {canManage && (
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <ActivityFormDialog
                        projectId={r.project_id}
                        stages={stages}
                        existing={r}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400 hover:text-n-700">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <DeleteActivityButton projectId={r.project_id} activityId={r.id} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
