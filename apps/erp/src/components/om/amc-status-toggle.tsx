'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@repo/ui';
import { updateAmcStatus } from '@/lib/amc-actions';

interface AmcStatusToggleProps {
  contractId: string;
  currentStatus: string; // 'active' | 'expired' | 'cancelled' etc
}

/**
 * Inline Open/Closed toggle for AMC contracts.
 * Open = active, Closed = expired.
 */
export function AmcStatusToggle({ contractId, currentStatus }: AmcStatusToggleProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const isOpen = currentStatus === 'active' || currentStatus === 'quoted';

  async function handleToggle(toStatus: 'active' | 'expired') {
    if ((toStatus === 'active' && isOpen) || (toStatus === 'expired' && !isOpen)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setOpen(false);
    const result = await updateAmcStatus(contractId, toStatus);
    setSaving(false);
    if (result.success) {
      router.refresh();
    }
  }

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="cursor-pointer"
        title="Click to change status"
      >
        <Badge
          variant={isOpen ? 'error' : 'success'}
          className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity"
        >
          {saving ? '...' : isOpen ? 'Open' : 'Closed'}
        </Badge>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-24 bg-white border border-n-200 rounded-md shadow-lg py-1">
          <button
            onClick={() => handleToggle('active')}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-n-50 ${isOpen ? 'bg-red-50 text-red-700 font-medium' : 'text-n-900'}`}
          >
            Open
          </button>
          <button
            onClick={() => handleToggle('expired')}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-n-50 ${!isOpen ? 'bg-green-50 text-green-700 font-medium' : 'text-n-900'}`}
          >
            Closed
          </button>
        </div>
      )}
    </div>
  );
}
