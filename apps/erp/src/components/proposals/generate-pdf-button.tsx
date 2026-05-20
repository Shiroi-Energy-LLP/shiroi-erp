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
    // No window.open here. We tried opening a placeholder tab synchronously
    // to bypass popup blockers, but that left the user staring at an empty
    // about:blank tab for the several seconds it takes to render+upload the
    // PDF. Now we just fetch, then surface an inline "Open PDF" link on
    // success; one extra click but no blank-tab limbo.
    setGenerating(true);
    setError(null);
    setPdfUrl(null);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/generate-pdf`, {
        method: 'POST',
      });

      const data: { error?: string; signedUrl?: string | null } = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate PDF');
        return;
      }

      if (data.signedUrl) {
        setPdfUrl(data.signedUrl);
        // Link stays visible until the user clicks it or 5 minutes pass
        // (signed URL itself is valid for 1h).
        setTimeout(() => setPdfUrl(null), 5 * 60 * 1000);
      }
    } catch (err) {
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
