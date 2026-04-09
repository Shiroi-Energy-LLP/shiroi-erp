import Link from 'next/link';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { formatDate, formatINR } from '@repo/ui/formatters';
import { Receipt } from 'lucide-react';
import { getPendingSiteExpenses } from '@/lib/site-expenses-actions';
import { VoucherActions } from '@/components/vouchers/voucher-actions';

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

export default async function VouchersPage() {
  const pending = await getPendingSiteExpenses();
  const totalAmount = pending.reduce((s, v) => s + v.amount, 0);

  // Group by project for a quick rollup
  const byProject = new Map<
    string,
    { project_number: string | null; customer_name: string | null; count: number; total: number }
  >();
  for (const v of pending) {
    const existing = byProject.get(v.project_id) ?? {
      project_number: v.project_number,
      customer_name: v.customer_name,
      count: 0,
      total: 0,
    };
    existing.count += 1;
    existing.total += v.amount;
    byProject.set(v.project_id, existing);
  }

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">APPROVALS</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Voucher Approvals</h1>
        <p className="text-sm text-n-500 mt-1">
          Site expense vouchers submitted by PMs and supervisors. Approve or reject to include
          them in actual project expenses.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-n-500 mb-1">Pending Vouchers</div>
            <div className="text-2xl font-bold text-n-900">{pending.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-n-500 mb-1">Pending Total</div>
            <div className="text-2xl font-mono font-bold text-n-900">{formatINR(totalAmount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-n-500 mb-1">Projects with Pending</div>
            <div className="text-2xl font-bold text-n-900">{byProject.size}</div>
          </CardContent>
        </Card>
      </div>

      {/* Queue */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right w-[200px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<Receipt className="h-12 w-12" />}
                      title="No pending vouchers"
                      description="When PMs or supervisors submit site expense vouchers, they will appear here for approval."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                pending.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${v.project_id}?tab=actuals`}
                        className="hover:underline"
                      >
                        <div className="font-mono text-xs text-n-900">
                          {v.project_number ?? '—'}
                        </div>
                        <div className="text-[11px] text-n-500">{v.customer_name ?? '—'}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-n-500">
                      {v.expense_date ? formatDate(v.expense_date) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-n-500">
                      {CATEGORY_LABELS[v.expense_category ?? ''] ?? v.expense_category ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-md truncate">
                      {v.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-n-500">
                      {v.submitted_by_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatINR(v.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <VoucherActions expenseId={v.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
