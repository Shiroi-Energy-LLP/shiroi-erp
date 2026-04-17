'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from '@repo/ui';
import { updateCategory } from '@/lib/expense-categories-actions';

export function EditCategoryDialog({ id, initial }: { id: string; initial: { label: string; sort_order: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState(initial.label);
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order));

  async function handle() {
    setSaving(true);
    const r = await updateCategory(id, { label, sort_order: Number(sortOrder) });
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><Label>Sort order</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
