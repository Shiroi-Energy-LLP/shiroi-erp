import { toIST } from '@repo/ui/formatters';

interface TimelineProps {
  projectLinked: boolean;
  status: string;
  submittedAt: string | null;
  submitterName: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectedReason: string | null;
}

export function StatusTimeline(p: TimelineProps) {
  const nodes: Array<{ key: string; label: string; actor: string | null; at: string | null; active: boolean; color: string }> = [
    { key: 'submitted', label: 'Submitted', actor: p.submitterName, at: p.submittedAt, active: !!p.submittedAt, color: 'yellow' },
  ];
  if (p.projectLinked) {
    nodes.push({ key: 'verified', label: 'Verified', actor: p.verifiedByName, at: p.verifiedAt, active: !!p.verifiedAt, color: 'blue' });
  }
  nodes.push({ key: 'approved', label: 'Approved', actor: p.approvedByName, at: p.approvedAt, active: !!p.approvedAt, color: 'green' });
  if (p.status === 'rejected') {
    nodes.push({ key: 'rejected', label: `Rejected${p.rejectedReason ? ': ' + p.rejectedReason : ''}`, actor: p.rejectedByName, at: p.rejectedAt, active: true, color: 'red' });
  }

  return (
    <ol className="relative border-l-2 border-gray-200 ml-4">
      {nodes.map((n) => (
        <li key={n.key} className="ml-4 py-2">
          <span className={`absolute -left-[9px] w-4 h-4 rounded-full ${
            n.active
              ? n.color === 'yellow' ? 'bg-yellow-400'
                : n.color === 'blue'   ? 'bg-blue-500'
                : n.color === 'green'  ? 'bg-green-500'
                : 'bg-red-500'
              : 'bg-gray-200'
          }`} />
          <div className={n.active ? 'text-gray-900' : 'text-gray-400'}>
            <div className="text-sm font-medium">{n.label}</div>
            {n.active && (
              <div className="text-xs text-gray-500">
                {n.actor ?? '—'} · {n.at ? toIST(n.at) : '—'}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
