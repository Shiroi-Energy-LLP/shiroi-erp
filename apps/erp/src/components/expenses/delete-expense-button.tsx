'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { deleteExpense } from '@/lib/expenses-actions';

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    if (!confirm('Delete this expense?')) return;
    setSaving(true);
    const r = await deleteExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.push('/expenses');
  }
  return <Button variant="outline" onClick={handle} disabled={saving}>Delete</Button>;
}
