import type { InverterPollFailureRow } from '@/lib/inverters-queries';

interface RecentFailuresProps {
  failures: InverterPollFailureRow[];
}

export function RecentFailures({ failures }: RecentFailuresProps) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <h2 className="text-sm font-semibold text-red-900">
        Recent poll failures{' '}
        <span className="font-normal text-red-600">({failures.length})</span>
      </h2>
      <ul className="mt-2 space-y-1 text-xs font-mono text-red-900">
        {failures.map((f) => (
          <li key={f.id} className="flex gap-2">
            <span className="text-red-500 shrink-0">
              {new Date(f.attempted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </span>
            <span className="text-red-400 shrink-0">·</span>
            <span className="text-red-600 shrink-0">inv {f.inverter_id.slice(0, 8)}</span>
            <span className="text-red-400 shrink-0">·</span>
            <span className="truncate">{f.error_message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
