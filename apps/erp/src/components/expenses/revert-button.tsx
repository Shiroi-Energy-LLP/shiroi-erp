'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { revertExpense } from '@/lib/expenses-actions';

export function RevertButton({ id, target }: { id: string; target: 'submitted' | 'verified' }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    if (!confirm(`Revert to ${target}?`)) return;
    setSaving(true);
    const r = await revertExpense(id, target);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button variant="outline" onClick={handle} disabled={saving}>Revert to {target}</Button>;
}
