import Link from 'next/link';
import { StatusBadge } from './status-badge';
import { formatINR } from '@repo/ui/formatters';
import type { ExpenseListRow } from '@/lib/expenses-queries';

export function ExpenseTable({ rows }: { rows: ExpenseListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 border rounded">
        <div className="text-gray-400 text-sm">No expenses yet</div>
      </div>
    );
  }
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Voucher</th>
            <th className="px-3 py-2 text-left">Project</th>
            <th className="px-3 py-2 text-left">Submitter</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-center">Docs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 font-mono">
                <Link href={`/expenses/${r.id}`} className="text-blue-600 hover:underline">{r.voucher_number}</Link>
              </td>
              <td className="px-3 py-2">
                {r.project_number
                  ? <span>{r.project_number}<span className="text-gray-500"> · {r.customer_name}</span></span>
                  : <span className="italic text-gray-500">General</span>}
              </td>
              <td className="px-3 py-2">{r.submitter_name ?? '—'}</td>
              <td className="px-3 py-2">{r.category_label ?? '—'}</td>
              <td className="px-3 py-2 max-w-xs truncate" title={r.description ?? ''}>{r.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{formatINR(r.amount)}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-3 py-2 text-center text-xs text-gray-500">{r.document_count > 0 ? `📎 ${r.document_count}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
