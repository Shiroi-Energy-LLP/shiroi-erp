'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Button } from '@repo/ui';
import { Paperclip, Loader2, Trash2, Settings2, MessageSquare, X } from 'lucide-react';
import { addTicketEvent, deleteTicketEvent, type TicketEventRow } from '@/lib/service-ticket-actions';
import { AttachmentLink } from '@/components/om/attachment-link';

interface TicketTimelineProps {
  ticketId: string;
  events: TicketEventRow[];
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

export function TicketTimeline({ ticketId, events }: TicketTimelineProps) {
  const router = useRouter();
  const [body, setBody] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim() && !file) {
      setError('Add a note or attach a file');
      return;
    }
    setSaving(true);
    setError(null);

    let attachmentPath: string | undefined;
    let attachmentName: string | undefined;
    if (file) {
      const supabase = createClient();
      const ext = file.name.split('.').pop() || 'bin';
      const path = `tickets/${ticketId}/timeline/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('project-files').upload(path, file);
      if (uploadError) {
        setError('File upload failed');
        setSaving(false);
        return;
      }
      attachmentPath = path;
      attachmentName = file.name;
    }

    const result = await addTicketEvent({ ticketId, body, attachmentPath, attachmentName });
    setSaving(false);
    if (result.success) {
      setBody('');
      setFile(null);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add update');
    }
  }

  async function handleDelete(eventId: string) {
    if (!confirm('Delete this update?')) return;
    setDeletingId(eventId);
    const result = await deleteTicketEvent(eventId, ticketId);
    setDeletingId(null);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to delete');
    }
  }

  return (
    <div className="space-y-4">
      {/* Composer */}
      <form onSubmit={handleAdd} className="space-y-2 rounded-md border border-n-200 bg-n-50 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a work-progress note or update…"
          className="w-full rounded-md border border-n-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-n-600 hover:text-n-900">
              <Paperclip className="h-3.5 w-3.5" />
              {file ? 'Change file' : 'Attach file'}
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && (
              <span className="inline-flex items-center gap-1 text-xs text-n-700 bg-white border border-n-200 rounded px-1.5 py-0.5">
                <span className="truncate max-w-[160px]">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-n-400 hover:text-red-600">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add Update'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {/* Feed */}
      {events.length === 0 ? (
        <p className="text-xs text-n-400 px-1">No activity yet.</p>
      ) : (
        <ul className="space-y-0">
          {events.map((event, i) => {
            const isSystem = event.entry_type === 'system';
            const author = event.author?.full_name ?? null;
            return (
              <li key={event.id} className="relative flex gap-3 pb-4">
                {/* Rail */}
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                      isSystem ? 'bg-n-100 text-n-500' : 'bg-shiroi-gold/15 text-shiroi-gold-dark'
                    }`}
                  >
                    {isSystem ? <Settings2 className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                  </div>
                  {i < events.length - 1 && <div className="w-px flex-1 bg-n-150" />}
                </div>

                {/* Body */}
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-xs ${isSystem ? 'text-n-500 italic' : 'text-n-800'} whitespace-pre-wrap break-words`}>
                      {event.body}
                    </p>
                    {!isSystem && (
                      <button
                        type="button"
                        onClick={() => handleDelete(event.id)}
                        disabled={deletingId === event.id}
                        className="flex-shrink-0 text-n-300 hover:text-red-600"
                        title="Delete update"
                      >
                        {deletingId === event.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                  {event.attachment_path && (
                    <div className="mt-1">
                      <AttachmentLink path={event.attachment_path} name={event.attachment_name ?? 'attachment'} />
                    </div>
                  )}
                  <p className="mt-0.5 text-[10px] text-n-400">
                    {formatStamp(event.created_at)}
                    {author ? ` · ${author}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
