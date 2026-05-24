'use client';

import * as React from 'react';
import { FileDown, RefreshCw, Download } from 'lucide-react';
import { Button } from '@repo/ui';
import { generateHandoverPackPdf, getHandoverPackDownloadUrl } from '@/lib/handover-pdf-actions';

interface HandoverPdfButtonProps {
  projectId: string;
  existingPath?: string | null;
  viewerRole: string | null;
}

export function HandoverPdfButton({ projectId, existingPath, viewerRole }: HandoverPdfButtonProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = React.useState<string | null>(null);

  const canGenerate = !!viewerRole && ['founder', 'project_manager'].includes(viewerRole);

  // If there's an existing PDF, pre-fetch a signed URL for it
  React.useEffect(() => {
    if (!existingPath) return;
    getHandoverPackDownloadUrl(existingPath).then((res) => {
      if (res.success) setDownloadUrl(res.data.url);
    });
  }, [existingPath]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    const res = await generateHandoverPackPdf(projectId);
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setDownloadUrl(res.data.downloadUrl);
  }

  if (!canGenerate && !existingPath) return null;

  return (
    <div className="flex items-center gap-2">
      {existingPath && downloadUrl && (
        <Button variant="outline" size="sm" asChild className="gap-1.5 h-8 text-xs">
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" download>
            <Download className="h-3.5 w-3.5" />
            Download Handover PDF
          </a>
        </Button>
      )}

      {canGenerate && (
        <Button
          variant={existingPath ? 'ghost' : 'outline'}
          size="sm"
          onClick={handleGenerate}
          disabled={busy}
          className="gap-1.5 h-8 text-xs"
        >
          {busy ? (
            <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating…</>
          ) : existingPath ? (
            <><RefreshCw className="h-3.5 w-3.5" /> Regenerate</>
          ) : (
            <><FileDown className="h-3.5 w-3.5" /> Generate Handover PDF</>
          )}
        </Button>
      )}

      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
