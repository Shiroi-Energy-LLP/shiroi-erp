'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button } from '@repo/ui';
import { Pencil, Check, X } from 'lucide-react';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { updateSiteExpense } from '@/lib/site-expenses-actions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VoucherRow {
  id: string;
  amount: number;
  description: string | null;
  expense_category: string | null;
  expense_date: string | null;
  status: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  approved_by_name: string | null;
  rejected_reason: string | null;
  receipt_file_path: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<string, string> = {
  travel: 'Travel',
  food: 'Food',
  lodging: 'Lodging',
  site_material: 'Site Material',
  tools: 'Tools',
  consumables: 'Consumables',
  labour_advance: 'Labour Advance',
  miscellaneous: 'Miscellaneous',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS);

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function statusBadge(status: string | null) {
  switch (status) {
    case 'approved':
    case 'auto_approved':
      return <Badge variant="success">Approved</Badge>;
    case 'pending':
      return <Badge variant="warning">Pending</Badge>;
    case 'rejected':
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge>{status ?? '—'}</Badge>;
  }
}

/* ------------------------------------------------------------------ */
/*  Inline edit row                                                    */
/* ------------------------------------------------------------------ */

function EditableVoucherRow({
  voucher,
  projectId,
  isLocked,
}: {
  voucher: VoucherRow;
  projectId: string;
  isLocked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Edit state
  const [amount, setAmount] = React.useState(voucher.amount.toString());
  const [desc, setDesc] = React.useState(voucher.description ?? '');
  const [cat, setCat] = React.useState(voucher.expense_category ?? 'miscellaneous');
  const [date, setDate] = React.useState(voucher.expense_date ?? '');

  const canEdit = voucher.status === 'pending' && !isLocked;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await updateSiteExpense({
      expenseId: voucher.id,
      projectId,
      amount: parseFloat(amount),
      description: desc,
      expenseCategory: cat,
      expenseDate: date || undefined,
    });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Update failed');
    }
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
    setAmount(voucher.amount.toString());
    setDesc(voucher.description ?? '');
    setCat(voucher.expense_category ?? 'miscellaneous');
    setDate(voucher.expense_date ?? '');
  }

  if (editing) {
    return (
      <tr className="border-b border-n-100 bg-blue-50/30">
        <td className="px-3 py-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-[11px] border border-n-200 rounded px-1.5 py-0.5 w-28 bg-white"
          />
        </td>
        <td className="px-3 py-1.5">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="text-[11px] border border-n-200 rounded px-1.5 py-0.5 bg-white"
          >
            {CATEGORY_OPTIONS.map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="text-[11px] border border-n-200 rounded px-1.5 py-0.5 w-full bg-white"
          />
        </td>
        <td className="px-3 py-1.5 text-n-500">{voucher.submitted_by_name ?? '—'}</td>
        <td className="px-3 py-1.5 text-right">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-[11px] border border-n-200 rounded px-1.5 py-0.5 w-24 text-right bg-white font-mono"
          />
        </td>
        <td className="px-3 py-1.5">{statusBadge(voucher.status)}</td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="p-0.5 text-green-600 hover:text-green-800"
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleCancel}
              className="p-0.5 text-n-500 hover:text-n-900"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <span className="text-[9px] text-red-600">{error}</span>}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-n-100 last:border-b-0 hover:bg-n-50">
      <td className="px-3 py-1.5 text-n-500">
        {voucher.expense_date ? formatDate(voucher.expense_date) : '—'}
      </td>
      <td className="px-3 py-1.5 text-n-500">
        {CATEGORY_LABELS[voucher.expense_category ?? ''] ?? voucher.expense_category ?? '—'}
      </td>
      <td className="px-3 py-1.5 text-n-900">{voucher.description ?? '—'}</td>
      <td className="px-3 py-1.5 text-n-500">{voucher.submitted_by_name ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-mono">{formatINR(voucher.amount)}</td>
      <td className="px-3 py-1.5">{statusBadge(voucher.status)}</td>
      <td className="px-3 py-1.5">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="p-0.5 text-n-400 hover:text-blue-600"
            title="Edit voucher"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main: Voucher table with category filter + edit                    */
/* ------------------------------------------------------------------ */

export function VoucherTable({
  vouchers,
  projectId,
  isLocked,
}: {
  vouchers: VoucherRow[];
  projectId: string;
  isLocked: boolean;
}) {
  const [categoryFilter, setCategoryFilter] = React.useState('all');

  const filtered = categoryFilter === 'all'
    ? vouchers
    : vouchers.filter((v) => v.expense_category === categoryFilter);

  return (
    <div>
      {/* Category filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-n-50 border-b border-n-200">
        <span className="text-[10px] text-n-500 font-medium">Filter:</span>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-[11px] border border-n-200 rounded px-2 py-0.5 bg-white"
        >
          <option value="all">All Categories ({vouchers.length})</option>
          {CATEGORY_OPTIONS.map(([val, label]) => {
            const count = vouchers.filter((v) => v.expense_category === val).length;
            return count > 0 ? (
              <option key={val} value={val}>{label} ({count})</option>
            ) : null;
          })}
        </select>
        {categoryFilter !== 'all' && (
          <button
            onClick={() => setCategoryFilter('all')}
            className="text-[10px] text-blue-600 hover:underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-[10px] text-n-400">
          {filtered.length} of {vouchers.length} vouchers
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-n-200 bg-n-50">
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Date</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Category</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Description</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Submitted By</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">Amount</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Status</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500 w-[40px]">Edit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <EditableVoucherRow
                key={v.id}
                voucher={v}
                projectId={projectId}
                isLocked={isLocked}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-n-400 text-[11px]">
                  {categoryFilter !== 'all'
                    ? `No vouchers in ${CATEGORY_LABELS[categoryFilter] ?? categoryFilter} category`
                    : 'No vouchers submitted yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
