import Link from 'next/link';
import { StatusBadge } from './status-badge';
import { formatINR } from '@repo/ui/formatters';
import type { ExpenseListRow } from '@/lib/expenses-queries';

/**
 * Column order is Vivek's spec (2026-07-30):
 *   Project Name | Submitter | Category | Description | Amount | Voucher No. | Status
 *
 * `table-fixed` + explicit widths + `break-words` is what keeps every cell
 * wrapping instead of pushing the table into a horizontal scroll — an
 * auto-layout table widens to fit its longest cell no matter what wrapping
 * classes the cells carry.
 *
 * The old standalone Docs column is folded into the voucher cell as a 📎 count
 * so the 7-column spec holds without losing the attachment indicator.
 */
export function ExpenseTable({ rows }: { rows: ExpenseListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 border rounded">
        <div className="text-gray-400 text-sm">No expenses match these filters</div>
      </div>
    );
  }
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[19%]" />
          <col className="w-[13%]" />
          <col className="w-[11%]" />
          <col className="w-[24%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Project Name</th>
            <th className="px-3 py-2 text-left font-medium">Submitter</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-left font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-left font-medium">Voucher No.</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="[&_td]:align-top [&_td]:break-words [&_td]:px-3 [&_td]:py-2">
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td>
                {r.project_id ? (
                  <Link
                    href={`/projects/${r.project_id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {r.project_name?.trim() || r.customer_name || r.project_number || '(project)'}
                  </Link>
                ) : (
                  <span className="italic text-gray-500">General</span>
                )}
                {r.project_id && r.project_number && (
                  <div className="text-xs text-gray-500 font-mono">{r.project_number}</div>
                )}
              </td>
              <td>
                {r.submitter_name ?? '—'}
                {r.entered_by_name && (
                  <div className="text-xs text-gray-500">entered by {r.entered_by_name}</div>
                )}
              </td>
              <td>{r.category_label ?? '—'}</td>
              <td className="whitespace-pre-wrap">{r.description ?? '—'}</td>
              <td className="text-right font-mono">{formatINR(r.amount)}</td>
              <td>
                <Link href={`/expenses/${r.id}`} className="text-blue-600 hover:underline font-mono">
                  {r.voucher_number}
                </Link>
                {r.document_count > 0 && (
                  <div className="text-xs text-gray-500">📎 {r.document_count}</div>
                )}
              </td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
