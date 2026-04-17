import { cn } from '@repo/ui';

const STYLES: Record<string, string> = {
  submitted: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  verified:  'bg-blue-100 text-blue-800 border-blue-300',
  approved:  'bg-green-100 text-green-800 border-green-300',
  rejected:  'bg-red-100 text-red-800 border-red-300',
};

const LABELS: Record<string, string> = {
  submitted: 'Submitted',
  verified:  'Verified',
  approved:  'Approved',
  rejected:  'Rejected',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('px-2 py-0.5 rounded border text-xs font-medium', STYLES[status] ?? 'bg-gray-100 text-gray-800 border-gray-300')}>
      {LABELS[status] ?? status}
    </span>
  );
}
