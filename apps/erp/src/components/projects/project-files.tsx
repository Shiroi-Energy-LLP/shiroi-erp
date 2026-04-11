'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Select, Badge,
} from '@repo/ui';
import {
  Upload, Download, FileText, Image, File, Trash2, Camera, PenTool,
  LayoutGrid, ShoppingCart, Receipt, Truck, Shield, Table2, FileCheck,
  Folder, GripVertical, Package, RefreshCw, FileCheck2, ChevronLeft,
  ChevronRight, Users, Clock, ClipboardCheck, FileDown, MapPin,
} from 'lucide-react';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';
import { DataFlagButton } from '@/components/data-flag-button';
import { generateHandoverPack } from '@/lib/handover-actions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileInfo {
  name: string;
  id: string;
  created_at: string;
  metadata: { size?: number; mimetype?: string };
  pathPrefix: string;
  bucket: string;
}

interface LeadFileInfo {
  name: string;
  id: string;
  created_at: string;
  size?: number;
  mimetype?: string;
}

interface HandoverPackData {
  id: string;
  version: number;
  generated_at: string;
  metadata: any;
}

interface DeliveryChallanInfo {
  id: string;
  dc_number?: string;
  dc_date?: string;
  status: string;
  delivery_challan_items?: any[];
  created_at?: string;
}

interface QcInspectionInfo {
  id: string;
  gate_number?: number;
  inspection_date?: string;
  overall_result?: string | null;
  approval_status?: string | null;
  employees?: { full_name: string } | null;
}

interface SurveyInfo {
  id: string;
  survey_date?: string;
  survey_status?: string;
  recommended_size_kwp?: number;
  contact_person_name?: string;
}

export interface ProjectFilesProps {
  projectId: string;
  leadId: string | null;
  leadFiles: LeadFileInfo[];
  handoverPack: HandoverPackData | null;
  deliveryChallans?: DeliveryChallanInfo[];
  qcInspections?: QcInspectionInfo[];
  surveyData?: SurveyInfo | null;
}

