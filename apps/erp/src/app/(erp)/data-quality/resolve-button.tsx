'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@repo/ui';
import { resolveDataFlag } from '@/lib/data-flag-actions';

export function ResolveButton({ flagId }: { flagId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleResolve = () => {
    startTransition(async () => {
      const result = await resolveDataFlag({ flagId, resolutionNotes: notes || undefined });
      if (result.success) {
        setShowInput(false);
        setNotes('');
      }
    });
  };

  if (showInput) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Resolution note..."
          className="w-32 rounded border px-2 py-1 text-xs"
          onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
        />
        <button
          onClick={handleResolve}
          disabled={isPending}
          className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
        <button
          onClick={() => setShowInput(false)}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => setShowInput(true)} className="text-xs">
      Resolve
    </Button>
  );
}
