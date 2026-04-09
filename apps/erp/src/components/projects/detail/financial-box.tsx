import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { EditableField } from './editable-field';
import { Lock } from 'lucide-react';

interface FinancialBoxProps {
  projectId: string;
  contractedValue: number;
  actualExpenses: number;
  boqTotal: number;
  siteExpensesTotal: number;
  marginAmount: number;
  marginPct: number;
  /** The caller's role — determines whether this box is rendered at all */
  viewerRole: string | null;
}

const ALLOWED_ROLES = new Set<string>([
  'founder',
  'project_manager',
  'finance',
  'sales_engineer', // marketing manager proxy until the DB role is added
]);

const EDIT_ALLOWED_ROLES = new Set<string>(['founder', 'finance']);

export function FinancialBox({
  projectId,
  contractedValue,
  actualExpenses,
  boqTotal,
  siteExpensesTotal,
  marginAmount,
  marginPct,
  viewerRole,
}: FinancialBoxProps) {
  if (!viewerRole || !ALLOWED_ROLES.has(viewerRole)) {
    return null;
  }

  const canEditOrder = EDIT_ALLOWED_ROLES.has(viewerRole);
  const marginColor =
    marginPct >= 15 ? 'text-green-700' : marginPct >= 5 ? 'text-amber-700' : 'text-red-700';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Financial</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-n-500">
            Role: {viewerRole.replace(/_/g, ' ')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Order value — from proposal; PM-editable with approval note */}
        <div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-n-500">Order Value (from final proposal)</div>
            {!canEditOrder && (
              <div className="flex items-center gap-1 text-[10px] text-n-500">
                <Lock className="h-3 w-3" /> PM approval required
              </div>
            )}
          </div>
          <div className="mt-1">
            {canEditOrder ? (
              <EditableField
                projectId={projectId}
                field="contracted_value"
                value={contractedValue}
                type="number"
                valueClassName="text-lg font-mono font-semibold text-n-900"
                render={(v) => (
                  <span className="text-lg font-mono font-semibold text-n-900">
                    {formatINR(Number(v ?? 0))}
                  </span>
                )}
              />
            ) : (
              <div className="text-lg font-mono font-semibold text-n-900">
                {formatINR(contractedValue)}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Actual expenses breakdown */}
        <div className="space-y-2">
          <div className="text-xs text-n-500">Actual Expenses (from BOQ + vouchers)</div>
          <div className="text-lg font-mono font-semibold text-n-900">
            {formatINR(actualExpenses)}
          </div>
          <div className="flex justify-between text-xs text-n-500">
            <span>BOQ items</span>
            <span className="font-mono">{formatINR(boqTotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-n-500">
            <span>Site vouchers</span>
            <span className="font-mono">{formatINR(siteExpensesTotal)}</span>
          </div>
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Margin */}
        <div>
          <div className="text-xs text-n-500">Projected Margin</div>
          <div className={`text-lg font-mono font-semibold ${marginColor}`}>
            {formatINR(marginAmount)}{' '}
            <span className="text-sm">({marginPct.toFixed(1)}%)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
