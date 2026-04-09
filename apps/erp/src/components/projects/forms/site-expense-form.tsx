'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Label } from '@repo/ui';
import { Plus } from 'lucide-react';
import { submitSiteExpense } from '@/lib/site-expenses-actions';

const CATEGORY_OPTIONS = [
  { value: 'travel', label: 'Travel' },
  { value: 'food', label: 'Food' },
  { value: 'lodging', label: 'Lodging' },
  { value: 'site_material', label: 'Site Material' },
  { value: 'tools', label: 'Tools' },
  { value: 'consumables', label: 'Consumables' },
  { value: 'labour_advance', label: 'Labour Advance' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
] as const;

type Category = (typeof CATEGORY_OPTIONS)[number]['value'];

interface SiteExpenseFormProps {
  projectId: string;
}

export function SiteExpenseForm({ projectId }: SiteExpenseFormProps) {
  const router = useRouter();
  const [amount, setAmount] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<Category>('travel');
  const [expenseDate, setExpenseDate] = React.useState<string>(
    new Date().toISOString().split('T')[0] ?? '',
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!description.trim()) {
      setError('Description required');
      return;
    }

    setSaving(true);
    const res = await submitSiteExpense({
      projectId,
      amount: amt,
      description,
      expenseCategory: category,
      expenseDate: expenseDate || null,
    });
    setSaving(false);

    if (!res.success) {
      setError(res.error ?? 'Failed to submit voucher');
      return;
    }

    // Reset the form
    setAmount('');
    setDescription('');
    setCategory('travel');
    setExpenseDate(new Date().toISOString().split('T')[0] ?? '');
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-n-200 bg-n-50/40 p-4 space-y-3"
    >
      <div className="text-sm font-medium text-n-900 flex items-center gap-1.5">
        <Plus className="h-4 w-4 text-shiroi-green" /> Add Site Expense Voucher
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-3">
          <Label className="text-xs">Category</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-3">
          <Label className="text-xs">Amount (₹)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="col-span-3">
          <Label className="text-xs">Expense Date</Label>
          <Input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </div>
        <div className="col-span-3 flex items-end">
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Submit'}
          </Button>
        </div>
        <div className="col-span-12">
          <Label className="text-xs">Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Autorickshaw to Guduvancheri site for panel handover"
          />
        </div>
      </div>
      {error && (
        <div className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded border border-red-200">
          {error}
        </div>
      )}
      <div className="text-[11px] text-n-500">
        Submitted vouchers go into a <span className="font-medium">Pending</span> state. A PM,
        Finance, or Founder user approves or rejects them from the Vouchers queue.
      </div>
    </form>
  );
}
