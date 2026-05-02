'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download, AlertTriangle } from 'lucide-react';

export function PoDownloadButton({ poId, poNumber }: { poId: string; poNumber: string }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/procurement/${poId}/pdf`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('PDF blob is empty');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${poNumber.replace(/\//g, '-')}_PurchaseOrder.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PoDownloadButton] Failed:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={handleDownload} disabled={loading} className="h-8 text-xs">
        <Download className="h-3.5 w-3.5 mr-1.5" />
        {loading ? 'Generating...' : 'Download PDF'}
      </Button>
      {error && (
        <div className="inline-flex items-start gap-1 text-[10px] text-red-700 max-w-[360px]">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
}
