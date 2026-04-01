'use client';

import Decimal from 'decimal.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { validatePaymentSchedule } from '@/lib/proposal-calc';

interface Milestone {
  id: string;
  milestone_order: number;
  milestone_name: string;
  percentage: number;
  amount: number;
  due_trigger: string;
  custom_trigger_description: string | null;
  invoice_type: string | null;
  notes: string | null;
}

export function PaymentSchedule({ milestones }: { milestones: Milestone[] }) {
  const sorted = [...milestones].sort((a, b) => a.milestone_order - b.milestone_order);
  const percentages = sorted.map(m => m.percentage);
  const { valid, sum } = validatePaymentSchedule(percentages);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Milestone</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Invoice Type</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No payment milestones defined.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {sorted.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground">{m.milestone_order}</TableCell>
                  <TableCell className="font-medium">{m.milestone_name}</TableCell>
                  <TableCell className="text-right font-mono">{m.percentage}%</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(m.amount)}</TableCell>
                  <TableCell className="text-sm">
                    {m.custom_trigger_description || m.due_trigger}
                  </TableCell>
                  <TableCell className="text-sm">{m.invoice_type ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.notes ?? '—'}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-medium">
                <TableCell />
                <TableCell>Total</TableCell>
                <TableCell className={`text-right font-mono ${valid ? 'text-[#065F46]' : 'text-[#991B1B]'}`}>
                  {sum}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatINR(sorted.reduce((s, m) => s.add(new Decimal(m.amount)), new Decimal(0)).toNumber())}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>

      {!valid && sorted.length > 0 && (
        <div className="rounded-md border border-[#FEF2F2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          Payment schedule must equal 100%. Current: {sum}%
        </div>
      )}
    </div>
  );
}
