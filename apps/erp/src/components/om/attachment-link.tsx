'use client';

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { FileText, Loader2 } from 'lucide-react';

interface AttachmentLinkProps {
  path: string;
  name: string;
  className?: string;
}

/**
 * Opens a `project-files` attachment via a short-lived signed URL (the bucket is
 * private). Generates the URL on click so we don't mint URLs for files the user
 * never opens.
 */
export function AttachmentLink({ path, name, className }: AttachmentLinkProps) {
  const [loading, setLoading] = React.useState(false);

  async function handleOpen() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.storage.from('project-files').createSignedUrl(path, 600);
    setLoading(false);
    if (error || !data?.signedUrl) {
      alert('Could not open attachment');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={loading}
      className={`inline-flex items-center gap-1 text-xs text-shiroi-gold-dark hover:underline ${className ?? ''}`}
      title={name}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
      <span className="truncate max-w-[200px]">{name}</span>
    </button>
  );
}
