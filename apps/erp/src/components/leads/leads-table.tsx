'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LeadStatusBadge } from './lead-status-badge';
import { BulkActionBar } from './bulk-action-bar';
import { toIST } from '@repo/ui/formatters';
import {
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  city: string;
  segment: string | null;
  source: string | null;
  status: string;
  estimated_size_kwp: number | null;
  assigned_to: string | null;
  next_followup_date: string | null;
  created_at: string;
  employees: { full_name: string } | null;
}

interface Employee {
  id: string;
  full_name: string;
}

interface LeadsTableProps {
  leads: Lead[];
  employees: Employee[];
}

export function LeadsTable({ leads, employees }: LeadsTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const allSelected = leads.length > 0 && selectedIds.size === leads.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function onActionComplete() {
    clearSelection();
    router.refresh();
  }

  return (
    <>
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selectedIds)}
          selectedLeads={leads.filter((l) => selectedIds.has(l.id))}
          employees={employees}
          onClear={clearSelection}
          onActionComplete={onActionComplete}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Customer Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Segment</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-[#9CA0AB] py-8">
                No leads found.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => (
              <TableRow
                key={lead.id}
                data-state={selectedIds.has(lead.id) ? 'selected' : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(lead.id)}
                    onCheckedChange={() => toggleOne(lead.id)}
                    aria-label={`Select ${lead.customer_name}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="text-[#00B050] hover:underline font-medium"
                  >
                    {lead.customer_name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm">{lead.phone}</TableCell>
                <TableCell>{lead.city}</TableCell>
                <TableCell className="capitalize text-sm">
                  {lead.segment?.replace(/_/g, ' ') ?? '—'}
                </TableCell>
                <TableCell className="capitalize text-sm">
                  {lead.source?.replace(/_/g, ' ') ?? '—'}
                </TableCell>
                <TableCell>
                  <LeadStatusBadge status={lead.status as any} />
                </TableCell>
                <TableCell className="text-sm">
                  {lead.employees?.full_name ?? '—'}
                </TableCell>
                <TableCell className="text-sm text-[#7C818E]">
                  {toIST(lead.created_at)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