interface DragData {
  fileName: string;
  bucket: string;
  pathPrefix: string;
  sourceCategory: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DOCUMENT_CATEGORIES = [
  { value: 'customer-documents', label: 'Customer Documents', icon: Users },
  { value: 'photos', label: 'Site Photos', icon: Camera },
  { value: 'autocad', label: 'AutoCAD / Design', icon: PenTool },
  { value: 'layouts', label: 'Layouts / Designs', icon: LayoutGrid },
  { value: 'purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
  { value: 'invoices', label: 'Invoices', icon: Receipt },
  { value: 'delivery-challans', label: 'Delivery Challans', icon: Truck },
  { value: 'warranty', label: 'Warranty Cards', icon: Shield },
  { value: 'excel', label: 'Excel / Costing', icon: Table2 },
  { value: 'documents', label: 'Documents / Approvals', icon: FileText },
  { value: 'sesal', label: 'SESAL', icon: FileCheck },
  { value: 'general', label: 'General', icon: Folder },
] as const;

/** Map every known storage folder name → display category value. */
const FOLDER_TO_CATEGORY: Record<string, string> = {
  'customer-documents': 'customer-documents',
  photos: 'photos',
  autocad: 'autocad',
  layouts: 'layouts',
  'purchase-orders': 'purchase-orders',
  invoices: 'invoices',
  invoice: 'invoices', // legacy
  'delivery-challans': 'delivery-challans',
  warranty: 'warranty',
  excel: 'excel',
  documents: 'documents',
  sesal: 'sesal',
  general: 'general',
};

const SCAN_FOLDERS = Object.keys(FOLDER_TO_CATEGORY);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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
  if (mimetype.includes('spreadsheetml') || mimetype.includes('ms-excel')) return Table2;
  return File;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Compact handover box — squarish, action-oriented. */
function HandoverBox({
  projectId,
  pack,
}: {
  projectId: string;
  pack: HandoverPackData | null;
}) {
  const router = useRouter();
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const res = await generateHandoverPack(projectId);
    setGenerating(false);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to generate');
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-[#7C818E]" />
          Handover Pack
          {pack && (
            <Badge variant="success" className="text-[10px]">v{pack.version}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-4">
        {error && <p className="text-xs text-[#991B1B]">{error}</p>}
        {pack ? (
          <>
            <div className="flex items-center gap-1.5 text-[11px] text-[#9CA0AB]">
              <Clock className="h-3 w-3" />
              {formatDateTime(pack.generated_at)}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="h-7 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3 w-3 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Regenerate'}
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-[#9CA0AB]">
              Compile project data into a customer-ready document.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="h-7 text-xs gap-1.5"
            >
              <FileCheck2 className="h-3 w-3" />
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Draggable file row. */
function FileRow({
  file,
  category,
  onDownload,
  onDelete,
  onDragStart,
  onOpenImage,
}: {
  file: FileInfo;
  category: string;
  onDownload: (f: FileInfo) => void;
  onDelete: (f: FileInfo) => void;
  onDragStart: (e: React.DragEvent, f: FileInfo, cat: string) => void;
  onOpenImage: (f: FileInfo) => void;
}) {
  const Icon = getFileIcon(file.metadata?.mimetype);
  const isImage = file.metadata?.mimetype?.startsWith('image/');

  return (
    <div
      draggable={true}
      onDragStart={(e) => onDragStart(e, file, category)}
      className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[#F5F6F8] group text-xs cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-3 w-3 text-[#C8CBD0] flex-shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none" />
      <Icon className="h-3 w-3 text-[#9CA0AB] flex-shrink-0 pointer-events-none" />
      <span
        role="button"
        tabIndex={0}
        onClick={() => (isImage ? onOpenImage(file) : onDownload(file))}
        onKeyDown={(e) => { if (e.key === 'Enter') isImage ? onOpenImage(file) : onDownload(file); }}
        className="text-[#00B050] hover:underline truncate text-left flex-1 text-[12px] cursor-pointer select-none"
        title={file.name}
        draggable={false}
      >
        {file.name.replace(/^\d+_/, '')}
      </span>
      <span className="text-[10px] text-[#C8CBD0] hidden sm:inline flex-shrink-0 pointer-events-none">
        {formatFileSize(file.metadata?.size)}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0" draggable={false}>
        <DataFlagButton entityType="file" entityId={file.id} fieldName={category} compact />
        <button
          draggable={false}
          onClick={(e) => { e.stopPropagation(); isImage ? onOpenImage(file) : onDownload(file); }}
          className="p-0.5 text-[#7C818E] hover:text-[#00B050]"
          title={isImage ? 'View' : 'Download'}
        >
          <Download className="h-3 w-3" />
        </button>
        <button
          draggable={false}
          onClick={(e) => { e.stopPropagation(); onDelete(file); }}
          className="p-0.5 text-[#7C818E] hover:text-[#991B1B]"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Auto-generated document row (non-draggable, with download link). */
function GeneratedDocRow({
  icon: DocIcon,
  label,
  sublabel,
  badgeText,
  badgeVariant,
  downloadUrl,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  badgeText?: string;
  badgeVariant?: 'info' | 'success' | 'warning' | 'error' | 'neutral' | 'outline';
  downloadUrl?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[#F5F6F8] group text-xs">
      <DocIcon className="h-3 w-3 text-[#5A8DEE] flex-shrink-0" />
      <span className="text-[12px] text-[#3A3D44] truncate flex-1 font-medium">{label}</span>
      {sublabel && (
        <span className="text-[10px] text-[#9CA0AB] flex-shrink-0 hidden sm:inline">{sublabel}</span>
      )}
      {badgeText && (
        <Badge variant={badgeVariant ?? 'info'} className="text-[9px] px-1 py-0 flex-shrink-0">
          {badgeText}
        </Badge>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-0.5 text-[#7C818E] hover:text-[#00B050] opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="Download PDF"
        >
          <FileDown className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Read-only lead file row (not draggable). */
function LeadFileRow({
  file,
  leadId,
  onOpenImage,
}: {
  file: LeadFileInfo;
  leadId: string;
  onOpenImage: (idx: number) => void;
}) {
  const isImage = file.mimetype?.startsWith('image/');
  const Icon = getFileIcon(file.mimetype);

  async function handleDownload() {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from('proposal-files')
      .createSignedUrl(`${leadId}/${file.name}`, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[#F5F6F8] group text-xs">
      <Icon className="h-3 w-3 text-[#9CA0AB] flex-shrink-0" />
      <button
        onClick={() => (isImage ? onOpenImage(-1) : handleDownload())}
        className="text-[#00B050] hover:underline truncate text-left flex-1 text-[12px]"
        title={file.name}
      >
        {file.name.replace(/^\d+_/, '')}
      </button>
      <Badge variant="secondary" className="text-[9px] px-1 py-0 flex-shrink-0">Proposal</Badge>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
        <button onClick={handleDownload} className="p-0.5 text-[#7C818E] hover:text-[#00B050]" title="Download">
          <Download className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Site photos slideshow — auto-rotating carousel. */
function PhotoSlideshow({
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

/** A single document category box — renders file list and acts as drag-drop target. */
function CategoryBox({
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
  category: { value: string; label: string; icon: React.ElementType };
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
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(e); }}
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
            {leadFiles && leadId && leadFiles.map((file) => (
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ProjectFiles({ projectId, leadId, leadFiles, handoverPack, deliveryChallans, qcInspections, surveyData }: ProjectFilesProps) {
  const [files, setFiles] = React.useState<Record<string, FileInfo[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState('general');
  const [dragOverCategory, setDragOverCategory] = React.useState<string | null>(null);

  // Image viewer
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  /* ---- Load files ---- */

  React.useEffect(() => {
    loadAllFiles();
  }, [projectId]);

  async function loadAllFiles() {
    const op = '[ProjectFiles.loadAllFiles]';
    const supabase = createClient();

    const pathPrefixes = [projectId, `projects/${projectId}`];

    // 1. Scan all folder+prefix combos in parallel
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
                })),
            };
          });
      })
    );

    // 2. Also scan WhatsApp photos
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

    const [categoryResults, waPhotos] = await Promise.all([
      Promise.all(categoryPromises),
      waPromise,
    ]);

    // Merge results
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

  /* ---- File operations ---- */

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
      await loadAllFiles();
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
    await loadAllFiles();
  }

  /* ---- Drag & drop recategorization ---- */

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

      await loadAllFiles();
    } finally {
      setMoving(false);
    }
  }

  /* ---- Image viewer ---- */

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

  function openImage(file: FileInfo) {
    const idx = allImages.findIndex((img) => img.id === file.id);
    if (idx >= 0) { setViewerIndex(idx); setViewerOpen(true); }
  }

  function openSlideshowImage(photoIndex: number) {
    // Map photo index to allImages index
    const photo = allPhotos[photoIndex];
    if (!photo) return;
    const idx = allImages.findIndex((img) => img.id === photo.id);
    if (idx >= 0) { setViewerIndex(idx); setViewerOpen(true); }
  }

  /* ---- Derived data ---- */

  const allPhotos = React.useMemo(() => {
    return [...(files['photos'] ?? []), ...(files['whatsapp'] ?? [])]
      .filter((f) => f.metadata?.mimetype?.startsWith('image/'));
  }, [files]);

  const totalFiles = Object.values(files).reduce((sum, arr) => sum + arr.length, 0);

  // Categories for the grid (exclude photos — rendered as slideshow)
  const gridCategories = DOCUMENT_CATEGORIES.filter((c) => c.value !== 'photos');
  const hasWhatsapp = (files['whatsapp']?.length ?? 0) > 0;

  /* ---- Auto-generated documents per category ---- */

  // Survey → "Customer Documents" box
  const surveyGenerated = surveyData ? (
    <GeneratedDocRow
      icon={MapPin}
      label={`Site Survey Report`}
      sublabel={surveyData.survey_date
        ? new Date(surveyData.survey_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        : undefined}
      badgeText={surveyData.survey_status === 'completed' ? 'Completed' : surveyData.survey_status ?? 'Survey'}
      badgeVariant={surveyData.survey_status === 'completed' ? 'success' : 'info'}
    />
  ) : null;

  // DCs → "Delivery Challans" box
  const dcGenerated = (deliveryChallans && deliveryChallans.length > 0) ? (
    <>
      {deliveryChallans.map((dc, idx) => {
        const dcLabel = dc.dc_number || `DC-${String(idx + 1).padStart(3, '0')}`;
        const dcDate = dc.dc_date
          ? new Date(dc.dc_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
          : undefined;
        const itemCount = dc.delivery_challan_items?.length ?? 0;
        const statusMap: Record<string, { text: string; variant: 'info' | 'success' | 'warning' | 'neutral' }> = {
          draft: { text: 'Draft', variant: 'neutral' },
          dispatched: { text: 'Dispatched', variant: 'info' },
          delivered: { text: 'Delivered', variant: 'success' },
          partial_delivery: { text: 'Partial', variant: 'warning' },
        };
        const st = statusMap[dc.status] ?? { text: dc.status, variant: 'neutral' as const };
        return (
          <GeneratedDocRow
            key={dc.id}
            icon={Truck}
            label={`${dcLabel} (${itemCount} items)`}
            sublabel={dcDate}
            badgeText={st.text}
            badgeVariant={st.variant}
            downloadUrl={`/api/projects/${projectId}/dc/${dc.id}`}
          />
        );
      })}
    </>
  ) : null;

  // QC → "Documents / Approvals" box
  const qcGenerated = (qcInspections && qcInspections.length > 0) ? (
    <>
      {qcInspections.map((qc) => {
        const qcDate = qc.inspection_date
          ? new Date(qc.inspection_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
          : undefined;
        const inspectorName = (qc.employees as any)?.full_name;
        const statusMap: Record<string, { text: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral' }> = {
          draft: { text: 'Draft', variant: 'neutral' },
          submitted: { text: 'Submitted', variant: 'info' },
          approved: { text: 'Approved', variant: 'success' },
          rework_required: { text: 'Rework', variant: 'warning' },
        };
        const st = statusMap[qc.approval_status ?? ''] ?? { text: qc.approval_status ?? 'Draft', variant: 'neutral' as const };
        const canDownload = qc.approval_status === 'approved' || qc.approval_status === 'submitted';
        return (
          <GeneratedDocRow
            key={qc.id}
            icon={ClipboardCheck}
            label={`QC Report${inspectorName ? ` — ${inspectorName}` : ''}`}
            sublabel={qcDate}
            badgeText={st.text}
            badgeVariant={st.variant}
            downloadUrl={canDownload ? `/api/projects/${projectId}/qc/${qc.id}` : undefined}
          />
        );
      })}
    </>
  ) : null;

  /* ---- Render ---- */

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
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.pptx,.skp,.mp4,.mov"
          />
          <Button variant="outline" size="sm" asChild disabled={uploading} className="h-8 text-xs gap-1.5">
            <span><Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload Files'}</span>
          </Button>
        </label>
        <span className="text-[11px] text-[#9CA0AB] hidden md:inline">
          {moving ? 'Moving file...' : 'Drag files between boxes to recategorize'}
        </span>
        {totalFiles > 0 && (
          <span className="text-[11px] text-[#9CA0AB] ml-auto">{totalFiles} files</span>
        )}
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
                dragOverCategory === 'photos'
                  ? 'border-[#00B050] bg-[#00B050]/5'
                  : 'border-[#DFE2E8]'
              }`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCategory('photos'); }}
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
