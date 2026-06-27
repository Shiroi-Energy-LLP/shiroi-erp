'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Upload, X, Loader2 } from 'lucide-react';
import { addTicketAttachment, removeTicketAttachment } from '@/lib/service-ticket-actions';
import { AttachmentLink } from '@/components/om/attachment-link';

interface TicketAttachmentsProps {
  ticketId: string;
  paths: string[];
  names: string[];
}

export function TicketAttachments({ ticketId, paths, names }: TicketAttachmentsProps) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const supabase = createClient();
    const ext = file.name.split('.').pop() || 'bin';
    const path = `tickets/${ticketId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('project-files').upload(path, file);
    if (uploadError) {
      setError('Upload failed');
      setUploading(false);
      e.target.value = '';
      return;
    }

    const result = await addTicketAttachment({ ticketId, path, name: file.name });
    setUploading(false);
    e.target.value = '';
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to record attachment');
    }
  }

  async function handleRemove(path: string) {
    if (!confirm('Remove this document?')) return;
    setRemoving(path);
    const result = await removeTicketAttachment({ ticketId, path });
    setRemoving(null);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to remove');
    }
  }

  return (
    <div className="space-y-2">
      {paths.length === 0 ? (
        <p className="text-xs text-n-400">No supporting documents yet.</p>
      ) : (
        <ul className="space-y-1">
          {paths.map((path, i) => (
            <li key={path} className="flex items-center justify-between gap-2 rounded border border-n-100 px-2 py-1">
              <AttachmentLink path={path} name={names[i] ?? 'document'} />
              <button
                type="button"
                onClick={() => handleRemove(path)}
                disabled={removing === path}
                className="text-n-400 hover:text-red-600 flex-shrink-0"
                title="Remove document"
              >
                {removing === path ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-n-200 bg-white px-2.5 py-1.5 text-xs text-n-700 hover:bg-n-50">
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? 'Uploading…' : 'Upload document'}
        <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
