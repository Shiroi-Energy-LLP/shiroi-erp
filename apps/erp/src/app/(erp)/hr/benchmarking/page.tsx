import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Eyebrow,
} from '@repo/ui';
import { BarChart3, TrendingDown, CheckCircle, TrendingUp } from 'lucide-react';
import { getSalaryBenchmarkReport, getCallerRole, type BenchmarkRow } from '@/lib/salary-benchmark-queries';

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function recommendationVariant(rec: string | null): 'destructive' | 'success' | 'secondary' {
  if (rec === 'underpaid') return 'destructive';
  if (rec === 'overpaid') return 'success';
  return 'secondary';
}

function recommendationLabel(rec: string | null): string {
  if (rec === 'underpaid') return 'Underpaid';
  if (rec === 'overpaid') return 'Overpaid';
  if (rec === 'fair') return 'Fair';
  return 'No benchmark';
}

export default async function SalaryBenchmarkingPage() {
  // Gate: founder + hr_manager only
  const role = await getCallerRole();
  if (!role) redirect('/login');
  if (!['founder', 'hr_manager'].includes(role)) redirect('/hr');

  const rows = await getSalaryBenchmarkReport();

  // KPI counts
  const underpaid = rows.filter((r: BenchmarkRow) => r.recommendation === 'underpaid').length;
  const fair = rows.filter((r: BenchmarkRow) => r.recommendation === 'fair').length;
  const overpaid = rows.filter((r: BenchmarkRow) => r.recommendation === 'overpaid').length;

  // Group by role for display
  const grouped = rows.reduce<Record<string, BenchmarkRow[]>>((acc, row: BenchmarkRow) => {
    const key = row.role ?? 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
        <div>
          <Eyebrow>HR Analytics</Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight">Salary Benchmarking</h1>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <TrendingDown className="h-4 w-4" />
              <p className="text-sm font-medium">Underpaid (&lt;p25)</p>
            </div>
            <p className="text-3xl font-bold mt-1">{underpaid}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <p className="text-sm font-medium">Fair (p25–p75)</p>
            </div>
            <p className="text-3xl font-bold mt-1">{fair}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Overpaid (&gt;p75)</p>
            </div>
            <p className="text-3xl font-bold mt-1">{overpaid}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-role groups */}
      {Object.entries(grouped).map(([roleName, employees]) => (
        <Card key={roleName}>
          <CardHeader>
            <CardTitle className="text-base capitalize">{roleName.replace(/_/g, ' ')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">p25</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">p75</TableHead>
                  <TableHead className="text-right">vs median</TableHead>
                  <TableHead>Assessment</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((row: BenchmarkRow) => (
                  <TableRow key={row.employee_id}>
                    <TableCell className="font-medium">{row.employee_name}</TableCell>
                    {/* Salary columns: page is founder/hr_manager gated */}
                    <TableCell className="text-right">{formatINR(Number(row.gross_monthly))}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {row.market_p25 ? formatINR(Number(row.market_p25)) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {row.market_median ? formatINR(Number(row.market_median)) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {row.market_p75 ? formatINR(Number(row.market_p75)) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.delta_pct !== null ? (
                        <span className={row.delta_pct >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {row.delta_pct >= 0 ? '+' : ''}{row.delta_pct}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={recommendationVariant(row.recommendation)}>
                        {recommendationLabel(row.recommendation)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.source ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No employee salary data available. Ensure HR profiles have gross_monthly set.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';
