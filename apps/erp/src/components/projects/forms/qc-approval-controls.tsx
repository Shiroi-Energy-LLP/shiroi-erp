'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Check, RotateCcw, FileText } from 'lucide-react';
import { approveQcInspection, requestQcRework } from '@/lib/project-step-actions';

// ── Approve / Rework buttons ──

export function QcApprovalControls({
  projectId,
  inspectionId,
}: {
  projectId: string;
  inspectionId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleApprove() {
    if (!confirm('Approve this QC inspection?\nThis will lock the checklist and generate a PDF report.'))
      return;
    setLoading(true);
    setError(null);
    const result = await approveQcInspection({ projectId, inspectionId });
    setLoading(false);
    if (result.success) router.refresh();
    else setError(result.error ?? 'Failed to approve');
  }

  async function handleRework() {
    if (!confirm('Request rework?\nThe inspector will need to redo the QC inspection.')) return;
    setLoading(true);
    setError(null);
    const result = await requestQcRework({ projectId, inspectionId });
    setLoading(false);
    if (result.success) router.refresh();
    else setError(result.error ?? 'Failed to request rework');
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={handleApprove}
        disabled={loading}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        <Check className="h-3.5 w-3.5 mr-1" />
        {loading ? '...' : 'Approve'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleRework}
        disabled={loading}
        className="border-red-300 text-red-700 hover:bg-red-50"
      >
        <RotateCcw className="h-3.5 w-3.5 mr-1" />
        {loading ? '...' : 'Rework Required'}
      </Button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

// ── PDF Download button ──

export function QcPdfDownloadButton({
  projectId,
  inspectionId,
}: {
  projectId: string;
  inspectionId: string;
}) {
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/qc/${inspectionId}`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QC-Report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download QC report PDF.');
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
