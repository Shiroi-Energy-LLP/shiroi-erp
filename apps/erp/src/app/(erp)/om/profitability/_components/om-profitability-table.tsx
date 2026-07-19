'use client';

/**
 * O&M Profitability per-project table.
 * Client component for search/sort interactivity.
 */

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { Input } from '@repo/ui/components/input';
import { Badge } from '@repo/ui/components/badge';
import { formatINR } from '@repo/ui';

interface ProfitabilityRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  ticket_count: number;
  ticket_parts_cost: number;
  ticket_service_amount: number;
  profit_loss: number;
  sla_compliant_count: number;
  sla_breach_count: number;
  sla_compliance_pct: number | null;
}

export function OmProfitabilityTable({ rows }: { rows: ProfitabilityRow[] }) {
  const [search, setSearch] = useState('');

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      r.project_number.toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q)
    );
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No completed projects found for this period.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search by project number or customer..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Size (kWp)</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">Parts Cost</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Profit/Loss</TableHead>
              <TableHead className="text-right">SLA %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.project_id}>
                <TableCell className="font-mono text-sm">{row.project_number}</TableCell>
                <TableCell className="max-w-[240px]">{row.customer_name}</TableCell>
                <TableCell className="text-right">{Number(row.system_size_kwp).toFixed(1)}</TableCell>
                <TableCell className="text-right">{row.ticket_count}</TableCell>
                <TableCell className="text-right">
                  {row.ticket_parts_cost > 0 ? formatINR(Number(row.ticket_parts_cost)) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {row.ticket_service_amount > 0 ? formatINR(Number(row.ticket_service_amount)) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {row.ticket_count > 0 ? (
                    <span className={Number(row.profit_loss) >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                      {Number(row.profit_loss) >= 0 ? '+' : ''}{formatINR(Number(row.profit_loss))}
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {row.sla_compliance_pct !== null ? (
                    <Badge
                      variant={
                        row.sla_compliance_pct >= 90
                          ? 'default'
                          : row.sla_compliance_pct >= 70
                          ? 'secondary'
                          : 'destructive'
                      }
                    >
                      {Number(row.sla_compliance_pct).toFixed(0)}%
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {rows.length} projects shown
      </p>
    </div>
  );
}
