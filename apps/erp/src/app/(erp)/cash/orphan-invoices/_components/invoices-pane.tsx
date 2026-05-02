'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Skeleton } from '@repo/ui';
import { InvoiceCard } from './invoice-card';
import { AssignModal } from './assign-modal';
import { ExcludeModal } from './exclude-modal';
import { DeferModal } from './defer-modal';
import { getOrphansForCustomerClient } from './_client-fetchers';
import { formatINR, formatDate } from '@repo/ui/formatters';
import type { OrphanInvoiceWithLineItems } from '@/lib/orphan-triage-queries';
import type { Database } from '@repo/types/database';

type CustomerPayment = Database['public']['Tables']['customer_payments']['Row'];

interface Props {
  zohoCustomerName: string | null;
}

interface Bundle {
  invoices: OrphanInvoiceWithLineItems[];
  orphan_payments_no_invoice: CustomerPayment[];
}

type AssignableEntity =
  | { kind: 'invoice'; id: string; total: string; number: string }
  | { kind: 'payment'; id: string; total: string; ref: string };

type DeferableEntity =
  | { kind: 'invoice'; id: string; number: string }
  | { kind: 'payment'; id: string; ref: string };

type ModalState =
  | { type: 'assign'; entity: AssignableEntity }
  | { type: 'exclude'; entity: AssignableEntity }
  | { type: 'defer'; entity: DeferableEntity }
  | null;

export function InvoicesPane({ zohoCustomerName }: Props) {
  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    if (!zohoCustomerName) {
      setBundle(null);
      return;
    }
    setLoading(true);
    getOrphansForCustomerClient(zohoCustomerName).then((b) => {
      setBundle(b);
      setLoading(false);
    });
  }, [zohoCustomerName]);

  const refresh = () => {
    setModal(null);
    if (zohoCustomerName) {
      getOrphansForCustomerClient(zohoCustomerName).then(setBundle);
    }
    router.refresh();
  };

  if (!zohoCustomerName) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[#7C818E]">
          Select a customer on the left to start triage.
        </CardContent>
      </Card>
    );
  }

  if (loading || !bundle) {
    return <Skeleton className="h-[500px]" />;
  }

  return (
    <div className="space-y-3" style={{ height: '70vh', overflowY: 'auto' }}>
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            Invoices ({bundle.invoices.length})
          </TabsTrigger>
          <TabsTrigger value="advances">
            Advance payments ({bundle.orphan_payments_no_invoice.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-3">
          {bundle.invoices.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#7C818E]">
                No pending invoices for this customer.
              </CardContent>
            </Card>
          ) : (
            bundle.invoices.map((b) => (
              <InvoiceCard
                key={b.invoice.id}
                data={b}
                selected={b.invoice.id === selectedInvoiceId}
                onSelect={() => setSelectedInvoiceId(b.invoice.id)}
                onAssign={() =>
                  setModal({
                    type: 'assign',
                    entity: {
                      kind: 'invoice',
                      id: b.invoice.id,
                      total: String(b.invoice.total_amount),
                      number: b.invoice.invoice_number,
                    },
                  })
                }
                onExclude={() =>
                  setModal({
                    type: 'exclude',
                    entity: {
                      kind: 'invoice',
                      id: b.invoice.id,
                      total: String(b.invoice.total_amount),
                      number: b.invoice.invoice_number,
                    },
                  })
                }
                onDefer={() =>
                  setModal({
                    type: 'defer',
                    entity: {
                      kind: 'invoice',
                      id: b.invoice.id,
                      number: b.invoice.invoice_number,
                    },
                  })
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="advances" className="space-y-2">
          {bundle.orphan_payments_no_invoice.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#7C818E]">
                No advance payments.
              </CardContent>
            </Card>
          ) : (
            bundle.orphan_payments_no_invoice.map((p) => (
              <Card key={p.id}>
                <CardContent className="p-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold">{p.receipt_number}</p>
                    <p className="text-xs text-[#7C818E]">
                      {formatDate(p.payment_date)} · {p.payment_method ?? '—'} ·{' '}
                      {formatINR(Number(p.amount))}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 bg-amber-100 rounded"
                      onClick={() =>
                        setModal({
                          type: 'assign',
                          entity: {
                            kind: 'payment',
                            id: p.id,
                            total: String(p.amount),
                            ref: p.receipt_number,
                          },
                        })
                      }
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 bg-red-100 rounded"
                      onClick={() =>
                        setModal({
                          type: 'exclude',
                          entity: {
                            kind: 'payment',
                            id: p.id,
                            total: String(p.amount),
                            ref: p.receipt_number,
                          },
                        })
                      }
                    >
                      No match
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 bg-gray-100 rounded"
                      onClick={() =>
                        setModal({
                          type: 'defer',
                          entity: { kind: 'payment', id: p.id, ref: p.receipt_number },
                        })
                      }
                    >
                      Defer
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {modal?.type === 'assign' && (
        <AssignModal
          open
          onClose={() => setModal(null)}
          entity={modal.entity}
          project={null /* Task 18 wires this from selected-project context */}
          onSuccess={refresh}
        />
      )}
      {modal?.type === 'exclude' && (
        <ExcludeModal
          open
          onClose={() => setModal(null)}
          entity={modal.entity}
          onSuccess={refresh}
        />
      )}
      {modal?.type === 'defer' && (
        <DeferModal
          open
          onClose={() => setModal(null)}
          entity={modal.entity}
          onSuccess={refresh}
        />
      )}
    </div>
  );
}
