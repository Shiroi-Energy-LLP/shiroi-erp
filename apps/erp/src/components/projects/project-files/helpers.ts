import { FileText, File, Image, Table2 } from 'lucide-react';
import { createClient } from '@repo/supabase/client';

import type { FileInfo } from './types';
import { SCAN_FOLDERS, FOLDER_TO_CATEGORY } from './types';

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

export function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

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

/**
 * Load every file in project-files + site-photos for a given project,
 * across both path prefixes ("projectId/" and "projects/projectId/")
 * and the WhatsApp photo months. Returns a map keyed by category.
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

  // 1. Scan every folder × prefix combo in parallel
  const categoryPromises = SCAN_FOLDERS.flatMap((folder) =>
    pathPrefixes.map((prefix) => {
      const fullPath = `${prefix}/${folder}`;
      return supabase.storage
        .from('project-files')
        .list(fullPath, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
        .then(({ data, error }) => {
          if (error && !error.message?.includes('not found')) {
            console.error(`${op} List failed for ${fullPath}:`, error.message);
          }
          return {
            category: FOLDER_TO_CATEGORY[folder] ?? 'general',
            files: (data ?? [])
              .filter((f) => f.name !== '.emptyFolderPlaceholder')
              .map((f) => ({
                name: f.name,
                id: f.id ?? `${prefix}-${folder}-${f.name}`,
                created_at: f.created_at ?? '',
                metadata: {
                  size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
                  mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
                },
                pathPrefix: fullPath,
                bucket: 'project-files',
              } satisfies FileInfo)),
          };
        });
    }),
  );

  // 2. WhatsApp photos live in a different bucket with a date-based folder structure
  const waPromise = supabase.storage
    .from('site-photos')
    .list(`projects/${projectId}/whatsapp`, { limit: 100 })
    .then(async ({ data: waMonths }) => {
      if (!waMonths) return [] as FileInfo[];
      const folders = waMonths.filter((m) => !m.id);
      const recentFolders = folders.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 6);
      const monthResults = await Promise.all(
        recentFolders.map((month) => {
          const monthPath = `projects/${projectId}/whatsapp/${month.name}`;
          return supabase.storage
            .from('site-photos')
            .list(monthPath, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
            .then(({ data: monthFiles }) =>
              (monthFiles ?? [])
                .filter((f) => f.name !== '.emptyFolderPlaceholder')
                .map(
                  (f) =>
                    ({
                      name: f.name,
                      id: f.id ?? `wa-${month.name}-${f.name}`,
                      created_at: f.created_at ?? '',
                      metadata: {
                        size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
                        mimetype: (f.metadata as Record<string, unknown>)?.mimetype as
                          | string
                          | undefined,
                      },
                      pathPrefix: monthPath,
                      bucket: 'site-photos',
                    }) satisfies FileInfo,
                ),
            );
        }),
      );
      return monthResults.flat();
    });

  const [categoryResults, waPhotos] = await Promise.all([
    Promise.all(categoryPromises),
    waPromise,
  ]);

  const allFiles: Record<string, FileInfo[]> = {};
  for (const result of categoryResults) {
    const existing = allFiles[result.category] ?? [];
    existing.push(...result.files);
    allFiles[result.category] = existing;
  }
  if (waPhotos.length > 0) {
    allFiles['whatsapp'] = waPhotos;
  }

  return allFiles;
}
