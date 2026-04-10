'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@repo/ui';
import { Download, Send, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { submitDeliveryChallan } from '@/lib/project-step-actions';
import { getCategoryLabel } from '@/lib/boi-constants';

// ── PDF Download Button ──

export function DcDownloadButton({ projectId, dcId, dcLabel }: { projectId: string; dcId: string; dcLabel: string }) {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/dc/${dcId}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        alert(err.error || 'Failed to download DC PDF');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dcLabel.replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DcDownloadButton] Download failed:', err);
      alert('Failed to download PDF');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-[11px] text-p-600 hover:text-p-700"
      onClick={handleDownload}
      disabled={loading}
      title={`Download ${dcLabel} PDF`}
    >
      <Download className="h-3 w-3 mr-1" />
      {loading ? '...' : 'PDF'}
    </Button>
  );
}

// ── Submit (Finalize) DC Button ──

export function DcSubmitButton({ projectId, challanId }: { projectId: string; challanId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit() {
    if (!confirm('Submit and finalize this Delivery Challan? Status will change to "Dispatched".')) return;
    setLoading(true);
    setError(null);
    const result = await submitDeliveryChallan({ projectId, challanId });
    setLoading(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to submit');
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px] text-green-600 hover:text-green-700"
        onClick={handleSubmit}
        disabled={loading}
        title="Submit DC"
      >
        <Send className="h-3 w-3 mr-1" />
        {loading ? '...' : 'Submit'}
      </Button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

// ── DC Expandable Detail Row ──

interface DcDetailProps {
  dc: {
    id: string;
    dc_number: string;
    dc_date: string;
    dispatch_from: string | null;
    dispatch_to: string | null;
    vehicle_number: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    notes: string | null;
    status: string;
    delivery_challan_items: {
      id: string;
      item_description: string;
      item_category?: string;
      quantity: number;
      unit: string;
    }[];
  };
  projectId: string;
  dcLabel: string;
}

export function DcExpandableRow({ dc, projectId, dcLabel }: DcDetailProps) {
  const [expanded, setExpanded] = React.useState(false);
  const items = dc.delivery_challan_items ?? [];

  return (
    <>
      {/* Toggle row */}
      <tr
        className="border-b border-n-100 hover:bg-n-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-2 py-2 font-mono font-bold text-p-600 text-[12px]">
          <div className="flex items-center gap-1">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {dcLabel}
          </div>
        </td>
        <td className="px-2 py-2 font-mono text-[11px] text-n-500">{dc.dc_number}</td>
        <td className="px-2 py-2 text-[12px] text-n-700">
          {dc.dc_date ? new Date(dc.dc_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'}
        </td>
        <td className="px-2 py-2 text-[11px] text-n-600 max-w-[200px] truncate">
          {dc.dispatch_from || '\u2014'} &rarr; {dc.dispatch_to || '\u2014'}
        </td>
        <td className="px-2 py-2 text-[11px] text-n-500">{dc.vehicle_number || '\u2014'}</td>
        <td className="px-2 py-2 text-center font-mono text-[12px]">{items.length}</td>
        <td className="px-2 py-2">
          <Badge
            variant={dc.status === 'delivered' ? 'success' : dc.status === 'dispatched' ? 'warning' : 'neutral'}
            className="capitalize text-[10px]"
          >
            {dc.status.replace(/_/g, ' ')}
          </Badge>
        </td>
        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <DcDownloadButton projectId={projectId} dcId={dc.id} dcLabel={dc.dc_number} />
            {dc.status === 'draft' && (
              <DcSubmitButton projectId={projectId} challanId={dc.id} />
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="border-b border-n-200 bg-[#F8F9FA]">
          <td colSpan={8} className="px-4 py-3">
            <div className="space-y-3">
              {/* Items table */}
              <div>
                <p className="text-[10px] font-bold text-[#7C818E] uppercase tracking-wide mb-2">Items</p>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-n-200">
                      <th className="px-2 py-1 text-left font-medium text-[#7C818E] w-[30px]">#</th>
                      <th className="px-2 py-1 text-left font-medium text-[#7C818E]">Description</th>
                      <th className="px-2 py-1 text-right font-medium text-[#7C818E] w-[60px]">Qty</th>
                      <th className="px-2 py-1 text-left font-medium text-[#7C818E] w-[60px]">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any, idx: number) => (
                      <tr key={item.id} className="border-b border-n-100">
                        <td className="px-2 py-1 font-mono text-n-400">{idx + 1}</td>
                        <td className="px-2 py-1 text-[#1A1D24]">{item.item_description}</td>
                        <td className="px-2 py-1 text-right font-mono">{item.quantity}</td>
                        <td className="px-2 py-1 text-n-500">{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Transport + notes */}
              <div className="flex gap-6 text-[11px]">
                {dc.driver_name && (
                  <span><strong>Driver:</strong> {dc.driver_name} {dc.driver_phone ? `(${dc.driver_phone})` : ''}</span>
                )}
                {dc.notes && (
                  <span><strong>Notes:</strong> {dc.notes}</span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
