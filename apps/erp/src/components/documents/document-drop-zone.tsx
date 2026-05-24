'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Upload, X, FileText, Image, Layers, CheckCircle, AlertCircle } from 'lucide-react';
import { Badge } from '@repo/ui';
import { uploadProjectDocument } from '@/lib/documents-actions';
import type { DocumentCategory } from '@/lib/documents-constants';
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/documents-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingFile {
  id: string;
  file: File;
  category: DocumentCategory;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

// Categories available for manual override
const SELECTABLE_CATEGORIES: DocumentCategory[] = [
  'proposal_pdf',
  'costing_sheet',
  'bom_excel',
  'site_survey_photo',
  'site_survey_report',
  'roof_layout',
  'electrical_sld',
  'cad_drawing',
  'sketchup_model',
  'as_built_drawing',
  'commissioning_report',
  'kyc_document',
  'electricity_bill',
  'signed_proposal',
  'liaison_document',
  'misc',
];

function detectCategory(name: string, mimeType: string): DocumentCategory {
  const lower = name.toLowerCase();
  if (lower.includes('bom')) return 'bom_excel';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'costing_sheet';
  if (mimeType.startsWith('image/')) return 'site_survey_photo';
  if (lower.endsWith('.dwg') || lower.endsWith('.dxf')) return 'cad_drawing';
  if (lower.endsWith('.skp')) return 'sketchup_model';
  if (mimeType === 'application/pdf') return 'proposal_pdf';
  return 'misc';
}

function fileIcon(file: File) {
  if (file.type.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
  if (file.name.endsWith('.dwg') || file.name.endsWith('.skp')) return <Layers className="h-4 w-4 text-purple-500" />;
  return <FileText className="h-4 w-4 text-n-500" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv,.dwg,.skp,.dxf';

// ---------------------------------------------------------------------------
// Drop Zone Component
// ---------------------------------------------------------------------------

interface DocumentDropZoneProps {
  entityType: 'lead' | 'project';
  entityId: string;
  onUploaded?: () => void;
}

export function DocumentDropZone({ entityType, entityId, onUploaded }: DocumentDropZoneProps) {
  const router = useRouter();
  const [dragOver, setDragOver] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const MAX = 20 * 1024 * 1024;
    const newItems: PendingFile[] = [];

    for (const file of Array.from(fileList)) {
      if (file.size > MAX) {
        newItems.push({
          id: crypto.randomUUID(),
          file,
          category: 'misc',
          status: 'error',
          error: `Too large (max 20 MB)`,
        });
        continue;
      }
      newItems.push({
        id: crypto.randomUUID(),
        file,
        category: detectCategory(file.name, file.type),
        status: 'pending',
      });
    }
    setPendingFiles((prev) => [...prev, ...newItems]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function removeFile(id: string) {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function updateCategory(id: string, category: DocumentCategory) {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, category } : f)),
    );
  }

  async function uploadAll() {
    const toUpload = pendingFiles.filter((f) => f.status === 'pending');
    if (toUpload.length === 0) return;

    setUploading(true);

    for (const pending of toUpload) {
      // Mark as uploading
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === pending.id ? { ...f, status: 'uploading' } : f)),
      );

      const fd = new FormData();
      fd.append('file', pending.file);
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('category', pending.category);

      const res = await uploadProjectDocument(fd);

      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pending.id
            ? { ...f, status: res.success ? 'done' : 'error', error: res.success ? undefined : res.error }
            : f,
        ),
      );
    }

    setUploading(false);
    router.refresh();
    onUploaded?.();

    // Clear done items after a short delay
    setTimeout(() => {
      setPendingFiles((prev) => prev.filter((f) => f.status !== 'done'));
    }, 2000);
  }

  const pendingCount = pendingFiles.filter((f) => f.status === 'pending').length;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-shiroi-green bg-green-50'
            : 'border-n-300 hover:border-n-400 hover:bg-n-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Upload className={`h-7 w-7 mx-auto mb-2 ${dragOver ? 'text-shiroi-green' : 'text-n-400'}`} />
        <p className="text-sm font-medium text-n-700">
          Drop files here or <span className="text-shiroi-green">browse</span>
        </p>
        <p className="text-xs text-n-400 mt-1">
          PDF, images, XLSX, DWG, SKP — max 20 MB each
        </p>
      </div>

      {/* Pending files list */}
      {pendingFiles.length > 0 && (
        <div className="space-y-2">
          {pendingFiles.map((pf) => (
            <div
              key={pf.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                pf.status === 'error' ? 'border-red-200 bg-red-50' :
                pf.status === 'done'  ? 'border-green-200 bg-green-50' :
                'border-n-200 bg-n-50'
              }`}
            >
              <div className="flex-shrink-0">{fileIcon(pf.file)}</div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-n-800 truncate">{pf.file.name}</p>
                <p className="text-xs text-n-400">{formatSize(pf.file.size)}</p>
                {pf.error && <p className="text-xs text-red-600 mt-0.5">{pf.error}</p>}
              </div>

              {/* Category selector — only when pending */}
              {pf.status === 'pending' && (
                <select
                  value={pf.category}
                  onChange={(e) => updateCategory(pf.id, e.target.value as DocumentCategory)}
                  className="text-xs rounded border border-n-300 px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-shiroi-green/40"
                >
                  {SELECTABLE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {DOCUMENT_CATEGORY_LABELS[cat] ?? cat}
                    </option>
                  ))}
                </select>
              )}

              {/* Status indicators */}
              {pf.status === 'uploading' && (
                <div className="text-xs text-n-500 animate-pulse">Uploading…</div>
              )}
              {pf.status === 'done' && (
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
              )}
              {pf.status === 'error' && (
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
              )}

              {/* Remove button — not during upload */}
              {pf.status !== 'uploading' && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(pf.id); }}
                  className="text-n-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {/* Upload button */}
          {pendingCount > 0 && (
            <button
              onClick={uploadAll}
              disabled={uploading}
              className="w-full mt-1 h-9 rounded-lg bg-shiroi-green text-white text-sm font-medium hover:bg-[#007A38] disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
