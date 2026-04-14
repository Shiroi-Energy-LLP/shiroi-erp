'use client';

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { Download, FileText, Image, File, Table2, Ruler } from 'lucide-react';
import { ImageViewer, type ViewableImage } from '@/components/ui/image-viewer';
import { DataFlagButton } from '@/components/data-flag-button';

interface LeadFileInfo {
  name: string;
  id: string;
  created_at: string;
  size?: number;
  mimetype?: string;
}

interface LeadFilesProps {
  leadId: string;
  files: LeadFileInfo[];
}

const FILE_TYPE_GROUPS = [
  { key: 'images', label: 'Images', test: (m: string) => m.startsWith('image/'), Icon: Image },
  { key: 'pdfs', label: 'PDFs', test: (m: string) => m === 'application/pdf', Icon: FileText },
  { key: 'documents', label: 'Word Documents', test: (m: string) => m.includes('wordprocessingml') || m.includes('msword'), Icon: FileText },
  { key: 'spreadsheets', label: 'Spreadsheets', test: (m: string) => m.includes('spreadsheetml') || m.includes('ms-excel'), Icon: Table2 },
  { key: 'presentations', label: 'Presentations', test: (m: string) => m.includes('presentationml') || m.includes('powerpoint'), Icon: FileText },
  { key: 'design', label: 'Design Files', test: (m: string) => m.includes('dwg') || m.includes('sketchup') || m.includes('layout'), Icon: Ruler },
  { key: 'video', label: 'Videos', test: (m: string) => m.startsWith('video/'), Icon: File },
] as const;

function getGroup(mimetype?: string): string {
  if (!mimetype) return 'other';
  for (const g of FILE_TYPE_GROUPS) {
    if (g.test(mimetype)) return g.key;
  }
  return 'other';
}

function getGroupIcon(mimetype?: string) {
  if (!mimetype) return File;
  for (const g of FILE_TYPE_GROUPS) {
    if (g.test(mimetype)) return g.Icon;
  }
  return File;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function LeadFiles({ leadId, files }: LeadFilesProps) {
  // Hooks must be called unconditionally — early return below runs AFTER them
  // to satisfy react-hooks/rules-of-hooks.

  // Group files by type
  const grouped = React.useMemo(() => {
    const groups: Record<string, LeadFileInfo[]> = {};
    for (const f of files) {
      const key = getGroup(f.mimetype);
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [files]);

  // Collect all images for the viewer
  const allImages: ViewableImage[] = React.useMemo(() => {
    return files
      .filter((f) => f.mimetype?.startsWith('image/'))
      .map((f) => ({
        id: f.id,
        name: f.name,
        bucket: 'proposal-files',
        path: `${leadId}/${f.name}`,
      }));
  }, [files, leadId]);

  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  if (files.length === 0) return null;

  function openImage(file: LeadFileInfo) {
    const idx = allImages.findIndex((img) => img.id === file.id);
    if (idx >= 0) {
      setViewerIndex(idx);
      setViewerOpen(true);
    }
  }

  async function handleDownload(fileName: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from('proposal-files')
      .createSignedUrl(`${leadId}/${fileName}`, 60);

    if (error || !data?.signedUrl) {
      console.error('[LeadFiles.handleDownload] Failed:', error?.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  const orderedKeys = [
    ...FILE_TYPE_GROUPS.map((g) => g.key),
    'other',
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#7C818E]" />
          Lead Files
          <span className="text-xs text-[#7C818E] font-normal">({files.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orderedKeys.map((key) => {
          const groupFiles = grouped[key];
          if (!groupFiles || groupFiles.length === 0) return null;

          const groupDef = FILE_TYPE_GROUPS.find((g) => g.key === key);
          const label = groupDef?.label ?? 'Other';

          return (
            <div key={key}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-1.5">
                {label} ({groupFiles.length})
              </p>
              <div className="space-y-1">
                {groupFiles.map((file) => {
                  const Icon = getGroupIcon(file.mimetype);
                  const isImage = file.mimetype?.startsWith('image/');
                  return (
                    <div
                      key={file.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#F5F6F8] group text-sm"
                    >
                      <Icon className="h-3.5 w-3.5 text-[#9CA0AB] flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => isImage ? openImage(file) : handleDownload(file.name)}
                          className="text-[#00B050] hover:underline truncate block text-left text-[13px]"
                          title={file.name}
                        >
                          {file.name.replace(/^\d+_/, '')}
                        </button>
                        <span className="text-[11px] text-[#9CA0AB]">
                          {formatFileSize(file.size)}
                          {file.created_at && ` · ${formatDate(file.created_at)}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DataFlagButton
                          entityType="file"
                          entityId={file.id}
                          fieldName={key}
                          compact
                        />
                        <button
                          onClick={() => isImage ? openImage(file) : handleDownload(file.name)}
                          className="p-1 text-[#7C818E] hover:text-[#00B050]"
                          title={isImage ? 'View' : 'Download'}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
