'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@repo/ui';
import { updateTicketStatus } from '@/lib/service-ticket-actions';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'escalated', label: 'Escalated' },
];

function statusVariant(status: string): 'error' | 'warning' | 'success' | 'info' | 'outline' {
  switch (status) {
    case 'open': return 'outline';
    case 'assigned': return 'info';
    case 'in_progress': return 'warning';
    case 'resolved': return 'success';
    case 'closed': return 'success';
    case 'escalated': return 'error';
    default: return 'outline';
  }
}

interface TicketStatusToggleProps {
  ticketId: string;
  currentStatus: string;
  slaBreached?: boolean;
}

/**
 * Inline dropdown to change ticket status.
 */
export function TicketStatusToggle({ ticketId, currentStatus, slaBreached }: TicketStatusToggleProps) {
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
    const result = await updateTicketStatus(ticketId, newStatus);
    setSaving(false);
    if (result.success) {
      router.refresh();
    }
  }

  // Close on click outside
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = saving ? '...' : currentStatus.replace(/_/g, ' ');

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="cursor-pointer"
        title="Click to change status"
      >
        <Badge
          variant={statusVariant(currentStatus)}
          className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity capitalize"
        >
          {label}
        </Badge>
        {slaBreached && (
          <Badge variant="error" className="text-[9px] px-1 py-0 ml-0.5">
            SLA
          </Badge>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-32 bg-white border border-n-200 rounded-md shadow-lg py-1">
          {STATUS_OPTIONS.map((opt) => (
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
