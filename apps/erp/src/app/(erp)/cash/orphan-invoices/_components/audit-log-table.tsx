'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { fetchAuditClient } from './_client-fetchers';

interface AuditRow {
  id: string;
  entity_type: 'invoice' | 'payment';
  entity_id: string;
  decision: string;
  made_by: string;
  made_at: string;
  notes: string | null;
  from_project_id: string | null;
  to_project_id: string | null;
  employees?: { full_name: string } | null;
}

const DECISION_COLORS: Record<string, string> = {
  assign: 'bg-green-100 text-green-800',
  exclude: 'bg-red-100 text-red-800',
  skip: 'bg-gray-100 text-gray-800',
  reassign: 'bg-blue-100 text-blue-800',
  undo_exclude: 'bg-yellow-100 text-yellow-800',
  undo_skip: 'bg-yellow-100 text-yellow-800',
};

export function AuditLogTable() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: AuditRow[]; total: number } | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<string>('');

  useEffect(() => {
    fetchAuditClient({ page, decision: decisionFilter || undefined }).then((d) => setData(d as any));
  }, [page, decisionFilter]);

  if (!data) return <Card><CardContent className="py-8 text-[#7C818E]">Loading…</CardContent></Card>;
  const totalPages = Math.max(1, Math.ceil(data.total / 50));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 border-b flex gap-2 flex-wrap">
          <span className="text-xs text-[#7C818E]">Filter:</span>
          {['', 'assign', 'exclude', 'skip', 'reassign', 'undo_exclude', 'undo_skip'].map((d) => (
            <button
              key={d || 'all'}
              type="button"
              onClick={() => { setDecisionFilter(d); setPage(1); }}
              className={`text-xs px-2 py-1 rounded ${
                decisionFilter === d ? 'bg-[#00B050] text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {d || 'All'}
            </button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-[#7C818E]">No audit rows.</TableCell></TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{formatDate(r.made_at)}</TableCell>
                  <TableCell className="text-xs">{r.employees?.full_name ?? r.made_by.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.entity_type} · {r.entity_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${DECISION_COLORS[r.decision] ?? 'bg-gray-100 text-gray-700'}`}>
                      {r.decision}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-[#7C818E] max-w-md truncate">{r.notes ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 border-t">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <span className="text-xs self-center">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
