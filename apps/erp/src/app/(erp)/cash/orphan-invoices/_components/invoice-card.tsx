'use client';

import { Card, CardContent, Badge, Button } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { LineItemsTable } from './line-items-table';
import type { OrphanInvoiceWithLineItems } from '@/lib/orphan-triage-queries';

interface Props {
  data: OrphanInvoiceWithLineItems;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onExclude: () => void;
  onDefer: () => void;
}

export function InvoiceCard({ data, selected, onSelect, onAssign, onExclude, onDefer }: Props) {
  const { invoice, line_items, linked_payments } = data;
  return (
    <Card
      className={`cursor-pointer transition-shadow ${selected ? 'ring-2 ring-amber-500' : 'hover:shadow-md'}`}
      onClick={onSelect}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <p className="text-sm font-bold">{invoice.invoice_number}</p>
            <p className="text-xs text-[#7C818E]">{formatDate(invoice.invoice_date)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-mono font-bold">{formatINR(Number(invoice.total_amount))}</p>
            <Badge variant="outline" className="text-[10px]">
              {invoice.status ?? 'unknown'}
            </Badge>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Line items</p>
          <LineItemsTable items={line_items} />
        </div>

        {invoice.notes && (
          <div>
            <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Notes</p>
            <p className="text-xs italic">{invoice.notes}</p>
          </div>
        )}

        {linked_payments.length > 0 && (
          <div>
            <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Linked payments</p>
            <div className="space-y-1">
              {linked_payments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span>{formatDate(p.payment_date)} · {p.payment_method ?? '—'}</span>
                  <span className="font-mono">{formatINR(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={onAssign}>Assign to project</Button>
          <Button size="sm" variant="outline" onClick={onExclude}>No ERP match</Button>
          <Button size="sm" variant="ghost" onClick={onDefer}>Defer</Button>
        </div>
      </CardContent>
    </Card>
  );
}
