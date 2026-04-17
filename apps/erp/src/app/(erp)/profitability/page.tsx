import Link from 'next/link';
import { getProfitabilityV2 } from '@/lib/vendor-bills-queries';
import { formatINR } from '@repo/ui/formatters';
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
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { BarChart3 } from 'lucide-react';

function marginVariant(margin: number | null): 'success' | 'pending' | 'error' | 'neutral' {
  if (margin == null) return 'neutral';
  if (margin > 15) return 'success';
  if (margin >= 5) return 'pending';
  return 'error';
}

export default async function ProfitabilityPage() {
  const projects = await getProfitabilityV2();

  const totalContracted = projects.reduce((s, p) => s + Number(p.contracted_value), 0);
  const totalCost = projects.reduce((s, p) => s + Number(p.total_cost ?? 0), 0);
  const totalReceivables = projects.reduce((s, p) => s + Number(p.total_ar_outstanding ?? 0), 0);
  const totalPayables = projects.reduce((s, p) => s + Number(p.total_ap_outstanding ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">FINANCE</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Profitability (V2)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live from <code className="font-mono text-xs">get_project_profitability_v2</code> — includes Zoho historical data
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Total Contracted</p>
            <p className="text-lg font-bold font-mono">{formatINR(totalContracted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Total Cost</p>
            <p className="text-lg font-bold font-mono text-[#991B1B]">{formatINR(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">AR Outstanding</p>
            <p className="text-lg font-bold font-mono text-[#92400E]">{formatINR(totalReceivables)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">AP Outstanding</p>
            <p className="text-lg font-bold font-mono text-[#1E3A5F]">{formatINR(totalPayables)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Contracted</TableHead>
                <TableHead className="text-right">Invoiced</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<BarChart3 className="h-12 w-12" />}
                      title="No project data found"
                      description="Profitability data will appear here once projects have financial activity."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                projects.map((proj) => (
                  <TableRow key={proj.project_id}>
                    <TableCell>
                      <Link
                        href={`/projects/${proj.project_id}`}
                        className="text-[#00B050] hover:underline font-medium font-mono text-sm"
                      >
                        {proj.project_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{proj.customer_name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINR(Number(proj.contracted_value))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(proj.total_invoiced) > 0 ? formatINR(Number(proj.total_invoiced)) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(proj.total_received) > 0 ? formatINR(Number(proj.total_received)) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(proj.total_cost) > 0 ? formatINR(Number(proj.total_cost)) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {proj.margin_pct != null ? (
                        <Badge variant={marginVariant(Number(proj.margin_pct))}>
                          {Number(proj.margin_pct).toFixed(1)}%
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {(proj.status ?? '—').replace(/_/g, ' ')}
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
