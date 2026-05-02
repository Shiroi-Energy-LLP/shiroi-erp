'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button, useToast } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { fetchByStatus } from './_client-fetchers';
import { undoDefer } from '@/lib/orphan-triage-actions';

interface DeferredInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string | number;
  zoho_customer_name: string | null;
}
interface DeferredPayment {
  id: string;
  receipt_number: string;
  payment_date: string;
  amount: string | number;
  zoho_customer_name: string | null;
}

export function DeferredTab() {
  const router = useRouter();
  const [data, setData] = useState<{ invoices: DeferredInvoice[]; payments: DeferredPayment[] } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  useEffect(() => {
    fetchByStatus('deferred').then((d) => setData(d as any));
  }, []);

  const handleUndo = (kind: 'invoice' | 'payment', id: string) => {
    startTransition(async () => {
      const r = await undoDefer(kind, id);
      if (!r.success) {
        addToast({ title: 'Undo failed', description: r.error, variant: 'destructive' });
        return;
      }
      addToast({ title: 'Restored to triage queue' });
      const fresh = await fetchByStatus('deferred');
      setData(fresh as any);
      router.refresh();
    });
  };

  if (!data) return <Card><CardContent className="py-8 text-[#7C818E]">Loading…</CardContent></Card>;
  const empty = data.invoices.length === 0 && data.payments.length === 0;
  if (empty) return <Card><CardContent className="py-12 text-center text-[#7C818E]">No deferred rows.</CardContent></Card>;

  return (
    <div className="space-y-6">
      {data.invoices.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.invoice_number}</TableCell>
                    <TableCell>{formatDate(i.invoice_date)}</TableCell>
                    <TableCell className="text-xs">{i.zoho_customer_name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(Number(i.total_amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleUndo('invoice', i.id)}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {data.payments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.receipt_number}</TableCell>
                    <TableCell>{formatDate(p.payment_date)}</TableCell>
                    <TableCell className="text-xs">{p.zoho_customer_name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(Number(p.amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleUndo('payment', p.id)}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
