'use client';

/**
 * ProjectFiles — the Documents tab main shell.
 *
 * Split per the April 14 audit (CLAUDE.md rule #14). Original was
 * 1,124 LOC; shell now under 500.
 *
 *   ./types.ts          FileInfo / LeadFileInfo / HandoverPackData /
 *                       DeliveryChallanInfo / QcInspectionInfo /
 *                       SurveyInfo + DOCUMENT_CATEGORIES + FOLDER_TO_CATEGORY
 *   ./helpers.ts        format helpers + loadAllProjectFiles() scan function
 *   ./parts-rows.tsx    HandoverBox / FileRow / LeadFileRow / GeneratedDocRow
 *   ./parts-boxes.tsx   PhotoSlideshow / CategoryBox
 */
import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Card, CardHeader, CardTitle, CardContent, Button, Select } from '@repo/ui';
import { Upload, Camera, Users } from 'lucide-react';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';

import type { FileInfo, ProjectFilesProps, DragData } from './types';
import { DOCUMENT_CATEGORIES } from './types';
import { loadAllProjectFiles } from './helpers';
import { HandoverBox, FileRow } from './parts-rows';
import { PhotoSlideshow, CategoryBox } from './parts-boxes';
import { buildSurveyGenerated, buildDcGenerated, buildQcGenerated } from './generated-docs';

export type {
  FileInfo,
  LeadFileInfo,
  HandoverPackData,
  DeliveryChallanInfo,
  QcInspectionInfo,
  SurveyInfo,
  ProjectFilesProps,
} from './types';

