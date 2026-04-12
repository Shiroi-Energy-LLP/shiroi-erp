'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@repo/ui';
import { updateVisitStatus } from '@/lib/amc-actions';

const VISIT_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'missed', label: 'Missed' },
];

function visitStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'outline' {
  switch (status) {
    case 'completed': return 'success';
    case 'scheduled': return 'info';
    case 'confirmed': return 'info';
    case 'rescheduled': return 'warning';
    case 'missed': return 'error';
    case 'cancelled': return 'outline';
    default: return 'outline';
  }
}

interface VisitStatusToggleProps {
  visitId: string;
  currentStatus: string;
  isOverdue?: boolean;
}

/**
 * Inline dropdown to change visit status.
 */
export function VisitStatusToggle({ visitId, currentStatus, isOverdue }: VisitStatusToggleProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  async function handleSelect(newStatus: string) {
    if (newStatus === currentStatus) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setOpen(false);
    const result = await updateVisitStatus(visitId, newStatus);
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

  const displayStatus = isOverdue && currentStatus !== 'completed' && currentStatus !== 'cancelled'
    ? 'overdue'
    : currentStatus;
  const label = saving ? '...' : displayStatus.replace(/_/g, ' ');

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="cursor-pointer"
        title="Click to change status"
      >
        <Badge
          variant={isOverdue && currentStatus !== 'completed' && currentStatus !== 'cancelled' ? 'error' : visitStatusVariant(currentStatus)}
          className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity capitalize"
        >
          {label}
        </Badge>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-32 bg-white border border-n-200 rounded-md shadow-lg py-1">
          {VISIT_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-n-50 ${
                opt.value === currentStatus ? 'bg-p-50 text-p-700 font-medium' : 'text-n-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
