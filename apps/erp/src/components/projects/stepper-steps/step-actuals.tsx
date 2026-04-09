import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { createClient } from '@repo/supabase/server';
import { getProjectSiteExpenses } from '@/lib/site-expenses-actions';
import { SiteExpenseForm } from '@/components/projects/forms/site-expense-form';
import { FileText, Receipt, TrendingUp } from 'lucide-react';

interface StepActualsProps {
  projectId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  travel: 'Travel',
  food: 'Food',
  lodging: 'Lodging',
  site_material: 'Site Material',
  tools: 'Tools',
  consumables: 'Consumables',
  labour_advance: 'Labour Advance',
  miscellaneous: 'Miscellaneous',
};

function statusBadge(status: string | null) {
  switch (status) {
    case 'approved':
    case 'auto_approved':
      return <Badge variant="success">Approved</Badge>;
    case 'pending':
      return <Badge variant="warning">Pending</Badge>;
    case 'rejected':
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge>{status ?? '—'}</Badge>;
  }
}

export async function StepActuals({ projectId }: StepActualsProps) {
  const supabase = await createClient();

  const [{ data: boqItems }, { data: project }, siteExpenses] = await Promise.all([
    supabase
      .from('project_boq_items')
      .select(
        'id, item_category, item_description, brand, model, quantity, unit, unit_price, total_price, procurement_status, received_qty, dispatched_qty',
      )
      .eq('project_id', projectId)
      .order('line_number', { ascending: true }),
    supabase
      .from('projects')
      .select('contracted_value, project_number, customer_name')
      .eq('id', projectId)
      .maybeSingle(),
    getProjectSiteExpenses(projectId),
  ]);

  const items = (boqItems as any[]) ?? [];
  const contractedValue = Number((project as any)?.contracted_value ?? 0);

  const boqTotal = items.reduce((sum, item: any) => {
    const lineTotal =
      typeof item.total_price === 'number'
        ? item.total_price
        : Number(item.quantity ?? 0) * Number(item.unit_price ?? 0);
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0);

  const approvedExpenses = siteExpenses.filter(
    (e) => e.status === 'approved' || e.status === 'auto_approved',
  );
  const pendingExpenses = siteExpenses.filter((e) => e.status === 'pending');

  const approvedExpensesTotal = approvedExpenses.reduce((s, e) => s + e.amount, 0);
  const pendingExpensesTotal = pendingExpenses.reduce((s, e) => s + e.amount, 0);

  const actualsTotal = boqTotal + approvedExpensesTotal;
  const marginAmount = contractedValue - actualsTotal;
  const marginPct = contractedValue > 0 ? (marginAmount / contractedValue) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="BOQ Total"
          value={formatINR(boqTotal)}
          sub={`${items.length} lines`}
          icon={<FileText className="h-4 w-4 text-n-500" />}
        />
        <KpiCard
          label="Site Expenses (approved)"
          value={formatINR(approvedExpensesTotal)}
          sub={`${approvedExpenses.length} vouchers`}
          icon={<Receipt className="h-4 w-4 text-n-500" />}
        />
        <KpiCard
          label="Actuals Total"
          value={formatINR(actualsTotal)}
          sub="BOQ + approved vouchers"
          icon={<TrendingUp className="h-4 w-4 text-n-500" />}
        />
        <KpiCard
          label="Margin"
          value={formatINR(marginAmount)}
          sub={`${marginPct.toFixed(1)}%`}
          highlight={
            marginPct >= 15
              ? 'text-green-700'
              : marginPct >= 5
                ? 'text-amber-700'
                : 'text-red-700'
          }
        />
      </div>

      {/* BOQ items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">BOQ Items (auto-populated)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-sm text-n-500 text-center">
              No BOQ items yet. Items flow in automatically once BOQ is built.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Category
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Description
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Brand / Model
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Rate</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id} className="border-b border-n-100 last:border-b-0">
                      <td className="px-3 py-2 text-xs text-n-500 capitalize">
                        {(item.item_category ?? '').replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-2 text-n-900">{item.item_description}</td>
                      <td className="px-3 py-2 text-xs text-n-500">
                        {[item.brand, item.model].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {Number(item.quantity ?? 0)} {item.unit ?? ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatINR(Number(item.unit_price ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">
                        {formatINR(Number(item.total_price ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-n-50 border-t border-n-300">
                    <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium text-n-700">
                      BOQ Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-n-900">
                      {formatINR(boqTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voucher entry form */}
      <SiteExpenseForm projectId={projectId} />

      {/* Voucher history */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Site Expense Vouchers</CardTitle>
            {pendingExpenses.length > 0 && (
              <span className="text-xs text-amber-700">
                {pendingExpenses.length} pending · {formatINR(pendingExpensesTotal)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {siteExpenses.length === 0 ? (
            <div className="px-6 py-10 text-sm text-n-500 text-center">
              No vouchers submitted yet. Use the form above to add travel, food, lodging, and
              other site expenses.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Category
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Description
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">
                      Submitted By
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">
                      Amount
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {siteExpenses.map((e) => (
                    <tr key={e.id} className="border-b border-n-100 last:border-b-0">
                      <td className="px-3 py-2 text-xs text-n-500">
                        {e.expense_date ? formatDate(e.expense_date) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-n-500">
                        {CATEGORY_LABELS[e.expense_category ?? ''] ?? e.expense_category ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-n-900">{e.description ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-n-500">
                        {e.submitted_by_name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatINR(e.amount)}</td>
                      <td className="px-3 py-2">{statusBadge(e.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  highlight?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-n-500">{label}</div>
          {icon}
        </div>
        <div className={`text-xl font-mono font-semibold ${highlight ?? 'text-n-900'}`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-n-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
