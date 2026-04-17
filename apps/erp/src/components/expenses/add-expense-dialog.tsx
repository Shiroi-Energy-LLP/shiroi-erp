'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
} from '@repo/ui';
import { submitExpense } from '@/lib/expenses-actions';

interface ProjectOpt { id: string; project_number: string | null; customer_name: string | null }
interface CategoryOpt { id: string; label: string }

const GENERAL_SENTINEL = '__general__';

export function AddExpenseDialog({ projects, categories }: {
  projects: ProjectOpt[];
  categories: CategoryOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().slice(0, 10));

  function reset() {
    setProjectId('');
    setCategoryId('');
    setDescription('');
    setAmount('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setError(null);
    setSaving(false);
  }

  useEffect(() => {
    if (!open) {
      setProjectId('');
      setCategoryId('');
      setDescription('');
      setAmount('');
      setExpenseDate(new Date().toISOString().slice(0, 10));
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const isGeneral = projectId === GENERAL_SENTINEL;

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const amt = Number(amount);
    if (!categoryId) { setError('Category is required'); setSaving(false); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be positive'); setSaving(false); return; }
    if (!description.trim()) { setError('Description is required'); setSaving(false); return; }

    const r = await submitExpense({
      projectId: isGeneral || !projectId ? null : projectId,
      categoryId,
      description,
      amount: amt,
      expenseDate,
    });
    if (!r.success) { setError(r.error); setSaving(false); return; }

    setOpen(false);
    router.push(`/expenses/${r.data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>+ Add Expense</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Submit expense</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Project</Label>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select project or General</option>
              <option value={GENERAL_SENTINEL}>— General expense (no project) —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number ?? p.id.slice(0, 8)} · {p.customer_name ?? ''}</option>
              ))}
            </Select>
            {isGeneral && (
              <p className="text-xs text-blue-600 mt-1">
                General expenses are approved directly by the Founder (no PM verification stage).
              </p>
            )}
          </div>
          <div>
            <Label>Category *</Label>
            <Select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </div>
          <div>
            <Label>Description *</Label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isGeneral ? 'Describe the expense and business purpose (since there is no project context)' : ''}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (INR) *</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Expense date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-yellow-700">
            Tip: Attach receipt documents after submission on the expense detail page.
          </p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
