'use client';

import { useState } from 'react';
import { createClient } from '@repo/supabase/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
} from '@repo/ui';

interface FileInfo {
  name: string;
  id: string;
  created_at: string;
  metadata: {
    size?: number;
    mimetype?: string;
  };
}

interface ProposalFilesProps {
  leadId: string;
  proposalNumber: string;
  initialFiles: FileInfo[];
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProposalFiles({ leadId, proposalNumber, initialFiles }: ProposalFilesProps) {
  const [files, setFiles] = useState<FileInfo[]>(initialFiles);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const op = '[ProposalFiles.handleUpload]';
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    const supabase = createClient();

    try {
      for (const file of Array.from(selectedFiles)) {
        const filePath = `${leadId}/${file.name}`;
        const { error } = await supabase.storage
          .from('proposal-files')
          .upload(filePath, file, { upsert: true });

        if (error) {
          console.error(`${op} Upload failed:`, { fileName: file.name, error: error.message });
          continue;
        }
      }

      // Refresh file list
      const { data: updatedFiles } = await supabase.storage
        .from('proposal-files')
        .list(leadId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

      if (updatedFiles) {
        setFiles(updatedFiles.map(f => ({
          name: f.name,
          id: f.id ?? f.name,
          created_at: f.created_at ?? '',
          metadata: {
            size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
            mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
          },
        })));
      }
    } catch (error) {
      console.error(`${op} Failed:`, error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDownload(fileName: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from('proposal-files')
      .createSignedUrl(`${leadId}/${fileName}`, 60);

    if (error || !data?.signedUrl) {
      console.error('[ProposalFiles.handleDownload] Failed:', error?.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Files</CardTitle>
        <label className="cursor-pointer">
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button variant="outline" size="sm" asChild disabled={uploading}>
            <span>{uploading ? 'Uploading...' : 'Upload'}</span>
          </Button>
        </label>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between text-sm py-1 border-b border-[#E5E7EB] last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => handleDownload(file.name)}
                    className="text-shiroi-green hover:underline truncate block text-left"
                    title={file.name}
                  >
                    {file.name}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(file.metadata?.size)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
