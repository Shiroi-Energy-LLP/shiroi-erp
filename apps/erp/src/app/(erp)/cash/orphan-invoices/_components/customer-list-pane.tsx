// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/customer-list-pane.tsx
'use client';

import { useState, useMemo } from 'react';
import { Input } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import type { OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import Decimal from 'decimal.js';

interface Props {
  customers: OrphanCustomerSummary[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function CustomerListPane({ customers, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter((c) => c.zoho_customer_name.toLowerCase().includes(s));
  }, [customers, search]);

  return (
    <div className="border rounded-lg bg-white overflow-hidden flex flex-col" style={{ height: '70vh' }}>
      <div className="p-3 border-b">
        <Input
          placeholder="Search Zoho customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 text-xs text-[#7C818E]">No matching customers.</p>
        ) : (
          filtered.map((c) => {
            const total = new Decimal(c.invoice_total).plus(new Decimal(c.payment_total));
            const isSelected = c.zoho_customer_name === selected;
            return (
              <button
                key={c.zoho_customer_name}
                type="button"
                onClick={() => onSelect(c.zoho_customer_name)}
                className={`w-full text-left p-3 border-b hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
                }`}
              >
                <p className="text-xs font-bold text-[#1A1D24] truncate">{c.zoho_customer_name}</p>
                <p className="text-[10px] text-[#7C818E] mt-0.5">
                  {c.invoice_count} invoices · {shortINR(total.toNumber())}
                </p>
                <p className="text-[10px] text-[#7C818E]">
                  {c.candidate_project_count} ERP candidates
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
