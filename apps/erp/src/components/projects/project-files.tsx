'use client';

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Select, Label,
} from '@repo/ui';
import { Upload, Download, FileText, Image, File, Trash2 } from 'lucide-react';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';

interface FileInfo {
  name: string;
  id: string;
  created_at: string;
  metadata: {
    size?: number;
    mimetype?: string;
  };
  /** The full path prefix before the filename (e.g. "{projectId}/photos" or "projects/{projectId}/photos") */
  pathPrefix: string;
  /** Storage bucket (defaults to 'project-files') */
  bucket: string;
}

interface ProjectFilesProps {
  projectId: string;
}

const FILE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'autocad', label: 'AutoCAD / Design' },
  { value: 'photos', label: 'Site Photos' },
  { value: 'documents', label: 'Documents / Approvals' },
  { value: 'warranty', label: 'Warranty Cards' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'purchase-orders', label: 'Purchase Orders' },
  { value: 'layouts', label: 'Layouts / Designs' },
  { value: 'delivery-challans', label: 'Delivery Challans' },
  { value: 'sesal', label: 'SESAL' },
] as const;

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimetype?: string) {
  if (!mimetype) return File;
  if (mimetype.startsWith('image/')) return Image;
  if (mimetype === 'application/pdf') return FileText;
  return File;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function ProjectFiles({ projectId }: ProjectFilesProps) {
  const [files, setFiles] = React.useState<Record<string, FileInfo[]>>({});
  const [uploading, setUploading] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState('general');
  const [loading, setLoading] = React.useState(true);
  const [dragOver, setDragOver] = React.useState(false);

  // Load files on mount
  React.useEffect(() => {
    loadAllFiles();
  }, [projectId]);

  async function loadAllFiles() {
    const op = '[ProjectFiles.loadAllFiles]';
    const supabase = createClient();

    // Scan both path patterns per category — all in PARALLEL instead of sequential
    const pathPrefixes = [
      `${projectId}`,
      `projects/${projectId}`,
    ];

    // 1. Launch all category scans in parallel (22 calls at once instead of sequential)
    const categoryPromises = FILE_CATEGORIES.flatMap((cat) =>
      pathPrefixes.map((prefix) => {
        const fullPath = `${prefix}/${cat.value}`;
        return supabase.storage
          .from('project-files')
          .list(fullPath, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
          .then(({ data, error }) => {
            if (error && !error.message?.includes('not found')) {
              console.error(`${op} List failed for ${fullPath}:`, error.message);
            }
            return {
              category: cat.value,
              files: (data ?? [])
                .filter((f) => f.name !== '.emptyFolderPlaceholder')
                .map((f) => ({
                  name: f.name,
                  id: f.id ?? `${prefix}-${f.name}`,
                  created_at: f.created_at ?? '',
                  metadata: {
                    size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
                    mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
                  },
                  pathPrefix: fullPath,
                  bucket: 'project-files',
                })),
            };
          });
      })
    );

    // 2. Also scan WhatsApp photos — get month folders first
    const waPromise = supabase.storage
      .from('site-photos')
      .list(`projects/${projectId}/whatsapp`, { limit: 100 })
      .then(async ({ data: waMonths }) => {
        if (!waMonths) return [] as FileInfo[];
        const folders = waMonths.filter((m) => !m.id);
        // Limit to last 6 months to avoid scanning 24+ folders
        const recentFolders = folders.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 6);
        // Scan all month folders in parallel
        const monthResults = await Promise.all(
          recentFolders.map((month) => {
            const monthPath = `projects/${projectId}/whatsapp/${month.name}`;
            return supabase.storage
              .from('site-photos')
              .list(monthPath, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
              .then(({ data: monthFiles }) =>
                (monthFiles ?? [])
                  .filter((f) => f.name !== '.emptyFolderPlaceholder')
                  .map((f) => ({
                    name: f.name,
                    id: f.id ?? `wa-${month.name}-${f.name}`,
                    created_at: f.created_at ?? '',
                    metadata: {
                      size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
                      mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
                    },
                    pathPrefix: monthPath,
                    bucket: 'site-photos',
                  }))
              );
          })
        );
        return monthResults.flat();
      });

    // 3. Wait for everything in parallel
    const [categoryResults, waPhotos] = await Promise.all([
      Promise.all(categoryPromises),
      waPromise,
    ]);

    // 4. Merge category results
    const allFiles: Record<string, FileInfo[]> = {};
    for (const result of categoryResults) {
      const existing = allFiles[result.category] ?? [];
      existing.push(...result.files);
      allFiles[result.category] = existing;
    }

    if (waPhotos.length > 0) {
      allFiles['whatsapp'] = waPhotos;
    }

    setFiles(allFiles);
    setLoading(false);
  }

  async function handleUpload(fileList: FileList | null) {
    const op = '[ProjectFiles.handleUpload]';
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    const supabase = createClient();

    try {
      for (const file of Array.from(fileList)) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${projectId}/${selectedCategory}/${timestamp}_${safeName}`;

        const { error } = await supabase.storage
          .from('project-files')
          .upload(filePath, file, { upsert: false });

        if (error) {
          console.error(`${op} Upload failed:`, { fileName: file.name, error: error.message });
          alert(`Upload failed for ${file.name}: ${error.message}`);
          continue;
        }
      }

      await loadAllFiles();
    } catch (error) {
      console.error(`${op} Failed:`, error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleUpload(e.target.files);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  async function handleDownload(bucket: string, pathPrefix: string, fileName: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(`${pathPrefix}/${fileName}`, 60);

    if (error || !data?.signedUrl) {
      console.error('[ProjectFiles.handleDownload] Failed:', error?.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  async function handleDelete(bucket: string, pathPrefix: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(bucket)
      .remove([`${pathPrefix}/${fileName}`]);

    if (error) {
      console.error('[ProjectFiles.handleDelete] Failed:', error.message);
      alert(`Delete failed: ${error.message}`);
      return;
    }

    await loadAllFiles();
  }

  const totalFiles = Object.values(files).reduce((sum, arr) => sum + arr.length, 0);

  // Collect all images for the viewer
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

  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  function openImage(file: FileInfo) {
    const idx = allImages.findIndex((img) => img.id === file.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  // All display categories (FILE_CATEGORIES + dynamic whatsapp)
  const displayCategories = [
    ...FILE_CATEGORIES,
    ...(files['whatsapp']?.length ? [{ value: 'whatsapp' as const, label: 'WhatsApp Photos' }] : []),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#7C818E]" />
            Project Files
            {totalFiles > 0 && (
              <span className="text-xs text-[#7C818E] font-normal">({totalFiles})</span>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload area */}
        <div
          className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
            dragOver
              ? 'border-[#00B050] bg-[#00B050]/5'
              : 'border-[#DFE2E8] hover:border-[#00B050]/50'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-5 w-5 mx-auto mb-2 text-[#9CA0AB]" />
          <p className="text-xs text-[#7C818E] mb-2">
            Drag & drop files here, or
          </p>
          <div className="flex items-center justify-center gap-2">
            <Select
              value={selectedCategory}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedCategory(e.target.value)}
              className="h-8 text-xs w-32"
            >
              {FILE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInput}
                disabled={uploading}
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.dwg,.dxf,.doc,.docx,.xls,.xlsx"
              />
              <Button variant="outline" size="sm" asChild disabled={uploading} className="h-8 text-xs">
                <span>{uploading ? 'Uploading...' : 'Browse'}</span>
              </Button>
            </label>
          </div>
        </div>

        {/* File list by category */}
        {loading ? (
          <p className="text-sm text-[#9CA0AB] text-center py-4">Loading files...</p>
        ) : totalFiles === 0 ? (
          <p className="text-sm text-[#9CA0AB] text-center py-2">No files uploaded yet.</p>
        ) : (
          <div className="space-y-3">
            {displayCategories.map((cat) => {
              const catFiles = files[cat.value] ?? [];
              if (catFiles.length === 0) return null;

              return (
                <div key={cat.value}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-1.5">
                    {cat.label} ({catFiles.length})
                  </p>
                  <div className="space-y-1">
                    {catFiles.map((file) => {
                      const Icon = getFileIcon(file.metadata?.mimetype);
                      const isImage = file.metadata?.mimetype?.startsWith('image/');
                      return (
                        <div
                          key={file.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#F5F6F8] group text-sm"
                        >
                          <Icon className="h-3.5 w-3.5 text-[#9CA0AB] flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => isImage ? openImage(file) : handleDownload(file.bucket, file.pathPrefix, file.name)}
                              className="text-[#00B050] hover:underline truncate block text-left text-[13px]"
                              title={file.name}
                            >
                              {file.name.replace(/^\d+_/, '')}
                            </button>
                            <span className="text-[11px] text-[#9CA0AB]">
                              {formatFileSize(file.metadata?.size)}
                              {file.created_at && ` · ${formatDate(file.created_at)}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => isImage ? openImage(file) : handleDownload(file.bucket, file.pathPrefix, file.name)}
                              className="p-1 text-[#7C818E] hover:text-[#00B050]"
                              title={isImage ? 'View' : 'Download'}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(file.bucket, file.pathPrefix, file.name)}
                              className="p-1 text-[#7C818E] hover:text-[#991B1B]"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <ImageViewer
        images={allImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </Card>
  );
}
