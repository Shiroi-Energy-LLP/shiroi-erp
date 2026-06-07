'use client';

/**
 * MilestonePhotosPanel — renders milestone photos grouped by milestone on the
 * Progress tab. Wired to the existing `listMilestonePhotos` server action
 * (apps/erp/src/lib/milestone-photos-actions.ts) which was added in E9 but
 * had no UI surface until now.
 *
 * Photos live in the `documents` bucket under
 * `milestone-photos/{project_number}/{milestone}/...`. We fetch signed URLs
 * lazily for thumbnails, and reuse the shared ImageViewer for the lightbox.
 */

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Camera, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@repo/ui';
import { listMilestonePhotos } from '@/lib/milestone-photos-actions';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';

type MilestoneRow = {
  id: string;
  milestone: string;
  uploaded_at: string;
  storage_path: string;
  location_verified: boolean | null;
  location_distance_m: number | null;
  uploaded_by: string | null;
};

// Mirrors MILESTONE_NAMES + presentation order from milestone-photos-actions.ts.
const MILESTONE_LABELS: Record<string, string> = {
  panel_install_start: 'Panel Install — Start',
  panel_install_complete: 'Panel Install — Complete',
  inverter_install: 'Inverter Install',
  commissioning: 'Commissioning',
  post_commissioning: 'Post-Commissioning',
};

const MILESTONE_ORDER = [
  'panel_install_start',
  'panel_install_complete',
  'inverter_install',
  'commissioning',
  'post_commissioning',
];

interface MilestonePhotosPanelProps {
  projectId: string;
}

function Thumbnail({ bucket, path, alt, onClick }: {
  bucket: string;
  path: string;
  alt: string;
  onClick: () => void;
}) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[MilestonePhotosPanel] signed URL failed', error.message);
          return;
        }
        setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-24 w-24 overflow-hidden rounded border border-n-200 bg-n-100 transition-shadow hover:shadow-md"
      title={alt}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Camera className="h-4 w-4 text-n-300" />
        </div>
      )}
    </button>
  );
}

export function MilestonePhotosPanel({ projectId }: MilestonePhotosPanelProps) {
  const [photos, setPhotos] = React.useState<MilestoneRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMilestonePhotos(projectId)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPhotos(result.data);
        } else {
          setError(result.error);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Flat list of every image (in milestone order) for the lightbox.
  const allImages: ViewableImage[] = React.useMemo(() => {
    const ordered: MilestoneRow[] = [];
    for (const m of MILESTONE_ORDER) {
      for (const p of photos) {
        if (p.milestone === m) ordered.push(p);
      }
    }
    return ordered.map((p) => ({
      id: p.id,
      name: `${MILESTONE_LABELS[p.milestone] ?? p.milestone} — ${new Date(p.uploaded_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      bucket: 'documents',
      path: p.storage_path,
    }));
  }, [photos]);

  function openImageById(id: string) {
    const idx = allImages.findIndex((img) => img.id === id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  // Group photos by milestone for rendering.
  const byMilestone = React.useMemo(() => {
    const map: Record<string, MilestoneRow[]> = {};
    for (const p of photos) {
      (map[p.milestone] ??= []).push(p);
    }
    return map;
  }, [photos]);

  return (
    <div className="rounded-lg border border-n-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-n-900 flex items-center gap-2">
            <Camera className="h-4 w-4 text-n-500" />
            Milestone Photos
          </h3>
          <p className="text-xs text-n-500 mt-0.5">
            GPS-verified field photos from each install milestone.
          </p>
        </div>
        {!loading && (
          <span className="text-xs text-n-500">{photos.length} total</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-4 text-xs text-n-400">Loading photos…</div>
      ) : error ? (
        <div className="text-center py-4 text-xs text-red-600">{error}</div>
      ) : photos.length === 0 ? (
        <div className="text-center py-6 text-xs text-n-400">
          No milestone photos uploaded yet.
        </div>
      ) : (
        <div className="space-y-4">
          {MILESTONE_ORDER.map((milestone) => {
            const rows = byMilestone[milestone] ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={milestone}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-n-700">
                    {MILESTONE_LABELS[milestone]}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {rows.length}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map((p) => (
                    <div key={p.id} className="flex flex-col items-start gap-1">
                      <Thumbnail
                        bucket="documents"
                        path={p.storage_path}
                        alt={p.id}
                        onClick={() => openImageById(p.id)}
                      />
                      <div className="flex items-center gap-1 text-[10px] text-n-500 w-24 truncate">
                        {p.location_verified === false ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-amber-600"
                            title={
                              p.location_distance_m !== null
                                ? `Outside 100m gate (${Math.round(p.location_distance_m)}m away)`
                                : 'GPS not verified'
                            }
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> off-site
                          </span>
                        ) : p.location_verified === true ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-shiroi-green"
                            title="GPS verified within 100m of site"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" /> verified
                          </span>
                        ) : (
                          <span className="text-n-400">no GPS</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ImageViewer
        images={allImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
