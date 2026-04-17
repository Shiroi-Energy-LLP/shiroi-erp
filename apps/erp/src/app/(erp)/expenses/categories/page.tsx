import { redirect } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { listCategories } from '@/lib/expense-categories-queries';
import { CategoryAdminTable } from '@/components/expenses/category-admin-table';
import { AddCategoryDialog } from '@/components/expenses/add-category-dialog';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  if (!['founder', 'finance'].includes(profile?.role ?? '')) {
    redirect('/expenses');
  }

  const cats = await listCategories({ includeInactive: true });
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Expense categories</h1>
        <AddCategoryDialog />
      </div>
      <CategoryAdminTable
        rows={cats.map((c) => ({ id: c.id, code: c.code, label: c.label, is_active: c.is_active, sort_order: c.sort_order }))}
      />
    </div>
  );
}
