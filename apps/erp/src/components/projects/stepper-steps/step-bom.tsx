import {
  Card, CardHeader, CardTitle, CardContent,
  Button,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBomData } from '@/lib/project-stepper-queries';
import { Package } from 'lucide-react';
import { BomInlineAddRow, BomDeleteButton } from '@/components/projects/forms/bom-line-form';
import { createClient } from '@repo/supabase/server';
import Link from 'next/link';

interface StepBomProps {
  projectId: string;
}

export async function StepBom({ projectId }: StepBomProps) {
  const bomLines = await getStepBomData(projectId);

  // Check if project has a linked proposal
  let hasProposal = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('projects')
      .select('proposal_id')
      .eq('id', projectId)
      .single();
    hasProposal = !!data?.proposal_id;
  } catch {
    // Non-blocking
  }

  const totalValue = bomLines.reduce((sum, line) => sum + line.total_price, 0);

  if (bomLines.length === 0 && !hasProposal) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Package className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Bill of Materials</h3>
        <p className="text-[13px] text-[#7C818E]">BOM will be available once a proposal is created for this project.</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Bill of Materials</CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-[#7C818E]">{bomLines.length} items</span>
          {bomLines.length > 0 && (
            <Link href={`/projects/${projectId}?tab=boq`}>
              <Button size="sm" variant="ghost" className="text-xs">
                Continue to BOQ →
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-n-200 bg-n-50">
                <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Description</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Brand / Model</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Unit</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Unit Rate</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-n-500">GST %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Total</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {bomLines.map((line) => (
                <tr key={line.id} className="border-b border-n-100 hover:bg-n-50 group">
                  <td className="px-3 py-2 font-medium text-n-900">{line.item_category}</td>
                  <td className="px-3 py-2 text-n-700">{line.item_description}</td>
                  <td className="px-3 py-2 text-n-500">
                    {[line.brand, line.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-n-700">{line.quantity}</td>
                  <td className="px-3 py-2 text-n-500">{line.unit}</td>
                  <td className="px-3 py-2 text-right font-mono text-n-700">{formatINR(line.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-mono text-n-500">{line.gst_rate}%</td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-n-900">{formatINR(line.total_price)}</td>
                  <td className="px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <BomDeleteButton
                      projectId={projectId}
                      lineId={line.id}
                      label={line.item_description}
                    />
                  </td>
                </tr>
              ))}

              {/* Inline add row */}
              <BomInlineAddRow projectId={projectId} hasProposal={hasProposal} />

              {/* Total row */}
              {bomLines.length > 0 && (
                <tr className="border-t-2 border-n-200 bg-n-50">
                  <td colSpan={7} className="px-3 py-2 text-right font-bold text-n-900">Total</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-n-900">{formatINR(totalValue)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
