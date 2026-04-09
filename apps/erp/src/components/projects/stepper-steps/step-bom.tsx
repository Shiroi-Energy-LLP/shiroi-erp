import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepBoqData } from '@/lib/project-stepper-queries';
import { getBoiState } from '@/lib/project-stepper-queries';
import { Package, Lock, CheckCircle2 } from 'lucide-react';
import { BoiInlineAddRow, BoiDeleteButton, BoiLockButton } from '@/components/projects/forms/bom-line-form';
import { BoqSeedButton } from '@/components/projects/forms/boq-variance-form';
import { getCategoryLabel } from '@/lib/boi-constants';
import Link from 'next/link';

interface StepBomProps {
  projectId: string;
}

export async function StepBom({ projectId }: StepBomProps) {
  const [boqData, boiState] = await Promise.all([
    getStepBoqData(projectId),
    getBoiState(projectId),
  ]);

  const hasBoqItems = boqData.type === 'items' && boqData.items.length > 0;
  const isLocked = !!(boiState as any)?.boi_locked;
  const hasProposal = !!(boiState as any)?.proposal_id;
  const items = hasBoqItems ? boqData.items : [];

  // If no items and no proposal — show seed option or empty
  if (!hasBoqItems && !hasProposal) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-16">
          <Package className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Bill of Items</h3>
          <p className="text-[13px] text-[#7C818E] max-w-md text-center">
            Create a BOI by adding items below, or link a proposal to seed from its BOM.
          </p>
        </div>
        {/* Allow adding items directly even without a proposal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bill of Items (BOI)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Item Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Make/Brand</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Unit</th>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  <BoiInlineAddRow projectId={projectId} />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If no BOQ items but has a proposal — show seed button
  if (!hasBoqItems && hasProposal) {
    return (
      <div className="space-y-4">
        <BoqSeedButton
          projectId={projectId}
          hasBomLines={true}
          hasVariances={false}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bill of Items (BOI)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Item Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Make/Brand</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Unit</th>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  <BoiInlineAddRow projectId={projectId} />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with lock state */}
      {isLocked && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">BOI Submitted</p>
            {(boiState as any)?.preparedByName && (
              <p className="text-xs text-green-600">
                Prepared By: {(boiState as any).preparedByName}
                {(boiState as any)?.boi_locked_at && ` on ${formatDate((boiState as any).boi_locked_at)}`}
              </p>
            )}
          </div>
          <BoiLockButton projectId={projectId} isLocked={true} />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Bill of Items (BOI)</CardTitle>
            {isLocked && (
              <Badge variant="default" className="text-[10px]">
                <Lock className="h-3 w-3 mr-1" /> Locked
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-[#7C818E]">{items.length} items</span>
            {!isLocked && items.length > 0 && (
              <BoiLockButton projectId={projectId} isLocked={false} />
            )}
            {items.length > 0 && (
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Item Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Make/Brand</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Unit</th>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any) => (
                  <tr key={item.id} className="border-b border-n-100 hover:bg-n-50 group">
                    <td className="px-3 py-2 font-medium text-n-900">{getCategoryLabel(item.item_category)}</td>
                    <td className="px-3 py-2 text-n-700">{item.item_description}</td>
                    <td className="px-3 py-2 text-n-500">
                      {[item.brand, item.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-n-700">{item.quantity}</td>
                    <td className="px-3 py-2 text-n-500">{item.unit}</td>
                    <td></td>
                    <td className="px-3 py-2">
                      {!isLocked && (
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <BoiDeleteButton
                            projectId={projectId}
                            itemId={item.id}
                            label={item.item_description}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {/* Inline add row — only when unlocked */}
                {!isLocked && <BoiInlineAddRow projectId={projectId} />}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
