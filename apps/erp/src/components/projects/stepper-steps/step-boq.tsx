import {
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBoqData } from '@/lib/project-stepper-queries';
import { Calculator } from 'lucide-react';

interface StepBoqProps {
  projectId: string;
}

export async function StepBoq({ projectId }: StepBoqProps) {
  const variances = await getStepBoqData(projectId);

  if (variances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Calculator className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No BOQ Analysis</h3>
        <p className="text-[13px] text-[#7C818E]">BOQ analysis will be available once actual costs are recorded.</p>
      </div>
    );
  }

  const totalEstimated = variances.reduce((sum, v) => sum + v.estimated_cost, 0);
  const totalActual = variances.reduce((sum, v) => sum + v.actual_cost, 0);
  const totalVariance = variances.reduce((sum, v) => sum + v.variance_amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">BOQ Analysis &mdash; Planned vs Actual</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Variance %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variances.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.item_category}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(v.estimated_cost)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(v.actual_cost)}</TableCell>
                <TableCell className={`text-right font-mono font-medium ${v.variance_amount > 0 ? 'text-[#991B1B]' : v.variance_amount < 0 ? 'text-[#065F46]' : 'text-[#3F424D]'}`}>
                  {v.variance_amount > 0 ? '+' : ''}{formatINR(v.variance_amount)}
                </TableCell>
                <TableCell className={`text-right font-mono ${v.variance_pct > 0 ? 'text-[#991B1B]' : v.variance_pct < 0 ? 'text-[#065F46]' : 'text-[#3F424D]'}`}>
                  {v.variance_pct > 0 ? '+' : ''}{v.variance_pct.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
            {/* Totals */}
            <TableRow>
              <TableCell className="font-bold text-[#1A1D24]">Total</TableCell>
              <TableCell className="text-right font-mono font-bold">{formatINR(totalEstimated)}</TableCell>
              <TableCell className="text-right font-mono font-bold">{formatINR(totalActual)}</TableCell>
              <TableCell className={`text-right font-mono font-bold ${totalVariance > 0 ? 'text-[#991B1B]' : totalVariance < 0 ? 'text-[#065F46]' : 'text-[#3F424D]'}`}>
                {totalVariance > 0 ? '+' : ''}{formatINR(totalVariance)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