export function ProjectFiles({
  projectId,
  leadId,
  leadFiles,
  handoverPack,
  deliveryChallans,
  qcInspections,
  surveyData,
}: ProjectFilesProps) {
  const [files, setFiles] = React.useState<Record<string, FileInfo[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState('general');
  const [dragOverCategory, setDragOverCategory] = React.useState<string | null>(null);

  // Image viewer
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  /* ─── Load files ─────────────────────────────────────────────────── */

  const reloadFiles = React.useCallback(async () => {
    const allFiles = await loadAllProjectFiles(projectId);
    setFiles(allFiles);
    setLoading(false);
  }, [projectId]);

  React.useEffect(() => {
    reloadFiles();
  }, [reloadFiles]);

  /* ─── File operations ────────────────────────────────────────────── */

  async function handleUpload(fileList: FileList | null) {
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
          console.error('[ProjectFiles.upload] Failed:', { fileName: file.name, error: error.message });
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
      console.error('[ProjectFiles.download] Failed:', error?.message);
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

  /* ─── Drag & drop recategorization ───────────────────────────────── */

  function handleDragStart(e: React.DragEvent, file: FileInfo, sourceCategory: string) {
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
    const newPath = `${projectId}/${targetCategory}/${data.fileName}`;

    try {
      if (data.bucket === 'project-files') {
        // Same bucket — use storage move
        const { error } = await supabase.storage.from('project-files').move(oldPath, newPath);
        if (error) {
          alert(`Move failed: ${error.message}`);
          setMoving(false);
          return;
        }
      } else {
        // Cross-bucket — download → upload → delete
        const { data: blob, error: dlErr } = await supabase.storage
          .from(data.bucket)
          .download(oldPath);
        if (dlErr || !blob) {
          alert(`Move failed: ${dlErr?.message ?? 'Download failed'}`);
          setMoving(false);
          return;
        }
        const { error: upErr } = await supabase.storage
          .from('project-files')
          .upload(newPath, blob, { upsert: false });
        if (upErr) {
          alert(`Move failed: ${upErr.message}`);
          setMoving(false);
          return;
        }
        await supabase.storage.from(data.bucket).remove([oldPath]);
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
          imgs.push({ id: f.id, name: f.name, bucket: f.bucket, path: `${f.pathPrefix}/${f.name}` });
        }
      }
    }
    // Also add lead images
    if (leadId) {
      for (const f of leadFiles) {
        if (f.mimetype?.startsWith('image/')) {
          imgs.push({ id: f.id, name: f.name, bucket: 'proposal-files', path: `${leadId}/${f.name}` });
        }
      }
    }
    return imgs;
  }, [files, leadFiles, leadId]);

  const allPhotos = React.useMemo(() => {
    return [...(files['photos'] ?? []), ...(files['whatsapp'] ?? [])].filter((f) =>
      f.metadata?.mimetype?.startsWith('image/'),
    );
  }, [files]);

  function openImage(file: FileInfo) {
    const idx = allImages.findIndex((img) => img.id === file.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  function openSlideshowImage(photoIndex: number) {
    const photo = allPhotos[photoIndex];
    if (!photo) return;
    const idx = allImages.findIndex((img) => img.id === photo.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  /* ─── Derived data ───────────────────────────────────────────────── */

  const totalFiles = Object.values(files).reduce((sum, arr) => sum + arr.length, 0);
  const gridCategories = DOCUMENT_CATEGORIES.filter((c) => c.value !== 'photos');
  const hasWhatsapp = (files['whatsapp']?.length ?? 0) > 0;

  /* ─── Auto-generated document rows (survey/DC/QC PDFs) ───────────── */
  const surveyGenerated = buildSurveyGenerated(surveyData);
  const dcGenerated = buildDcGenerated(projectId, deliveryChallans);
  const qcGenerated = buildQcGenerated(projectId, qcInspections);

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
      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#DFE2E8]">
        <Select
          value={selectedCategory}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedCategory(e.target.value)}
          className="h-8 text-xs w-48"
        >
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <label className="cursor-pointer">
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
            disabled={uploading}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.pptx,.skp,.mp4,.mov"
          />
          <Button variant="outline" size="sm" asChild disabled={uploading} className="h-8 text-xs gap-1.5">
            <span>
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload Files'}
            </span>
          </Button>
        </label>
        <span className="text-[11px] text-[#9CA0AB] hidden md:inline">
          {moving ? 'Moving file...' : 'Drag files between boxes to recategorize'}
        </span>
        {totalFiles > 0 && <span className="text-[11px] text-[#9CA0AB] ml-auto">{totalFiles} files</span>}
      </div>

      {/* Row 1: Handover + Customer Documents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <HandoverBox projectId={projectId} pack={handoverPack} />
        <div className="lg:col-span-2">
          <CategoryBox
            category={{ value: 'customer-documents', label: 'Customer Documents', icon: Users }}
            files={files['customer-documents'] ?? []}
            leadFiles={leadFiles}
            leadId={leadId}
            isDropTarget={dragOverCategory === 'customer-documents'}
            onDragOver={() => setDragOverCategory('customer-documents')}
            onDragLeave={() => setDragOverCategory(null)}
            onDrop={(e) => handleDrop(e, 'customer-documents')}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onDragStart={handleDragStart}
            onOpenImage={openImage}
            onOpenLeadImage={() => {}}
            generatedDocs={surveyGenerated}
          />
        </div>
      </div>

      {/* Site Photos slideshow */}
      {allPhotos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4 text-[#7C818E]" />
              Site Photos
              <span className="text-xs text-[#9CA0AB] font-normal">({allPhotos.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PhotoSlideshow photos={allPhotos} onOpenViewer={openSlideshowImage} />
            {/* File list below slideshow for management */}
            <div
              className={`space-y-0.5 max-h-[160px] overflow-y-auto rounded border border-dashed p-2 transition-all ${
                dragOverCategory === 'photos' ? 'border-[#00B050] bg-[#00B050]/5' : 'border-[#DFE2E8]'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverCategory('photos');
              }}
              onDragLeave={() => setDragOverCategory(null)}
              onDrop={(e) => handleDrop(e, 'photos')}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA0AB] mb-1">
                Files ({(files['photos']?.length ?? 0) + (files['whatsapp']?.length ?? 0)})
                <span className="font-normal ml-1">— drag to recategorize</span>
              </p>
              {(files['photos'] ?? []).map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  category="photos"
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onDragStart={handleDragStart}
                  onOpenImage={openImage}
                />
              ))}
              {(files['whatsapp'] ?? []).map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  category="whatsapp"
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onDragStart={handleDragStart}
                  onOpenImage={openImage}
                />
              ))}
              {(files['photos']?.length ?? 0) + (files['whatsapp']?.length ?? 0) === 0 && (
                <p className="text-[11px] text-[#C8CBD0] text-center py-2">Drag photos here</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category boxes grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {gridCategories
          .filter((c) => c.value !== 'customer-documents') // already rendered above
          .map((cat) => {
            // Inject auto-generated docs into the matching category
            let genDocs: React.ReactNode = undefined;
            if (cat.value === 'delivery-challans') genDocs = dcGenerated;
            if (cat.value === 'documents') genDocs = qcGenerated;
            return (
              <CategoryBox
                key={cat.value}
                category={cat}
                files={files[cat.value] ?? []}
                isDropTarget={dragOverCategory === cat.value}
                onDragOver={() => setDragOverCategory(cat.value)}
                onDragLeave={() => setDragOverCategory(null)}
                onDrop={(e) => handleDrop(e, cat.value)}
                onDownload={handleDownload}
                onDelete={handleDelete}
                onDragStart={handleDragStart}
                onOpenImage={openImage}
                generatedDocs={genDocs}
              />
            );
          })}
        {/* WhatsApp Photos box (only if files exist and not already shown in photos) */}
        {hasWhatsapp && (
          <CategoryBox
            category={{ value: 'whatsapp', label: 'WhatsApp Photos', icon: Camera }}
            files={files['whatsapp'] ?? []}
            isDropTarget={dragOverCategory === 'whatsapp'}
            onDragOver={() => setDragOverCategory('whatsapp')}
            onDragLeave={() => setDragOverCategory(null)}
            onDrop={(e) => handleDrop(e, 'whatsapp')}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onDragStart={handleDragStart}
            onOpenImage={openImage}
          />
        )}
      </div>

      {/* Image viewer lightbox */}
      <ImageViewer
        images={allImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
