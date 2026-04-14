'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';

export function SurveyDownloadButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/survey`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') ?? 'survey-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[SurveyDownloadButton] Failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={loading} className="h-8 text-xs">
      <Download className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Generating...' : 'Download Survey PDF'}
    </Button>
  );
}
