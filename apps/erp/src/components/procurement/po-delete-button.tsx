'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { deletePoSoft } from '@/lib/po-actions';

export function PoDeleteButton({ poId }: { poId: string }) {
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!window.confirm('Cancel this purchase order? This action cannot be undone.')) return;
    setLoading(true);
    try {
      const result = await deletePoSoft(poId);
      if (result.success) {
        router.push('/procurement/orders');
      } else {
        console.error('[PoDeleteButton] Failed:', result.error);
        alert(`Failed to cancel PO: ${result.error}`);
      }
    } catch (err) {
      console.error('[PoDeleteButton] Unexpected error:', err);
      alert('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleDelete}
      disabled={loading}
      className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
    >
      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Cancelling...' : 'Cancel PO'}
    </Button>
  );
}
