'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { toggleCategoryActive } from '@/lib/expense-categories-actions';
import { EditCategoryDialog } from './edit-category-dialog';

interface Row { id: string; code: string; label: string; is_active: boolean; sort_order: number }

export function CategoryAdminTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  async function toggle(id: string, next: boolean) {
    await toggleCategoryActive(id, next);
    router.refresh();
  }

  return (
    <table className="w-full text-sm border rounded">
      <thead className="bg-gray-50 text-xs uppercase">
        <tr>
          <th className="px-3 py-2 text-left">Label</th>
          <th className="px-3 py-2 text-left">Code</th>
          <th className="px-3 py-2 text-left">Active</th>
          <th className="px-3 py-2 text-left">Sort</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="px-3 py-2">{r.label}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
            <td className="px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(r.id, !r.is_active)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${r.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </td>
            <td className="px-3 py-2 font-mono text-xs">{r.sort_order}</td>
            <td className="px-3 py-2 text-right">
              <EditCategoryDialog id={r.id} initial={{ label: r.label, sort_order: r.sort_order }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
