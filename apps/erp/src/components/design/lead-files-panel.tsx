'use client';

/**
 * LeadFilesPanel — reusable drag-drop file grid for leads.
 *
 * Scoped to the `proposal-files` bucket under the path prefix
 * `leads/{leadId}/{category}/{filename}`. Used by:
 *   - /design/[leadId] per-lead design workspace
 *   - /sales/[id] Quote tab (Files column)
 *
 * Intentionally lighter than the project Documents tab — no handover pack,
 * no auto-generated docs (DC/QC/Survey), just category boxes + drag-drop +
 * image slideshow. Reuses `CategoryBox` and `PhotoSlideshow` from the
 * existing project-files parts so there's one source of truth for the visual
 * pattern.
 *
 * On a lead's win transition, the DB trigger `fn_migrate_lead_files_to_project`
 * (migration 052) renames these storage paths from `leads/<lead_id>/**` to
 * `project-files/projects/<project_id>/**`, at which point they surface in
 * the project Documents tab instead.
 */
import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Button, Select } from '@repo/ui';
import {
  Upload,
  PenTool,
  BarChart3,
  Camera,
  FileText,
  Presentation,
  Folder,
} from 'lucide-react';
import type { FileInfo, DragData, DocumentCategory } from '@/components/projects/project-files/types';
import { CategoryBox, PhotoSlideshow } from '@/components/projects/project-files/parts-boxes';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';

const LEAD_FILE_CATEGORIES: readonly DocumentCategory[] = [
  { value: 'drawings', label: 'Drawings', icon: PenTool },
  { value: 'pvsyst', label: 'PVsyst', icon: BarChart3 },
  { value: 'photos', label: 'Photos', icon: Camera },
  { value: 'specs', label: 'Specs', icon: FileText },
  { value: 'proposal', label: 'Proposal', icon: Presentation },
  { value: 'misc', label: 'Misc', icon: Folder },
] as const;

const BUCKET = 'proposal-files';

interface LeadFilesPanelProps {
  leadId: string;
  /** When true, upload / drag-drop / delete controls are hidden (for sales read-only view). */
  readOnly?: boolean;
}

