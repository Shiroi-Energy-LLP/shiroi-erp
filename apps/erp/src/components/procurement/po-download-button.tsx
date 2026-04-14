'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';

export function PoDownloadButton({ poId, poNumber }: { poId: string; poNumber: string }) {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/${poId}/pdf`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${poNumber.replace(/\//g, '-')}_PurchaseOrder.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[PoDownloadButton] Failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={loading} className="h-8 text-xs">
      <Download className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Generating...' : 'Download PDF'}
    </Button>
  );
}
