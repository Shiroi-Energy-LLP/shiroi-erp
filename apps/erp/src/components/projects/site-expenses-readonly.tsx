import Link from 'next/link';
import { getExpensesByProject } from '@/lib/expenses-queries';
import { StatusBadge } from '@/components/expenses/status-badge';
import { formatINR } from '@repo/ui/formatters';

/**
 * Read-only embed of /expenses filtered to a single project.
 * General expenses (project_id IS NULL) naturally drop out since the filter
 * is project_id = :id — no extra check needed.
 */
export async function SiteExpensesReadonly({ projectId }: { projectId: string }) {
  const rows = await getExpensesByProject(projectId);

  const subtotal = rows
    .filter((r) => r.status === 'verified' || r.status === 'approved')
    .reduce((acc, r) => acc + Number(r.amount), 0);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No expenses logged for this project yet. Add one from{' '}
        <Link className="text-blue-600 hover:underline" href="/expenses">/expenses</Link>.
      </div>
    );
  }

  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Voucher</th>
            <th className="px-3 py-2 text-left">Engineer</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-center">Docs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-2 font-mono">
                <Link href={`/expenses/${r.id}`} className="text-blue-600 hover:underline">{r.voucher_number}</Link>
              </td>
              <td className="px-3 py-2">{r.submitter_name ?? '—'}</td>
              <td className="px-3 py-2">{r.category_label ?? '—'}</td>
              <td className="px-3 py-2 max-w-xs truncate" title={r.description ?? ''}>{r.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{formatINR(r.amount)}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-3 py-2 text-center text-xs text-gray-500">{r.document_count > 0 ? `📎 ${r.document_count}` : ''}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td colSpan={4} className="px-3 py-2 text-right">Subtotal (verified + approved):</td>
            <td className="px-3 py-2 text-right font-mono">{formatINR(subtotal)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
