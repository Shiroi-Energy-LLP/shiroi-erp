'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input, Select, Button } from '@repo/ui';

const STATUSES = ['submitted', 'verified', 'approved', 'rejected'] as const;

export function ExpenseFilters({
  categories,
  submitters,
}: {
  categories: { id: string; label: string }[];
  submitters: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(key: string, value: string | null) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`/expenses?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-end">
      <Input
        placeholder="Search voucher, description…"
        className="h-9 w-56"
        defaultValue={sp.get('search') ?? ''}
        onKeyDown={(e) => { if (e.key === 'Enter') update('search', (e.target as HTMLInputElement).value); }}
      />
      <div className="flex gap-1">
        {(['all', 'project', 'general'] as const).map((s) => {
          const active = (sp.get('scope') ?? 'all') === s;
          return (
            <Button
              key={s}
              size="sm"
              variant={active ? 'default' : 'outline'}
              onClick={() => update('scope', s === 'all' ? null : s)}
            >
              {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'General'}
            </Button>
          );
        })}
      </div>
      <Select
        className="h-9 w-36"
        value={sp.get('status') ?? ''}
        onChange={(e) => update('status', e.target.value || null)}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Select
        className="h-9 w-40"
        value={sp.get('category') ?? ''}
        onChange={(e) => update('category', e.target.value || null)}
      >
        <option value="">All categories</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select>
      <Select
        className="h-9 w-40"
        value={sp.get('submitter') ?? ''}
        onChange={(e) => update('submitter', e.target.value || null)}
      >
        <option value="">All submitters</option>
        {submitters.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </Select>
    </div>
  );
}
