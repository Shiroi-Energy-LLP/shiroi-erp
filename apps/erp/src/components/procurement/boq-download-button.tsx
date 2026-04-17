'use client';

/**
 * BOQ Download Button.
 *
 * Generates a PDF of the project BOQ on click and triggers a browser download.
 * Uses @react-pdf/renderer client-side rendering via pdf(...).toBlob().
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';
import type { BoqPdfProps } from '@/lib/pdf/boq-pdf';

interface BoqDownloadButtonProps {
  project: BoqPdfProps['project'];
  items: BoqPdfProps['items'];
  generatedBy: string;
}

export function BoqDownloadButton({ project, items, generatedBy }: BoqDownloadButtonProps) {
  const [generating, setGenerating] = React.useState(false);

  async function handleDownload() {
    setGenerating(true);
    try {
      // Dynamic import to avoid SSR issues with @react-pdf/renderer
      const { pdf } = await import('@react-pdf/renderer');
      const { BoqPdf } = await import('@/lib/pdf/boq-pdf');
      const blob = await pdf(
        <BoqPdf
          project={project}
          items={items}
          generatedBy={generatedBy}
          generatedAt={new Date().toISOString()}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.href = url;
      a.download = `BOQ-${project.project_number}-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[BoqDownloadButton] PDF generation failed', e);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-[10px] px-2 gap-1"
      disabled={generating || items.length === 0}
      onClick={handleDownload}
      title="Download BOQ as PDF"
    >
      <Download className="h-3 w-3" />
      {generating ? 'Generating…' : 'BOQ PDF'}
    </Button>
  );
}
