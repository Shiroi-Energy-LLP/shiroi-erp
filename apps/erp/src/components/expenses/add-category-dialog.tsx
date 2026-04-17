'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from '@repo/ui';
import { addCategory } from '@/lib/expense-categories-actions';

export function AddCategoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('999');

  async function handle() {
    setSaving(true); setError(null);
    const r = await addCategory({ code, label, sort_order: Number(sortOrder) });
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    setCode(''); setLabel(''); setSortOrder('999');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>+ Add category</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add expense category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>Code * (lowercase_snake)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Label>Sort order</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
