import {
  type DocumentRow,
  DOCUMENT_CATEGORY_LABELS,
} from '@/lib/documents-queries';
import { Badge } from '@repo/ui';
import { ExternalLink, FileText, Image as ImageIcon, FileCode, Layers } from 'lucide-react';

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryIcon(category: string) {
  if (category === 'site_survey_photo' || category === 'om_photo') {
    return <ImageIcon className="h-3.5 w-3.5 text-n-500" />;
  }
  if (category === 'cad_drawing' || category === 'roof_layout' || category === 'electrical_sld' || category === 'as_built_drawing') {
    return <FileCode className="h-3.5 w-3.5 text-n-500" />;
  }
  if (category === 'sketchup_model') {
    return <Layers className="h-3.5 w-3.5 text-n-500" />;
  }
  return <FileText className="h-3.5 w-3.5 text-n-500" />;
}

interface DocumentListProps {
  documents: DocumentRow[];
}

export function DocumentList({ documents }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-n-500">
        No documents indexed yet. Upload files via the Drive folder above, or add files directly.
      </div>
    );
  }

  return (
    <div className="divide-y divide-n-100">
      {documents.map((doc) => (
        <div key={doc.id} className="py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="pt-0.5">{categoryIcon(doc.category)}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-n-900 truncate">{doc.name}</div>
              <div className="text-xs text-n-500 flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}
                </Badge>
                <span>{formatFileSize(doc.size_bytes)}</span>
                <span className="text-n-400">·</span>
                <span>
                  {doc.storage_backend === 'drive' ? 'Drive' : 'Supabase'}
                </span>
                {doc.uploaded_at && (
                  <>
                    <span className="text-n-400">·</span>
                    <span>
                      {new Date(doc.uploaded_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          {doc.external_url && (
            <a
              href={doc.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-p-600 hover:underline flex items-center gap-1 shrink-0"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
