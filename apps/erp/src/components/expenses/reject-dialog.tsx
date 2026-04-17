'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Label } from '@repo/ui';
import { rejectExpense } from '@/lib/expenses-actions';

export function RejectDialog({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setSaving(true);
    setError(null);
    const r = await rejectExpense(id, reason);
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setReason(''); setError(null); } }}>
      <DialogTrigger asChild><Button variant="destructive">Reject</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject expense</DialogTitle></DialogHeader>
        <div>
          <Label>Reason *</Label>
          <textarea className="w-full border rounded p-2 text-sm" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={handle} disabled={saving || !reason.trim()}>
            {saving ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
