'use client';

/**
 * Container-level building blocks for the Documents tab:
 *   - PhotoSlideshow — auto-rotating carousel for site photos
 *   - CategoryBox    — one card per document category with drop-target
 *
 * Rows (FileRow/LeadFileRow) live in parts-rows.tsx and are imported here.
 */
import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react';

import type { FileInfo, LeadFileInfo, DocumentCategory } from './types';
import { FileRow, LeadFileRow } from './parts-rows';

// ═══════════════════════════════════════════════════════════════════════
// PhotoSlideshow — auto-rotating site-photo carousel
// ═══════════════════════════════════════════════════════════════════════

export function PhotoSlideshow({
  photos,
  onOpenViewer,
}: {
  photos: FileInfo[];
  onOpenViewer: (photoIndex: number) => void;
}) {
  const [slideIndex, setSlideIndex] = React.useState(0);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const photo = photos[slideIndex];

  // Load signed URL for current slide
  React.useEffect(() => {
    if (!photo) return;
    setLoadingUrl(true);
    const supabase = createClient();
    supabase.storage
      .from(photo.bucket)
      .createSignedUrl(`${photo.pathPrefix}/${photo.name}`, 300)
      .then(({ data }) => {
        setUrl(data?.signedUrl ?? null);
        setLoadingUrl(false);
      });
  }, [slideIndex, photo?.id]);

  // Auto-advance every 5s
  function startTimer() {
    if (photos.length <= 1) return;
    timerRef.current = setInterval(() => {
      setSlideIndex((i) => (i + 1) % photos.length);
    }, 5000);
  }
  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
  }
  React.useEffect(() => {
    startTimer();
    return stopTimer;
  }, [photos.length]);

  function prev(e: React.MouseEvent) {
    e.stopPropagation();
    stopTimer();
    setSlideIndex((i) => (i > 0 ? i - 1 : photos.length - 1));
    startTimer();
  }
  function next(e: React.MouseEvent) {
    e.stopPropagation();
    stopTimer();
    setSlideIndex((i) => (i + 1) % photos.length);
    startTimer();
  }

  if (photos.length === 0) return null;

  return (
    <div
      className="relative aspect-[21/9] bg-[#1A1C20] rounded-lg overflow-hidden cursor-pointer group"
      onMouseEnter={stopTimer}
      onMouseLeave={startTimer}
      onClick={() => onOpenViewer(slideIndex)}
    >
      {loadingUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : url ? (
        <img src={url} alt="" className="w-full h-full object-cover transition-opacity duration-500" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
          No preview
        </div>
      )}

      {photos.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded">
            {slideIndex + 1} / {photos.length}
          </div>
        </>
      )}

      <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1.5">
        <Camera className="h-3 w-3" /> Site Photos
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CategoryBox — one card per document category, drop-target for drag-and-drop
// ═══════════════════════════════════════════════════════════════════════

export function CategoryBox({
  category,
  files,
  leadFiles,
  leadId,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onDownload,
  onDelete,
  onDragStart,
  onOpenImage,
  onOpenLeadImage,
  generatedDocs,
}: {
  category: DocumentCategory;
  files: FileInfo[];
  leadFiles?: LeadFileInfo[];
  leadId?: string | null;
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDownload: (f: FileInfo) => void;
  onDelete: (f: FileInfo) => void;
  onDragStart: (e: React.DragEvent, f: FileInfo, cat: string) => void;
  onOpenImage: (f: FileInfo) => void;
  onOpenLeadImage?: (idx: number) => void;
  generatedDocs?: React.ReactNode;
}) {
  const Icon = category.icon;
  const totalCount = files.length + (leadFiles?.length ?? 0);

  return (
    <Card
      className={`transition-all ${isDropTarget ? 'ring-2 ring-[#00B050] ring-offset-1 bg-[#00B050]/5' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <CardHeader className="pb-1 pt-3 px-3">
        <CardTitle className="text-[13px] flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-[#7C818E]" />
          {category.label}
          {totalCount > 0 && (
            <span className="text-[11px] text-[#9CA0AB] font-normal">({totalCount})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 min-h-[60px]">
        {/* Auto-generated documents */}
        {generatedDocs && (
          <div className="space-y-0.5 mb-1.5 pb-1.5 border-b border-dashed border-[#DFE2E8]">
            {generatedDocs}
          </div>
        )}
        {totalCount === 0 && !generatedDocs ? (
          <p className="text-[11px] text-[#C8CBD0] text-center py-3">
            {isDropTarget ? 'Drop here' : 'Drag files here'}
          </p>
        ) : (
          <div className="space-y-0.5 max-h-[220px] overflow-y-auto">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                category={category.value}
                onDownload={onDownload}
                onDelete={onDelete}
                onDragStart={onDragStart}
                onOpenImage={onOpenImage}
              />
            ))}
            {leadFiles &&
              leadId &&
              leadFiles.map((file) => (
                <LeadFileRow
                  key={file.id}
                  file={file}
                  leadId={leadId}
                  onOpenImage={onOpenLeadImage ?? (() => {})}
                />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
