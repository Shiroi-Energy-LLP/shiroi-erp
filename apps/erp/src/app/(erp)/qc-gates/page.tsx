import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { ClipboardCheck } from 'lucide-react';

export default async function QCGatesPage() {
  const op = '[QCGatesPage]';
  const supabase = await createClient();

  const { data: inspections, error } = await supabase
    .from('qc_gate_inspections')
    .select(
      '*, projects!qc_gate_inspections_project_id_fkey(project_number, customer_name), inspector:employees!qc_gate_inspections_inspected_by_fkey(full_name)',
    )
    .order('inspection_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
  }

  const rows = inspections ?? [];

  function resultVariant(result: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (result) {
      case 'pass': return 'default';
      case 'fail': return 'destructive';
      case 'conditional_pass': return 'secondary';
      default: return 'outline';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">QC Gate Inspections</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Gate #</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardCheck className="h-8 w-8 text-muted-foreground/50" />
                      No QC inspections found.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((insp) => (
                  <TableRow key={insp.id}>
                    <TableCell className="font-medium">
                      {insp.projects
                        ? `${insp.projects.project_number} — ${insp.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono">
                      Gate {insp.gate_number}
                    </TableCell>
                    <TableCell>{insp.inspector?.full_name ?? '—'}</TableCell>
                    <TableCell>
                      {insp.inspection_date ? formatDate(insp.inspection_date) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={resultVariant(insp.overall_result)}>
                        {insp.overall_result?.replace(/_/g, ' ').toUpperCase() ?? 'PENDING'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                      {insp.failure_notes ?? insp.conditional_notes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
