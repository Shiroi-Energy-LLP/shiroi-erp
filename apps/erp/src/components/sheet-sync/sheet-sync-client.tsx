'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge, Button,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import { linkSheetProject, setSheetChangeReview } from '@/lib/gsheet-sync-actions';
import type { SheetSyncData } from '@/lib/gsheet-sync-queries';

const PAGE_SIZE = 50; // matches CHANGES_PAGE_SIZE in gsheet-sync-queries (type-only import here)

interface ProjectOpt { id: string; project_number: string | null; customer_name: string; project_name: string | null }

function istDateTime(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(s: string | null): string {
  switch (s) {
    case 'ok': return 'bg-emerald-100 text-emerald-800';
    case 'partial': return 'bg-amber-100 text-amber-900';
    case 'error': return 'bg-red-100 text-red-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

function changeBadge(t: string): string {
  switch (t) {
    case 'insert': return 'bg-emerald-100 text-emerald-800';
    case 'remove': return 'bg-red-100 text-red-800';
    default: return 'bg-sky-100 text-sky-800';
  }
}

// insert/remove rows carry the whole sheet row as JSON — show it compactly.
function summariseRow(v: string | null): string {
  if (!v) return '';
  try {
    const obj = JSON.parse(v) as Record<string, string>;
    return Object.entries(obj).filter(([, val]) => val).map(([k, val]) => `${k}: ${val}`).join(' · ');
  } catch {
    return v;
  }
}

function UnlinkedRow({ row, projects }: {
  row: SheetSyncData['unlinked'][number];
  projects: ProjectOpt[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!row.source_id || !row.project_key || !projectId) return;
    setSaving(true);
    setError(null);
    const res = await linkSheetProject(row.source_id, row.project_key, projectId);
    setSaving(false);
    if (!res.success) { setError(res.error); return; }
    router.refresh();
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{row.project_name}</TableCell>
      <TableCell>{row.size ?? '—'}</TableCell>
      <TableCell>{row.status ?? '—'}</TableCell>
      <TableCell>{row.years ?? '—'}</TableCell>
      <TableCell>{row.location ?? '—'}</TableCell>
      <TableCell className="min-w-[280px]">
        <div className="flex items-center gap-2">
          <ProjectCombobox projects={projects} value={projectId} onChange={setProjectId}
            className="w-64" inputClassName="h-8 text-xs" />
          <Button size="sm" disabled={!projectId || saving} onClick={save}>{saving ? 'Linking…' : 'Link'}</Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </TableCell>
    </TableRow>
  );
}

function ChangeRow({ change }: { change: SheetSyncData['changes'][number] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function mark(status: 'applied' | 'ignored' | 'pending') {
    setBusy(true);
    const res = await setSheetChangeReview(change.id, status);
    setBusy(false);
    if (res.success) router.refresh();
  }

  const detail = change.change_type === 'update'
    ? <><span className="text-slate-500 line-through">{change.old_value || '∅'}</span> → <span>{change.new_value || '∅'}</span></>
    : <span className="text-slate-600">{summariseRow(change.change_type === 'insert' ? change.new_value : change.old_value)}</span>;

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs">{istDateTime(change.detected_at)}</TableCell>
      <TableCell className="text-xs">{change.tab}</TableCell>
      <TableCell className="text-xs">{change.projectLabel ?? <span className="text-amber-700">{change.project_key ?? '—'} (unlinked)</span>}</TableCell>
      <TableCell><Badge className={changeBadge(change.change_type)}>{change.change_type}</Badge></TableCell>
      <TableCell className="text-xs">{change.field ?? '—'}</TableCell>
      <TableCell className="max-w-[420px] break-words text-xs">{detail}</TableCell>
      <TableCell className="whitespace-nowrap">
        {change.review_status === 'pending' ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => mark('applied')}>Applied</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => mark('ignored')}>Ignore</Button>
          </div>
        ) : (
          <button type="button" className="text-xs text-slate-500 underline" disabled={busy} onClick={() => mark('pending')}>
            {change.review_status} · undo
          </button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function SheetSyncClient({ data, projects }: { data: SheetSyncData; projects: ProjectOpt[] }) {
  const totalPages = Math.max(1, Math.ceil(data.changesTotal / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sources</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sheet</TableHead><TableHead>Tabs</TableHead><TableHead>Last run</TableHead>
              <TableHead>Status</TableHead><TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.title}{!s.enabled && ' (disabled)'}</TableCell>
                <TableCell className="text-xs">{s.tabs.join(', ')}</TableCell>
                <TableCell className="text-xs">{istDateTime(s.last_run_at)}</TableCell>
                <TableCell><Badge className={statusBadge(s.last_status)}>{s.last_status ?? 'never'}</Badge></TableCell>
                <TableCell className="max-w-[360px] text-xs text-red-700">
                  {s.last_error?.includes('403')
                    ? 'No access — Manivel needs to share this sheet with the ERP service account as Editor.'
                    : s.last_error ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Unlinked sheet projects ({data.unlinked.length})</h2>
        <p className="text-sm text-slate-500">
          Projects-tab rows not matched to an ERP project. Linking one also tags all of its past and future sheet changes.
        </p>
        {data.unlinked.length === 0 ? (
          <p className="text-sm text-slate-500">Every sheet project is linked.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sheet project</TableHead><TableHead>Size</TableHead><TableHead>Status</TableHead>
                  <TableHead>Year</TableHead><TableHead>Location</TableHead><TableHead>Link to ERP project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.unlinked.map((u) => (
                  <UnlinkedRow key={`${u.source_id}:${u.project_key}`} row={u} projects={projects} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Changes from the sheet ({data.changesTotal})</h2>
        {data.changes.length === 0 ? (
          <p className="text-sm text-slate-500">No edits detected since the first sync.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Tab</TableHead><TableHead>Project</TableHead>
                  <TableHead>Type</TableHead><TableHead>Field</TableHead><TableHead>Change</TableHead><TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.changes.map((c) => <ChangeRow key={c.id} change={c} />)}
              </TableBody>
            </Table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            {data.page > 1 && <Link className="underline" href={`/sheet-sync?page=${data.page - 1}&logPage=${data.logPage}`}>← Newer</Link>}
            <span className="text-slate-500">Page {data.page} of {totalPages}</span>
            {data.page < totalPages && <Link className="underline" href={`/sheet-sync?page=${data.page + 1}&logPage=${data.logPage}`}>Older →</Link>}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">ERP overwrites from the sheet ({data.overwritesTotal})</h2>
        <p className="text-sm text-slate-500">What the sync changed in ERP projects — the old value is kept here so any change can be traced or reverted.</p>
        {data.overwrites.length === 0 ? (
          <p className="text-sm text-slate-500">No ERP projects have been changed by the sync yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Project</TableHead><TableHead>Action</TableHead>
                  <TableHead>Field</TableHead><TableHead>Old → New</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.overwrites.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap text-xs">{istDateTime(o.applied_at)}</TableCell>
                    <TableCell className="text-xs">
                      <Link className="underline" href={`/projects/${o.project_id}`}>{o.projectLabel ?? o.project_id.slice(0, 8)}</Link>
                    </TableCell>
                    <TableCell><Badge className={o.action === 'create' ? changeBadge('insert') : changeBadge('update')}>{o.action}</Badge></TableCell>
                    <TableCell className="text-xs">{o.field ?? '—'}</TableCell>
                    <TableCell className="max-w-[420px] break-words text-xs">
                      {o.action === 'create'
                        ? <span>{o.new_value}</span>
                        : <><span className="text-slate-500 line-through">{o.old_value || '∅'}</span> → <span>{o.new_value || '∅'}</span></>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {Math.ceil(data.overwritesTotal / PAGE_SIZE) > 1 && (
          <div className="flex items-center gap-3 text-sm">
            {data.logPage > 1 && <Link className="underline" href={`/sheet-sync?page=${data.page}&logPage=${data.logPage - 1}`}>← Newer</Link>}
            <span className="text-slate-500">Page {data.logPage} of {Math.ceil(data.overwritesTotal / PAGE_SIZE)}</span>
            {data.logPage < Math.ceil(data.overwritesTotal / PAGE_SIZE) && <Link className="underline" href={`/sheet-sync?page=${data.page}&logPage=${data.logPage + 1}`}>Older →</Link>}
          </div>
        )}
      </section>
    </div>
  );
}
