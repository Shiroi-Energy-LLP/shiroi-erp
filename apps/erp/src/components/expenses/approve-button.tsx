'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { approveExpense } from '@/lib/expenses-actions';

export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    const r = await approveExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button variant="default" onClick={handle} disabled={saving}>{saving ? 'Approving…' : 'Approve'}</Button>;
}
