import { Suspense } from 'react';
import { createClient } from '@repo/supabase/server';
import { listExpenses, getExpenseKPIs, type ListExpensesFilters } from '@/lib/expenses-queries';
import { getActiveCategories } from '@/lib/expense-categories-queries';
import { ExpenseKPIs } from '@/components/expenses/expense-kpis';
import { ExpenseFilters } from '@/components/expenses/expense-filters';
import { ExpenseTable } from '@/components/expenses/expense-table';
import { AddExpenseDialog } from '@/components/expenses/add-expense-dialog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    search?: string;
    scope?: string;
    status?: string;
    category?: string;
    submitter?: string;
    page?: string;
  }>;
}

export default async function ExpensesPage({ searchParams }: Props) {
  const params = await searchParams;

  const validStatuses = ['submitted', 'verified', 'approved', 'rejected'] as const;
  type StatusType = typeof validStatuses[number];
  const statusParam = validStatuses.includes(params.status as StatusType)
    ? (params.status as StatusType)
    : undefined;

  const validScopes = ['all', 'project', 'general'] as const;
  type ScopeType = typeof validScopes[number];
  const scopeParam = validScopes.includes(params.scope as ScopeType)
    ? (params.scope as ScopeType)
    : 'all';

  const filters: ListExpensesFilters = {
    search: params.search,
    scope: scopeParam,
    status: statusParam,
    categoryId: params.category,
    submittedBy: params.submitter,
    page: params.page ? parseInt(params.page, 10) : 1,
  };

  const supabase = await createClient();

  const [kpis, { rows, total }, categories] = await Promise.all([
    getExpenseKPIs(),
    listExpenses(filters),
    getActiveCategories(),
  ]);

  const { data: submittersData } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  const submitters = (submittersData ?? []).map((s) => ({ id: s.id, full_name: s.full_name ?? '' }));

  const { data: projectsData } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .order('created_at', { ascending: false })
    .limit(500);
  const projectOpts = (projectsData ?? []).map((p) => ({
    id: p.id, project_number: p.project_number, customer_name: p.customer_name,
  }));

  const currentPage = filters.page ?? 1;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500">Vouchers</div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
        </div>
        <AddExpenseDialog
          projects={projectOpts}
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        />
      </div>

      <ExpenseKPIs kpis={kpis} />
      <Suspense>
        <ExpenseFilters
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
          submitters={submitters}
        />
      </Suspense>
      <Suspense>
        <ExpenseTable rows={rows} />
      </Suspense>

      <div className="text-xs text-gray-500 mt-2">
        Showing {rows.length} of {total} · Page {currentPage}
      </div>
    </div>
  );
}
