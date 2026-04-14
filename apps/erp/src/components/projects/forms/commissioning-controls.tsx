'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent } from '@repo/ui';
import { FileText, Lock, PenLine } from 'lucide-react';
import { finalizeCommissioningReport } from '@/lib/project-step-actions';
import { SignaturePad } from '@/components/signature-pad';

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

// ── Finalize Button (draft → finalized) with digital signature capture ──

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
  const [showSignatures, setShowSignatures] = React.useState(false);
  const [engineerSig, setEngineerSig] = React.useState<string | null>(null);
  const [customerSig, setCustomerSig] = React.useState<string | null>(null);

  async function handleFinalize() {
    if (!engineerSig || !customerSig) {
      setError('Both engineer and client signatures are required');
      return;
    }

    setLoading(true);
    setError(null);
    const result = await finalizeCommissioningReport({
      projectId,
      reportId,
      engineerSignature: engineerSig,
      customerSignature: customerSig,
    });
    setLoading(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to finalize');
    }
  }

  if (!showSignatures) {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setShowSignatures(true)}>
          <Lock className="h-3.5 w-3.5 mr-1" />
          Finalize Report
        </Button>
      </div>
    );
  }

  return (
    <Card className="w-full border-amber-200 bg-amber-50">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-4">
          <PenLine className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">
            Collect signatures to finalize this report
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <SignaturePad
            label="Engineer Signature *"
            onSignatureChange={setEngineerSig}
          />
          <SignaturePad
            label="Client Signature *"
            onSignatureChange={setCustomerSig}
          />
        </div>
        {error && (
          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded mb-3">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowSignatures(false);
              setEngineerSig(null);
              setCustomerSig(null);
              setError(null);
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleFinalize} disabled={loading}>
            <Lock className="h-3.5 w-3.5 mr-1" />
            {loading ? 'Finalizing...' : 'Finalize & Lock Report'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
