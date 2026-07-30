import { Suspense } from 'react';
import Link from 'next/link';
import {
  listExpenses,
  getExpenseKPIs,
  getExpenseFilteredTotals,
  listSubmitterOptions,
  listExpenseProjectOptions,
  type ListExpensesFilters,
} from '@/lib/expenses-queries';
import { getActiveCategories } from '@/lib/expense-categories-queries';
import { getSessionContext } from '@/lib/auth';
import { canSubmitOnBehalf, EXPENSE_STATUSES, EXPENSE_SCOPES } from '@/lib/expenses-constants';
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
    project?: string;
    page?: string;
  }>;
}

export default async function ExpensesPage({ searchParams }: Props) {
  const params = await searchParams;

  type StatusType = typeof EXPENSE_STATUSES[number];
  const statusParam = EXPENSE_STATUSES.includes(params.status as StatusType)
    ? (params.status as StatusType)
    : undefined;

  type ScopeType = typeof EXPENSE_SCOPES[number];
  const scopeParam = EXPENSE_SCOPES.includes(params.scope as ScopeType)
    ? (params.scope as ScopeType)
    : 'all';

  const filters: ListExpensesFilters = {
    search: params.search,
    scope: scopeParam,
    status: statusParam,
    categoryId: params.category,
    submittedBy: params.submitter,
    projectId: params.project,
    page: params.page ? parseInt(params.page, 10) : 1,
  };

  // The filtered KPI is only interesting once something narrows the list.
  const hasFilters = Boolean(
    params.search || params.project || params.category || params.submitter
    || params.status || (params.scope && params.scope !== 'all'),
  );

  const [kpis, filteredTotals, { rows }, categories, submitters, projectOpts, session] =
    await Promise.all([
      getExpenseKPIs(),
      getExpenseFilteredTotals(filters),
      listExpenses(filters),
      getActiveCategories(),
      listSubmitterOptions(),
      listExpenseProjectOptions(),
      getSessionContext(),
    ]);

  const categoryOpts = categories.map((c) => ({ id: c.id, label: c.label }));
  const currentPage = Math.max(1, filters.page ?? 1);
  const pageSize = 25; // listExpenses default
  // The RPC count is exact, so page bounds are trustworthy (the list's own
  // count is `estimated` per NEVER-DO #13).
  const lastPage = Math.max(1, Math.ceil(filteredTotals.count / pageSize));
  const firstRow = filteredTotals.count === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = (currentPage - 1) * pageSize + rows.length;

  function pageHref(target: number): string {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'page' && value) p.set(key, value);
    }
    if (target > 1) p.set('page', String(target));
    const qs = p.toString();
    return qs ? `/expenses?${qs}` : '/expenses';
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500">Vouchers</div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
        </div>
        <AddExpenseDialog
          projects={projectOpts}
          categories={categoryOpts}
          submitters={submitters}
          canSubmitOnBehalf={canSubmitOnBehalf(session.role)}
        />
      </div>

      <ExpenseKPIs kpis={kpis} filtered={filteredTotals} hasFilters={hasFilters} />
      <Suspense>
        <ExpenseFilters
          categories={categoryOpts}
          submitters={submitters}
          projects={projectOpts}
        />
      </Suspense>
      <Suspense>
        <ExpenseTable rows={rows} />
      </Suspense>

      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
        <div>
          Showing {firstRow}–{lastRow} of {filteredTotals.count} · Page {currentPage} of {lastPage}
        </div>
        <div className="flex gap-2">
          {currentPage > 1 && (
            <Link href={pageHref(currentPage - 1)} className="text-blue-600 hover:underline">
              ← Previous
            </Link>
          )}
          {currentPage < lastPage && (
            <Link href={pageHref(currentPage + 1)} className="text-blue-600 hover:underline">
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
