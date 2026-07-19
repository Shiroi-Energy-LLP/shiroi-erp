import { FileText, File, Image, Table2 } from 'lucide-react';
import { createClient } from '@repo/supabase/client';
import { formatDateFromTimestamp } from '@repo/ui/formatters';

import type { FileInfo } from './types';
import { FOLDER_TO_CATEGORY } from './types';

/**
 * Format helpers + the big storage-scan function.
 * Pure logic — no React imports here so the main shell (which is a
 * client component) can consume this via a dynamic call.
 */

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(mimetype?: string) {
  if (!mimetype) return File;
  if (mimetype.startsWith('image/')) return Image;
  if (mimetype === 'application/pdf') return FileText;
  if (mimetype.includes('spreadsheetml') || mimetype.includes('ms-excel')) return Table2;
  return File;
}

/**
 * Re-export of the canonical ISO-timestamp formatter. Kept here under the
 * old name so existing callers (`./index.tsx`, `./parts-rows.tsx`, etc.)
 * don't need to update their imports. C4 follow-up 2026-06-06.
 */
export const formatDate = formatDateFromTimestamp;

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Row shape returned by the `list_bucket_objects` RPC (mig 207). */
interface BucketObjectRow {
  name: string;
  id: string | null;
  created_at: string | null;
  metadata: unknown;
}

/** Map one RPC row (full object path) into a FileInfo, splitting dirname/basename. */
function toFileInfo(row: BucketObjectRow, bucket: string): FileInfo {
  const lastSlash = row.name.lastIndexOf('/');
  const base = lastSlash === -1 ? row.name : row.name.slice(lastSlash + 1);
  const dir = lastSlash === -1 ? '' : row.name.slice(0, lastSlash);
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    name: base,
    id: row.id ?? row.name,
    created_at: row.created_at ?? '',
    metadata: {
      size: meta.size as number | undefined,
      mimetype: meta.mimetype as string | undefined,
    },
    pathPrefix: dir,
    bucket,
  };
}

/**
 * Load every file in project-files + site-photos for a given project,
 * across both path prefixes ("projectId/" and "projects/projectId/")
 * and the WhatsApp photos. Returns a map keyed by category.
 *
 * One `list_bucket_objects` RPC per bucket (mig 207) replaces the old
 * 13-folder × 2-prefix + whatsapp-month storage.search() walk (up to 33
 * round-trips per view; storage.search was ~28% of all DB time). Files in
 * folders outside FOLDER_TO_CATEGORY now surface under "general" instead
 * of being invisible.
 *
 * Kept as a standalone function (not a hook) so the main shell can
 * call it from useEffect + after mutations without any React
 * re-render weirdness.
 */
export async function loadAllProjectFiles(
  projectId: string,
): Promise<Record<string, FileInfo[]>> {
  const op = '[loadAllProjectFiles]';
  const supabase = createClient();

  const pathPrefixes = [projectId, `projects/${projectId}`];
  const waPrefix = `projects/${projectId}/whatsapp`;

  const [projectFilesRes, waRes] = await Promise.all([
    supabase.rpc('list_bucket_objects', {
      p_bucket: 'project-files',
      p_prefixes: pathPrefixes,
      p_limit: 2000,
    }),
    supabase.rpc('list_bucket_objects', {
      p_bucket: 'site-photos',
      p_prefixes: [waPrefix],
      p_limit: 1200,
    }),
  ]);

  if (projectFilesRes.error) {
    console.error(`${op} project-files listing failed:`, projectFilesRes.error.message);
  }
  if (waRes.error) {
    console.error(`${op} site-photos listing failed:`, waRes.error.message);
  }

  const allFiles: Record<string, FileInfo[]> = {};

  for (const row of projectFilesRes.data ?? []) {
    if (row.name.endsWith('.emptyFolderPlaceholder')) continue;
    const prefix = pathPrefixes.find((p) => row.name.startsWith(`${p}/`));
    if (!prefix) continue;
    const rel = row.name.slice(prefix.length + 1); // "folder/…/file" or "file"
    const firstSlash = rel.indexOf('/');
    const topFolder = firstSlash === -1 ? '' : rel.slice(0, firstSlash);
    const category = FOLDER_TO_CATEGORY[topFolder] ?? 'general';
    const existing = allFiles[category] ?? [];
    existing.push(toFileInfo(row, 'project-files'));
    allFiles[category] = existing;
  }

  const waPhotos = (waRes.data ?? [])
    .filter((row) => !row.name.endsWith('.emptyFolderPlaceholder'))
    .map((row) => toFileInfo(row, 'site-photos'));
  if (waPhotos.length > 0) {
    allFiles['whatsapp'] = waPhotos;
  }

  return allFiles;
}
