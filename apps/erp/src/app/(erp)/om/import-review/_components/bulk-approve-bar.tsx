'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { bulkApprovePendingImports } from '@/lib/import-review-actions';
import { useRouter } from 'next/navigation';

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

export function BulkApproveBar({ selectedIds, onClear }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ approved: number; failed: number } | null>(null);
  const [errors, setErrors] = React.useState<Array<{ id: string; error: string }>>([]);

  if (selectedIds.length === 0 && result === null) return null;

  async function handleBulkApprove() {
    if (!window.confirm(`Approve and import ${selectedIds.length} pending row${selectedIds.length === 1 ? '' : 's'}? This creates new project + inverter + credential rows for each.`)) return;
    setPending(true);
    const res = await bulkApprovePendingImports(selectedIds);
    setPending(false);
    if (res.success) {
      setResult({ approved: res.data.approved, failed: res.data.failed });
      setErrors(res.data.errors);
    }
    router.refresh();
  }

  function handleDismiss() {
    setResult(null);
    setErrors([]);
    onClear();
  }

  if (result !== null) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-2xl">
        <div className="bg-white border border-n-200 shadow-lg rounded-lg p-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-n-900">
              Bulk approve complete: {result.approved} imported
              {result.failed > 0 && <span className="text-red-600">, {result.failed} failed</span>}
            </div>
            {errors.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto text-[11px] text-red-700 space-y-0.5">
                {errors.slice(0, 5).map((e, i) => (
                  <div key={i}>· <span className="font-mono text-[10px]">{e.id.slice(0, 8)}</span>: {e.error}</div>
                ))}
                {errors.length > 5 && <div className="text-n-500">...and {errors.length - 5} more (check Errors tab)</div>}
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 w-7 p-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
      <div className="bg-n-900 text-white shadow-lg rounded-full px-4 py-2 flex items-center gap-3">
        <span className="text-sm">{selectedIds.length} selected</span>
        <Button
          size="sm"
          onClick={handleBulkApprove}
          disabled={pending}
          className="bg-shiroi-gold hover:bg-shiroi-gold-hover text-shiroi-ink h-7 text-xs"
        >
          {pending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
          Approve all
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} className="text-white hover:bg-n-800 h-7 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
