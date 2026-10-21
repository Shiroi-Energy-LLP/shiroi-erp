import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

/**
 * Reads for /sheet-sync — Manivel's Google Sheet live mirror (mig 224,
 * spec docs/superpowers/specs/2026-10-21-manivel-sheet-live-sync-design.md).
 * Counts only; no money is aggregated here.
 */

type SourceRow = Database['public']['Tables']['gsheet_sources']['Row'];
type RunRow = Database['public']['Tables']['gsheet_sync_runs']['Row'];
type ChangeRow = Database['public']['Tables']['gsheet_changes']['Row'];
type UnlinkedRow = Database['public']['Views']['gsheet_unlinked_projects']['Row'];
type ApplyLogRow = Database['public']['Tables']['gsheet_apply_log']['Row'];

export const CHANGES_PAGE_SIZE = 50;

export interface SheetSyncChange extends ChangeRow {
  projectLabel: string | null;
}

export interface SheetSyncOverwrite extends ApplyLogRow {
  projectLabel: string | null;
}

export interface SheetSyncData {
  sources: SourceRow[];
  latestRuns: RunRow[];
  mirroredRows: number;
  pendingChanges: number;
  linkedProjects: number;
  unlinked: UnlinkedRow[];
  changes: SheetSyncChange[];
  changesTotal: number;
  page: number;
  overwrites: SheetSyncOverwrite[];
  overwritesTotal: number;
  logPage: number;
}

export async function getSheetSyncData(page: number, logPage: number): Promise<SheetSyncData> {
  const op = '[getSheetSyncData]';
  const supabase = await createClient();
  const from = (page - 1) * CHANGES_PAGE_SIZE;
  const logFrom = (logPage - 1) * CHANGES_PAGE_SIZE;

  const [srcRes, runRes, rowsRes, pendingRes, linkedRes, unlinkedRes, changesRes, logRes] = await Promise.all([
    supabase.from('gsheet_sources').select('*').order('id'),
    supabase.from('gsheet_sync_runs').select('*').order('started_at', { ascending: false }).range(0, 9),
    supabase.from('gsheet_rows').select('row_key', { count: 'estimated', head: true }).is('removed_at', null),
    supabase.from('gsheet_changes').select('id', { count: 'estimated', head: true }).eq('review_status', 'pending'),
    supabase.from('gsheet_project_links').select('project_key', { count: 'estimated', head: true }).not('project_id', 'is', null),
    supabase.from('gsheet_unlinked_projects').select('*').order('project_name').range(0, 999),
    supabase.from('gsheet_changes').select('*', { count: 'estimated' })
      .order('detected_at', { ascending: false }).range(from, from + CHANGES_PAGE_SIZE - 1),
    supabase.from('gsheet_apply_log').select('*', { count: 'estimated' })
      .order('applied_at', { ascending: false }).range(logFrom, logFrom + CHANGES_PAGE_SIZE - 1),
  ]);

  for (const [name, res] of [['sources', srcRes], ['runs', runRes], ['rows', rowsRes], ['pending', pendingRes],
    ['linked', linkedRes], ['unlinked', unlinkedRes], ['changes', changesRes], ['apply log', logRes]] as const) {
    if (res.error) console.error(`${op} ${name} query failed`, { code: res.error.code, message: res.error.message });
  }

  const changes = changesRes.data ?? [];
  const overwrites = logRes.data ?? [];
  const projectIds = [...new Set([...changes.map((c) => c.project_id), ...overwrites.map((o) => o.project_id)]
    .filter((id): id is string => !!id))];
  const labels = new Map<string, string>();
  if (projectIds.length) {
    const { data: projects, error } = await supabase
      .from('projects').select('id, project_number, customer_name, project_name').in('id', projectIds);
    if (error) console.error(`${op} project labels failed`, { code: error.code, message: error.message });
    for (const p of projects ?? []) {
      labels.set(p.id, `${p.project_number ?? ''} ${p.project_name || p.customer_name || ''}`.trim());
    }
  }

  return {
    sources: srcRes.data ?? [],
    latestRuns: runRes.data ?? [],
    mirroredRows: rowsRes.count ?? 0,
    pendingChanges: pendingRes.count ?? 0,
    linkedProjects: linkedRes.count ?? 0,
    unlinked: unlinkedRes.data ?? [],
    changes: changes.map((c) => ({ ...c, projectLabel: c.project_id ? labels.get(c.project_id) ?? null : null })),
    changesTotal: changesRes.count ?? 0,
    page,
    overwrites: overwrites.map((o) => ({ ...o, projectLabel: labels.get(o.project_id) ?? null })),
    overwritesTotal: logRes.count ?? 0,
    logPage,
  };
}
