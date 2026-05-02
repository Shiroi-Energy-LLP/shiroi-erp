'use client';

import { useState } from 'react';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import { FileText, AlertTriangle, Ban, Pause } from 'lucide-react';
import type { OrphanCounts, OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import { CustomerListPane } from './customer-list-pane';
import { InvoicesPane } from './invoices-pane';
import { CandidatesPane } from './candidates-pane';
import { AuditLogTable } from './audit-log-table';
import { TriageProvider } from './triage-context';
import { DeferredTab } from './deferred-tab';
import { ExcludedTab } from './excluded-tab';

interface Props {
  counts: OrphanCounts;
  customers: OrphanCustomerSummary[];
  activeTab: 'active' | 'deferred' | 'excluded' | 'audit';
  selectedCustomer: string | null;
}

export function TriageShell({ counts, customers, activeTab, selectedCustomer }: Props) {
  const [selected, setSelected] = useState<string | null>(
    selectedCustomer ?? customers[0]?.zoho_customer_name ?? null,
  );

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<FileText className="h-5 w-5 text-amber-600" />}
          bg="bg-amber-100"
          count={counts.pendingInvoiceCount}
          total={counts.pendingInvoiceTotal}
          label="Pending Invoices"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
          bg="bg-orange-100"
          count={counts.pendingPaymentCount}
          total={counts.pendingPaymentTotal}
          label="Pending Payments"
        />
        <KpiCard
          icon={<Ban className="h-5 w-5 text-red-600" />}
          bg="bg-red-100"
          count={counts.excludedCount}
          total={counts.excludedTotal}
          label="Excluded (No ERP Match)"
        />
        <KpiCard
          icon={<Pause className="h-5 w-5 text-gray-600" />}
          bg="bg-gray-100"
          count={counts.deferredCount}
          total={null}
          label="Deferred"
        />
      </div>

      <Tabs defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="deferred">Deferred</TabsTrigger>
          <TabsTrigger value="excluded">Excluded</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {customers.length === 0 ? (
            <EmptyDone />
          ) : (
            <TriageProvider>
              <div className="grid gap-4" style={{ gridTemplateColumns: '260px 1fr 320px' }}>
                <CustomerListPane
                  customers={customers}
                  selected={selected}
                  onSelect={setSelected}
                />
                <InvoicesPane zohoCustomerName={selected} />
                <CandidatesPane zohoCustomerName={selected} />
              </div>
            </TriageProvider>
          )}
        </TabsContent>

        <TabsContent value="deferred">
          <DeferredTab />
        </TabsContent>

        <TabsContent value="excluded">
          <ExcludedTab />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  icon, bg, count, total, label,
}: {
  icon: React.ReactNode;
  bg: string;
  count: number;
  total: string | null;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1D24]">{count}</p>
            {total !== null && (
              <p className="text-xs text-[#7C818E]">{shortINR(Number(total))}</p>
            )}
            <p className="text-xs text-[#7C818E]">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyDone() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <p className="text-2xl">All Zoho imports attributed.</p>
        <p className="text-sm text-[#7C818E] mt-2">Check the Audit log tab for the decision history.</p>
      </CardContent>
    </Card>
  );
}

