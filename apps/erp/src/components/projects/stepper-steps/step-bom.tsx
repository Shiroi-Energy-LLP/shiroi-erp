import {
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBomData } from '@/lib/project-stepper-queries';
import { Package } from 'lucide-react';
import { BomLineForm } from '@/components/projects/forms/bom-line-form';
import { createClient } from '@repo/supabase/server';

interface StepBomProps {
  projectId: string;
}

export async function StepBom({ projectId }: StepBomProps) {
  const bomLines = await getStepBomData(projectId);

  // Check if project has a linked proposal (needed for BOM add form)
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

  const existingLines = bomLines.map((l) => ({
    id: l.id,
    item_category: l.item_category,
    item_description: l.item_description,
  }));

  return (
    <div>
      {/* Add BOM line form */}
      <BomLineForm
        projectId={projectId}
        hasProposal={hasProposal}
        existingLines={existingLines}
      />

      {bomLines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Package className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Bill of Materials</h3>
          <p className="text-[13px] text-[#7C818E]">
            {hasProposal
              ? 'Click "Add BOM Line" above to start building the bill of materials.'
              : 'BOM will be available once a proposal is created for this project.'}
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Bill of Materials</CardTitle>
            <span className="text-sm font-mono text-[#7C818E]">{bomLines.length} items</span>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Brand / Model</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Rate</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bomLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.item_category}</TableCell>
                    <TableCell>{line.item_description}</TableCell>
                    <TableCell className="text-[#7C818E]">
                      {[line.brand, line.model].filter(Boolean).join(' ') || '\u2014'}
                    </TableCell>
                    <TableCell className="text-right font-mono">{line.quantity}</TableCell>
                    <TableCell>{line.unit}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(line.unit_price)}</TableCell>
                    <TableCell className="text-right font-mono">{line.gst_rate}%</TableCell>
                    <TableCell className="text-right font-mono font-medium">{formatINR(line.total_price)}</TableCell>
                  </TableRow>
                ))}
                {/* Total row */}
                <TableRow>
                  <TableCell colSpan={7} className="text-right font-bold text-[#1A1D24]">Total</TableCell>
                  <TableCell className="text-right font-mono font-bold text-[#1A1D24]">
                    {formatINR(bomLines.reduce((sum, line) => sum + line.total_price, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
