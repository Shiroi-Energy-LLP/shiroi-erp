import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { createClient } from '@repo/supabase/server';
import { getProjectSiteExpenses } from '@/lib/site-expenses-actions';
import { SiteExpenseForm } from '@/components/projects/forms/site-expense-form';
import { ActualsLockButton, EditableQtyCell } from '@/components/projects/forms/actuals-controls';
import { FileText, Receipt, TrendingUp, Lock, AlertTriangle } from 'lucide-react';

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
        'id, item_category, item_description, brand, model, quantity, unit, unit_price, total_price, gst_rate, procurement_status, received_qty, dispatched_qty',
      )
      .eq('project_id', projectId)
      .order('line_number', { ascending: true }),
    supabase
      .from('projects')
      .select('contracted_value, project_number, customer_name, actuals_locked, actuals_locked_at, actuals_locked_by')
      .eq('id', projectId)
      .maybeSingle(),
    getProjectSiteExpenses(projectId),
  ]);

  const items = (boqItems as any[]) ?? [];
  const projectData = project as any;
  const contractedValue = Number(projectData?.contracted_value ?? 0);
  const isLocked = !!projectData?.actuals_locked;

  // Get locked-by employee name if locked
  let lockedByName: string | null = null;
  if (isLocked && projectData?.actuals_locked_by) {
    const { data: emp } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', projectData.actuals_locked_by)
      .single();
    lockedByName = (emp as any)?.full_name ?? null;
  }

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
      {/* Lock status banner */}
      {isLocked && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          <Lock className="h-4 w-4 text-green-600" />
          <span className="text-xs text-green-800 font-medium">
            Project Actuals are LOCKED — BOI, BOQ, and Actuals are read-only.
          </span>
        </div>
      )}

      {/* Lock / Unlock control */}
      <div className="flex items-center justify-between">
        <ActualsLockButton
          projectId={projectId}
          isLocked={isLocked}
          lockedByName={lockedByName}
          lockedAt={projectData?.actuals_locked_at}
        />
        {pendingExpenses.length > 0 && !isLocked && (
          <div className="flex items-center gap-1.5 text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs">{pendingExpenses.length} pending vouchers — review before locking</span>
          </div>
        )}
      </div>

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

      {/* BOQ items with editable quantities */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              BOQ Items {isLocked ? '(Locked)' : '(Qty editable by PM)'}
            </CardTitle>
            {!isLocked && (
              <span className="text-[10px] text-n-400">Click any quantity to edit (e.g., for returned materials)</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-sm text-n-500 text-center">
              No BOQ items yet. Items flow in automatically once BOQ is built.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Category</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Description</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Brand / Model</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">Qty</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">Rate</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id} className="border-b border-n-100 last:border-b-0">
                      <td className="px-3 py-1.5 text-n-500 capitalize">
                        {(item.item_category ?? '').replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-1.5 text-n-900">{item.item_description}</td>
                      <td className="px-3 py-1.5 text-n-500">
                        {[item.brand, item.model].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <EditableQtyCell
                          projectId={projectId}
                          itemId={item.id}
                          quantity={Number(item.quantity ?? 0)}
                          unit={item.unit ?? ''}
                          isLocked={isLocked}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {formatINR(Number(item.unit_price ?? 0))}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium">
                        {formatINR(Number(item.total_price ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-n-50 border-t border-n-300">
                    <td colSpan={5} className="px-3 py-1.5 text-right text-[10px] font-medium text-n-700">
                      BOQ Total
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-n-900">
                      {formatINR(boqTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voucher entry form (only when not locked) */}
      {!isLocked && <SiteExpenseForm projectId={projectId} />}

      {/* Voucher history */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Site Expense Vouchers {isLocked ? '(Locked)' : ''}
            </CardTitle>
            {pendingExpenses.length > 0 && (
              <span className="text-xs text-amber-700">
                {pendingExpenses.length} pending · {formatINR(pendingExpensesTotal)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {siteExpenses.length === 0 ? (
            <div className="px-6 py-10 text-[11px] text-n-500 text-center">
              No vouchers submitted yet. Use the form above to add travel, food, lodging, and
              other site expenses.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Date</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Category</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Description</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Submitted By</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">Amount</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {siteExpenses.map((e) => (
                    <tr key={e.id} className="border-b border-n-100 last:border-b-0">
                      <td className="px-3 py-1.5 text-n-500">
                        {e.expense_date ? formatDate(e.expense_date) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-n-500">
                        {CATEGORY_LABELS[e.expense_category ?? ''] ?? e.expense_category ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-n-900">{e.description ?? '—'}</td>
                      <td className="px-3 py-1.5 text-n-500">{e.submitted_by_name ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatINR(e.amount)}</td>
                      <td className="px-3 py-1.5">{statusBadge(e.status)}</td>
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
          <div className="text-[10px] text-n-500">{label}</div>
          {icon}
        </div>
        <div className={`text-xl font-mono font-semibold ${highlight ?? 'text-n-900'}`}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-n-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
