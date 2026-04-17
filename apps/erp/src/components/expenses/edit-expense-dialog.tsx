'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select } from '@repo/ui';
import { updateExpense } from '@/lib/expenses-actions';

interface CategoryOpt { id: string; label: string }

export function EditExpenseDialog({
  id,
  initial,
  categories,
}: {
  id: string;
  initial: { description: string | null; amount: number; expense_date: string | null; category_id: string };
  categories: CategoryOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(initial.description ?? '');
  const [amount, setAmount] = useState(String(initial.amount));
  const [expenseDate, setExpenseDate] = useState(initial.expense_date ?? '');
  const [categoryId, setCategoryId] = useState(initial.category_id);

  async function handle() {
    setSaving(true); setError(null);
    const r = await updateExpense(id, {
      description,
      amount: Number(amount),
      expenseDate: expenseDate || undefined,
      categoryId,
    });
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit expense</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <textarea className="w-full border rounded p-2 text-sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (INR)</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Expense date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
