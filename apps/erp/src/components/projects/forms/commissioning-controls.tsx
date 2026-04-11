'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { FileText, Lock } from 'lucide-react';
import { finalizeCommissioningReport } from '@/lib/project-step-actions';

// ── PDF Download Button ──

export function CommissioningPdfButton({ projectId }: { projectId: string }) {
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/commissioning`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Commissioning-Report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download commissioning report PDF.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
      <FileText className="h-3.5 w-3.5 mr-1" />
      {downloading ? 'Generating...' : 'Download PDF'}
    </Button>
  );
}

// ── Finalize Button (draft → finalized) ──

export function FinalizeButton({
  projectId,
  reportId,
}: {
  projectId: string;
  reportId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFinalize() {
    if (
      !confirm(
        'Finalize this commissioning report?\n\n' +
          'The report will be locked and a PDF will be generated.\n' +
          'This cannot be undone.',
      )
    )
      return;

    setLoading(true);
    setError(null);
    const result = await finalizeCommissioningReport({ projectId, reportId });
    setLoading(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to finalize');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={handleFinalize} disabled={loading}>
        <Lock className="h-3.5 w-3.5 mr-1" />
        {loading ? 'Finalizing...' : 'Finalize Report'}
      </Button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
