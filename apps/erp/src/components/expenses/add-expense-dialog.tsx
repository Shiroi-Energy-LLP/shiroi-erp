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
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt { id: string; project_number: string | null; customer_name: string | null }
interface CategoryOpt { id: string; label: string }

export function AddExpenseDialog({
  projects,
  categories,
  defaultProjectId,
  lockProject = false,
}: {
  projects: ProjectOpt[];
  categories: CategoryOpt[];
  /** Pre-select this project (e.g. when opened from a project detail page). */
  defaultProjectId?: string;
  /** Lock the picker to defaultProjectId — no General option, no re-pick. */
  lockProject?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '');
  const [isGeneral, setIsGeneral] = useState(false);
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!open) {
      setProjectId(defaultProjectId ?? '');
      setIsGeneral(false);
      setCategoryId('');
      setDescription('');
      setAmount('');
      setExpenseDate(new Date().toISOString().slice(0, 10));
      setError(null);
      setSaving(false);
    }
  }, [open, defaultProjectId]);

  // ProjectCombobox requires customer_name: string — fall back to number/id.
  const comboboxProjects = projects.map((p) => ({
    id: p.id,
    project_number: p.project_number,
    customer_name: p.customer_name ?? p.project_number ?? p.id.slice(0, 8),
  }));
  const lockedProject = lockProject
    ? projects.find((p) => p.id === defaultProjectId) ?? null
    : null;

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const amt = Number(amount);
    if (!categoryId) { setError('Category is required'); setSaving(false); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be positive'); setSaving(false); return; }
    if (!description.trim()) { setError('Description is required'); setSaving(false); return; }
    if (!lockProject && !isGeneral && !projectId) {
      setError('Pick a project, or tick "General expense"'); setSaving(false); return;
    }

    const r = await submitExpense({
      projectId: isGeneral ? null : (projectId || null),
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
            {lockProject ? (
              <div className="border border-n-200 rounded-md bg-n-50 px-3 py-2 text-sm text-n-700">
                {(lockedProject?.project_number ?? '') + ' · ' + (lockedProject?.customer_name ?? '')}
              </div>
            ) : (
              <>
                <ProjectCombobox
                  projects={comboboxProjects}
                  value={isGeneral ? '' : projectId}
                  onChange={(id) => { setProjectId(id); if (id) setIsGeneral(false); }}
                  placeholder="Type to search by customer or project number…"
                />
                <label className="flex items-center gap-2 mt-2 text-xs text-n-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isGeneral}
                    onChange={(e) => { setIsGeneral(e.target.checked); if (e.target.checked) setProjectId(''); }}
                  />
                  General expense (no project)
                </label>
                {isGeneral && (
                  <p className="text-xs text-blue-600 mt-1">
                    General expenses are approved directly by the Founder (no PM verification stage).
                  </p>
                )}
              </>
            )}
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
