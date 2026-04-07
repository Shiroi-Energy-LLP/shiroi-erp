'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { FileDown } from 'lucide-react';

interface ProjectPdfButtonProps {
  projectId: string;
  sections?: string[];
  label?: string;
}

export function ProjectPdfButton({
  projectId,
  sections = ['survey', 'boq', 'commissioning', 'qc'],
  label = 'Export PDF',
}: ProjectPdfButtonProps) {
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleExport() {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // Download the PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'project-report.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleExport} disabled={generating}>
        <FileDown className={`h-4 w-4 mr-1.5 ${generating ? 'animate-pulse' : ''}`} />
        {generating ? 'Generating...' : label}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
