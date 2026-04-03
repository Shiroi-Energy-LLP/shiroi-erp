import Link from 'next/link';
import { getProjectProfitability } from '@/lib/profitability-queries';
import { formatINR } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Select,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
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
  let projects = await getProjectProfitability();

  // Filter by status if provided
  if (params.status) {
    projects = projects.filter(p => p.status === params.status);
  }

  // Sort by margin descending (nulls last)
  projects.sort((a, b) => {
    if (a.margin == null && b.margin == null) return 0;
    if (a.margin == null) return 1;
    if (b.margin == null) return -1;
    return b.margin - a.margin;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Profitability</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="status" defaultValue={params.status ?? ''} className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {params.status && (
              <Link href="/profitability">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No projects found.
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
