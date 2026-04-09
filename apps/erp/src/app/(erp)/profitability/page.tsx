import Link from 'next/link';
import { getProjectProfitability } from '@/lib/profitability-queries';
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
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

const STATUS_OPTIONS = [
  { value: 'order_received', label: 'Order Received' },
  { value: 'yet_to_start', label: 'Yet to Start' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'holding_shiroi', label: 'Holding from Shiroi' },
  { value: 'holding_client', label: 'Holding from Client' },
  { value: 'waiting_net_metering', label: 'Waiting for Net Metering' },
  { value: 'meter_client_scope', label: 'Meter - Client Scope' },
];

function marginColor(margin: number | null): string {
  if (margin == null) return 'text-muted-foreground';
  if (margin > 15) return 'text-[#065F46]';
  if (margin >= 5) return 'text-[#92400E]';
  return 'text-[#991B1B]';
}

function marginBg(margin: number | null): 'success' | 'pending' | 'error' | 'neutral' {
  if (margin == null) return 'neutral';
  if (margin > 15) return 'success';
  if (margin >= 5) return 'pending';
  return 'error';
}

interface ProfitabilityPageProps {
  searchParams: Promise<{
    status?: string;
  }>;
}

export default async function ProfitabilityPage({ searchParams }: ProfitabilityPageProps) {
  const params = await searchParams;
  const projects = await getProjectProfitability({
    status: params.status || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Eyebrow className="mb-1">PROFITABILITY</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Profitability</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <FilterBar basePath="/profitability" filterParams={['status']}>
            <FilterSelect paramName="status" className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Size (kWp)</TableHead>
                <TableHead className="text-right">Contracted Value</TableHead>
                <TableHead className="text-right">Actual Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<BarChart3 className="h-12 w-12" />}
                      title="No projects found"
                      description="Profitability data will appear here once projects have financial activity."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                projects.map((proj) => (
                  <TableRow key={proj.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${proj.id}`}
                        className="text-[#00B050] hover:underline font-medium font-mono text-sm"
                      >
                        {proj.project_number}
                      </Link>
                    </TableCell>
                    <TableCell>{proj.customer_name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {proj.system_size_kwp != null ? `${proj.system_size_kwp}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {proj.contracted_value != null ? formatINR(proj.contracted_value) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {proj.actual_cost != null ? formatINR(proj.actual_cost) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {proj.margin != null ? (
                        <Badge variant={marginBg(proj.margin)}>
                          {proj.margin.toFixed(1)}%
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
