'use client';
import type { OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
export function CustomerListPane(_props: {
  customers: OrphanCustomerSummary[];
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  return <div className="border rounded-lg p-4 text-sm text-[#7C818E]">Customer list — Task 15</div>;
}
