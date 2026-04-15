'use client';

/**
 * Row-level building blocks for the Documents tab:
 *   - HandoverBox   — squarish card that generates/regenerates the handover pack
 *   - FileRow       — draggable file row with download + delete
 *   - LeadFileRow   — read-only row for files from the lead's proposal bucket
 *   - GeneratedDocRow — non-draggable row for auto-generated docs (survey, DC, QC PDFs)
 *
 * All row components are dumb — they receive props and fire callbacks.
 * The main shell (index.tsx) owns state.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@repo/ui';
import {
  Download, Trash2, GripVertical, Package, RefreshCw, FileCheck2,
  FileDown, Clock,
} from 'lucide-react';
import { DataFlagButton } from '@/components/data-flag-button';
import { generateHandoverPack } from '@/lib/handover-actions';

import type { FileInfo, LeadFileInfo, HandoverPackData } from './types';
import { getFileIcon, formatFileSize, formatDateTime } from './helpers';

// ═══════════════════════════════════════════════════════════════════════
// HandoverBox
// ═══════════════════════════════════════════════════════════════════════

export function HandoverBox({
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
          {pack && <Badge variant="success" className="text-[10px]">v{pack.version}</Badge>}
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

// ═══════════════════════════════════════════════════════════════════════
// FileRow — draggable
// ═══════════════════════════════════════════════════════════════════════

export function FileRow({
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
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (isImage) onOpenImage(file);
            else onDownload(file);
          }
        }}
        className="text-[#00B050] hover:underline truncate text-left flex-1 text-[12px] cursor-pointer select-none"
        title={file.name}
        draggable={false}
      >
        {file.name.replace(/^\d+_/, '')}
      </span>
      <span className="text-[10px] text-[#C8CBD0] hidden sm:inline flex-shrink-0 pointer-events-none">
        {formatFileSize(file.metadata?.size)}
      </span>
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0"
        draggable={false}
      >
        <DataFlagButton entityType="file" entityId={file.id} fieldName={category} compact />
        <button
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            if (isImage) onOpenImage(file);
            else onDownload(file);
          }}
          className="p-0.5 text-[#7C818E] hover:text-[#00B050]"
          title={isImage ? 'View' : 'Download'}
        >
          <Download className="h-3 w-3" />
        </button>
        <button
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(file);
          }}
          className="p-0.5 text-[#7C818E] hover:text-[#991B1B]"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GeneratedDocRow — non-draggable (auto-generated survey/DC/QC PDFs)
// ═══════════════════════════════════════════════════════════════════════

export function GeneratedDocRow({
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
        <span className="text-[10px] text-[#9CA0AB] flex-shrink-0 hidden sm:inline">
          {sublabel}
        </span>
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

// ═══════════════════════════════════════════════════════════════════════
// LeadFileRow — read-only row for files from the lead's proposal-files bucket
// ═══════════════════════════════════════════════════════════════════════

export function LeadFileRow({
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
      <Badge variant="secondary" className="text-[9px] px-1 py-0 flex-shrink-0">
        Proposal
      </Badge>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
        <button
          onClick={handleDownload}
          className="p-0.5 text-[#7C818E] hover:text-[#00B050]"
          title="Download"
        >
          <Download className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
