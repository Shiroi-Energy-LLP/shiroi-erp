'use client';

import { useState } from 'react';
import { createClient } from '@repo/supabase/client';
import { Button } from '@repo/ui';
import { DataFlagButton } from '@/components/data-flag-button';

interface FileItem {
  name: string;
  id: string;
  created_at: string;
  size?: number;
  mimetype?: string;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LeadFilesList({ leadId, files }: { leadId: string; files: FileItem[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function handleDownload(fileName: string) {
    const op = '[LeadFilesList.download]';
    setDownloading(fileName);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from('proposal-files')
        .createSignedUrl(`${leadId}/${fileName}`, 60);

      if (error) {
        console.error(`${op} Failed:`, error.message);
        return;
      }
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="divide-y divide-n-100">
      {files.map((file) => (
        <div key={file.id} className="py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-n-900">{file.name}</div>
            <div className="text-xs text-n-500">
              {formatFileSize(file.size)}
              {file.created_at && (
                <span className="ml-2">
                  {new Date(file.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DataFlagButton entityType="file" entityId={file.id} compact />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(file.name)}
              disabled={downloading === file.name}
            >
              {downloading === file.name ? 'Loading...' : 'Download'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
