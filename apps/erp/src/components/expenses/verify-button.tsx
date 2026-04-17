'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { verifyExpense } from '@/lib/expenses-actions';

export function VerifyButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    const r = await verifyExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button onClick={handle} disabled={saving}>{saving ? 'Verifying…' : 'Verify'}</Button>;
}