export function LeadFilesPanel({ leadId, readOnly = false }: LeadFilesPanelProps) {
  const [files, setFiles] = React.useState<Record<string, FileInfo[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState('drawings');
  const [dragOverCategory, setDragOverCategory] = React.useState<string | null>(null);

  // Image viewer
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  /* ─── Load files (scan every category subfolder) ─────────────────── */

  const reloadFiles = React.useCallback(async () => {
    const supabase = createClient();
    const categoryResults = await Promise.all(
      LEAD_FILE_CATEGORIES.map(async (cat) => {
        const pathPrefix = `leads/${leadId}/${cat.value}`;
        const { data, error } = await supabase.storage.from(BUCKET).list(pathPrefix, {
          limit: 500,
          sortBy: { column: 'created_at', order: 'desc' },
        });
        if (error) {
          console.error(`[LeadFilesPanel.load] ${cat.value} failed:`, error.message);
          return [cat.value, [] as FileInfo[]] as const;
        }
        const entries = (data ?? [])
          .filter((entry) => entry.name && !entry.name.endsWith('/'))
          .map(
            (entry): FileInfo => ({
              name: entry.name,
              id: entry.id ?? `${pathPrefix}/${entry.name}`,
              created_at: entry.created_at ?? new Date().toISOString(),
              metadata: (entry.metadata ?? {}) as FileInfo['metadata'],
              pathPrefix,
              bucket: BUCKET,
            }),
          );
        return [cat.value, entries] as const;
      }),
    );
    const byCategory: Record<string, FileInfo[]> = {};
    for (const [cat, entries] of categoryResults) {
      byCategory[cat] = entries;
    }
    setFiles(byCategory);
    setLoading(false);
  }, [leadId]);

  React.useEffect(() => {
    reloadFiles();
  }, [reloadFiles]);

  /* ─── Upload ─────────────────────────────────────────────────────── */

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const supabase = createClient();
    try {
      for (const file of Array.from(fileList)) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `leads/${leadId}/${selectedCategory}/${timestamp}_${safeName}`;
        const { error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
          upsert: false,
        });
        if (error) {
          console.error('[LeadFilesPanel.upload] Failed:', {
            fileName: file.name,
            error: error.message,
          });
          alert(`Upload failed for ${file.name}: ${error.message}`);
        }
      }
      await reloadFiles();
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleUpload(e.target.files);
    e.target.value = '';
  }

  async function handleDownload(file: FileInfo) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(file.bucket)
      .createSignedUrl(`${file.pathPrefix}/${file.name}`, 60);
    if (error || !data?.signedUrl) {
      console.error('[LeadFilesPanel.download] Failed:', error?.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  async function handleDelete(file: FileInfo) {
    if (!confirm(`Delete "${file.name.replace(/^\d+_/, '')}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(file.bucket)
      .remove([`${file.pathPrefix}/${file.name}`]);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    await reloadFiles();
  }

  /* ─── Drag & drop recategorization (within proposal-files bucket) ── */

  function handleDragStart(e: React.DragEvent, file: FileInfo, sourceCategory: string) {
    if (readOnly) return;
    const data: DragData = {
      fileName: file.name,
      bucket: file.bucket,
      pathPrefix: file.pathPrefix,
      sourceCategory,
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'move';
  }

  async function handleDrop(e: React.DragEvent, targetCategory: string) {
    e.preventDefault();
    setDragOverCategory(null);
    if (readOnly) return;

    let data: DragData;
    try {
      data = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    if (data.sourceCategory === targetCategory) return;

    setMoving(true);
    const supabase = createClient();
    const oldPath = `${data.pathPrefix}/${data.fileName}`;
    const newPath = `leads/${leadId}/${targetCategory}/${data.fileName}`;

    try {
      const { error } = await supabase.storage.from(BUCKET).move(oldPath, newPath);
      if (error) {
        alert(`Move failed: ${error.message}`);
        return;
      }
      await reloadFiles();
    } finally {
      setMoving(false);
    }
  }

  /* ─── Image viewer ───────────────────────────────────────────────── */

  const allImages: ViewableImage[] = React.useMemo(() => {
    const imgs: ViewableImage[] = [];
    for (const catFiles of Object.values(files)) {
      for (const f of catFiles) {
        if (f.metadata?.mimetype?.startsWith('image/')) {
          imgs.push({
            id: f.id,
            name: f.name,
            bucket: f.bucket,
            path: `${f.pathPrefix}/${f.name}`,
          });
        }
      }
    }
    return imgs;
  }, [files]);

  const photoFiles = files['photos'] ?? [];

  function openImage(file: FileInfo) {
    const idx = allImages.findIndex((img) => img.id === file.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  function openSlideshowImage(photoIndex: number) {
    const photo = photoFiles[photoIndex];
    if (!photo) return;
    const idx = allImages.findIndex((img) => img.id === photo.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  const totalFiles = Object.values(files).reduce((sum, arr) => sum + arr.length, 0);
  const gridCategories = LEAD_FILE_CATEGORIES.filter((c) => c.value !== 'photos');

  /* ─── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-[#F5F6F8] rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-[#F5F6F8] rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      {!readOnly && (
        <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#DFE2E8]">
          <Select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-48 h-9 text-sm"
          >
            {LEAD_FILE_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => document.getElementById('lead-files-upload-input')?.click()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {uploading ? 'Uploading...' : 'Upload Files'}
          </Button>
          <input
            id="lead-files-upload-input"
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <span className="text-xs text-[#7C818E]">{totalFiles} files total</span>
          {moving && <span className="text-xs text-[#7C818E]">Moving...</span>}
        </div>
      )}

      {/* Photo slideshow (if any photos) */}
      {photoFiles.length > 0 && (
        <PhotoSlideshow photos={photoFiles} onOpenViewer={openSlideshowImage} />
      )}

      {/* Category grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {gridCategories.map((category) => (
          <CategoryBox
            key={category.value}
            category={category}
            files={files[category.value] ?? []}
            isDropTarget={dragOverCategory === category.value}
            onDragOver={() => setDragOverCategory(category.value)}
            onDragLeave={() => setDragOverCategory(null)}
            onDrop={(e) => handleDrop(e, category.value)}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onDragStart={handleDragStart}
            onOpenImage={openImage}
          />
        ))}
      </div>

      {/* Image viewer */}
      <ImageViewer
        images={allImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
