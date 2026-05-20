'use client';

import { useState } from 'react';
import { Button } from '@repo/ui';

interface GeneratePDFButtonProps {
  proposalId: string;
}

export function GeneratePDFButton({ proposalId }: GeneratePDFButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    // Open a placeholder tab synchronously *inside* the click handler.
    // Browsers (Chrome/Edge/Safari) block window.open() called from async
    // continuations because the call no longer maps to a user gesture, but
    // a tab opened during the click handler is allowed even if we set its
    // location afterwards. The tab navigates to the signed URL once the
    // POST resolves.
    const placeholderTab = typeof window !== 'undefined'
      ? window.open('about:blank', '_blank', 'noopener,noreferrer')
      : null;

    setGenerating(true);
    setError(null);
    setPdfUrl(null);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/generate-pdf`, {
        method: 'POST',
      });

      const data: { error?: string; signedUrl?: string | null } = await res.json();
      if (!res.ok) {
        placeholderTab?.close();
        setError(data.error ?? 'Failed to generate PDF');
        return;
      }

      if (data.signedUrl) {
        if (placeholderTab && !placeholderTab.closed) {
          placeholderTab.location.href = data.signedUrl;
        }
        // Always surface the link in-place too — covers the popup-blocked case
        // and gives the user a re-open affordance for ~30s.
        setPdfUrl(data.signedUrl);
        setTimeout(() => setPdfUrl(null), 30000);
      }
    } catch (err) {
      placeholderTab?.close();
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerate}
        disabled={generating}
      >
        {generating ? 'Generating...' : 'Generate PDF'}
      </Button>
      {error && (
        <span className="text-xs text-status-error-text">{error}</span>
      )}
      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-shiroi-green underline hover:no-underline"
        >
          Open PDF ↗
        </a>
      )}
    </div>
  );
}
