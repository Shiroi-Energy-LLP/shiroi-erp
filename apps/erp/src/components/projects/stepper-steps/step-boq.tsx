import {
  Card, CardHeader, CardTitle, CardContent,
  Button,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBoqData, getStepBomData } from '@/lib/project-stepper-queries';
import { Calculator } from 'lucide-react';
import { BoqSeedButton, BoqActualCostEdit } from '@/components/projects/forms/boq-variance-form';
import Link from 'next/link';

interface StepBoqProps {
  projectId: string;
}

export async function StepBoq({ projectId }: StepBoqProps) {
  const [variances, bomLines] = await Promise.all([
    getStepBoqData(projectId),
    getStepBomData(projectId),
  ]);

  const hasBomLines = bomLines.length > 0;
  const hasVariances = variances.length > 0;

  return (
    <div>
      {/* Seed button: only shows when BOM exists but BOQ hasn't been generated */}
      <BoqSeedButton
        projectId={projectId}
        hasBomLines={hasBomLines}
        hasVariances={hasVariances}
      />

      {!hasVariances ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Calculator className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No BOQ Analysis</h3>
          <p className="text-[13px] text-[#7C818E] max-w-md text-center">
            {hasBomLines
              ? 'Click "Generate BOQ from BOM" above to auto-create cost entries from your BOM categories.'
              : 'Add BOM lines first, then BOQ will be auto-generated from those categories.'}
          </p>
          {!hasBomLines && (
            <Link href={`/projects/${projectId}?tab=bom`} className="mt-3">
              <Button size="sm" variant="ghost">← Go to BOM</Button>
            </Link>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">BOQ Analysis &mdash; Planned vs Actual</CardTitle>
            <div className="flex items-center gap-3">
              <span className="text-xs text-n-500">Double-click actual cost to edit</span>
              <Link href={`/projects/${projectId}?tab=delivery`}>
                <Button size="sm" variant="ghost" className="text-xs">
                  Continue to Delivery →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-n-500">Category</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-n-500">Estimated (from BOM)</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-n-500">Actual Cost</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-n-500">Variance</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-n-500">%</th>
                  </tr>
                </thead>
                <tbody>
                  {variances.map((v) => (
                    <tr key={v.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-4 py-2.5 font-medium text-n-900">{v.item_category}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-n-600">{formatINR(v.estimated_cost)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <BoqActualCostEdit
                          projectId={projectId}
                          varianceId={v.id}
                          currentActual={v.actual_cost}
                          currentNotes={null}
                        />
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono font-medium ${v.variance_amount > 0 ? 'text-[#991B1B]' : v.variance_amount < 0 ? 'text-[#065F46]' : 'text-n-500'}`}>
                        {v.variance_amount > 0 ? '+' : ''}{formatINR(v.variance_amount)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs ${v.variance_pct > 0 ? 'text-[#991B1B]' : v.variance_pct < 0 ? 'text-[#065F46]' : 'text-n-500'}`}>
                        {v.variance_pct > 0 ? '+' : ''}{v.variance_pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  {/* Totals */}
                  {(() => {
                    const totalEstimated = variances.reduce((s, v) => s + v.estimated_cost, 0);
                    const totalActual = variances.reduce((s, v) => s + v.actual_cost, 0);
                    const totalVariance = variances.reduce((s, v) => s + v.variance_amount, 0);
                    return (
                      <tr className="border-t-2 border-n-200 bg-n-50">
                        <td className="px-4 py-2.5 font-bold text-n-900">Total</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold">{formatINR(totalEstimated)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold">{formatINR(totalActual)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-bold ${totalVariance > 0 ? 'text-[#991B1B]' : totalVariance < 0 ? 'text-[#065F46]' : 'text-n-500'}`}>
                          {totalVariance > 0 ? '+' : ''}{formatINR(totalVariance)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
