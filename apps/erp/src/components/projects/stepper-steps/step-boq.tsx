import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBoqData, getStepBomData, getBoiState } from '@/lib/project-stepper-queries';
import { Calculator, CheckCircle2 } from 'lucide-react';
import {
  BoqSeedButton,
  BoqItemStatusSelect,
  BoqInlineEdit,
  BoqAddItemRow,
  BoqDeleteButton,
  BoqFinalSummary,
  BoqCompleteButton,
} from '@/components/projects/forms/boq-variance-form';
import { BOI_CATEGORIES } from '@/components/projects/forms/bom-line-form';
import { BoqCategoryFilterWrapper } from '@/components/projects/forms/boq-category-filter-wrapper';
import Link from 'next/link';

interface StepBoqProps {
  projectId: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  yet_to_finalize: { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' },
  yet_to_place: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  order_placed: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  received: { bg: '#F0FDF4', text: '#059669', border: '#A7F3D0' },
  ready_to_dispatch: { bg: '#FAF5FF', text: '#7C3AED', border: '#DDD6FE' },
  delivered: { bg: '#F0FDF4', text: '#00B050', border: '#86EFAC' },
};

const STATUS_LABELS: Record<string, string> = {
  yet_to_finalize: 'Yet to Finalize',
  yet_to_place: 'Yet to Place',
  order_placed: 'Order Placed',
  received: 'Received',
  ready_to_dispatch: 'Ready to Dispatch',
  delivered: 'Delivered',
};

function getCategoryLabel(value: string): string {
  return BOI_CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}

export async function StepBoq({ projectId }: StepBoqProps) {
  let boqData: Awaited<ReturnType<typeof getStepBoqData>>;
  let bomLines: any[] = [];
  let boiState: any = null;

  try {
    [boqData, bomLines, boiState] = await Promise.all([
      getStepBoqData(projectId),
      getStepBomData(projectId),
      getBoiState(projectId),
    ]);
  } catch (error) {
    console.error('[StepBoq] Failed to load data:', error);
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Calculator className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">Failed to Load</h3>
        <p className="text-[13px] text-[#7C818E]">Could not load BOQ data. Please refresh the page.</p>
      </div>
    );
  }

  const hasBomLines = bomLines.length > 0;
  const hasBoqItems = boqData.type === 'items' && boqData.items.length > 0;
  const isBoqCompleted = !!boiState?.boq_completed;
  const contractedValue = Number(boiState?.contracted_value ?? 0);
  const projectCostManual = boiState?.project_cost_manual ? Number(boiState.project_cost_manual) : null;

  // Show seed button only when BOM exists but BOQ hasn't been generated
  if (!hasBoqItems) {
    return (
      <div>
        <BoqSeedButton
          projectId={projectId}
          hasBomLines={hasBomLines}
          hasVariances={false}
        />
        <div className="flex flex-col items-center justify-center py-16">
          <Calculator className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No BOQ Items</h3>
          <p className="text-[13px] text-[#7C818E] max-w-md text-center">
            {hasBomLines
              ? 'Click "Generate BOQ from BOM" above to create procurement items from your BOM.'
              : 'Add items in the BOI tab first, then track costs here.'}
          </p>
          {!hasBomLines && (
            <Link href={`/projects/${projectId}?tab=bom`} className="mt-3">
              <Button size="sm" variant="ghost">&larr; Go to BOI</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Item-level BOQ view
  const items = boqData.items;
  const totalValue = items.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0);

  // Status summary
  const statusCounts = items.reduce((acc: Record<string, number>, item: any) => {
    acc[item.procurement_status] = (acc[item.procurement_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Unique categories for filter
  const uniqueCategories = [...new Set(items.map((item: any) => item.item_category as string))].sort();

  return (
    <div className="space-y-4">
      {/* Completed banner */}
      {isBoqCompleted && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <p className="text-sm font-medium text-green-800">BOQ Budget Analysis Completed</p>
        </div>
      )}

      {/* Final Summary (always visible) */}
      <BoqFinalSummary
        projectId={projectId}
        contractedValue={contractedValue}
        projectCostManual={projectCostManual}
        boqTotal={totalValue}
        isCompleted={isBoqCompleted}
      />

      {/* Status summary cards */}
      <div className="flex gap-3 flex-wrap">
        {Object.entries(statusCounts).map(([status, count]) => {
          const colors = STATUS_COLORS[status] ?? { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' };
          return (
            <div
              key={status}
              className="px-3 py-2 rounded-lg border text-center min-w-[100px]"
              style={{ backgroundColor: colors.bg, borderColor: colors.border }}
            >
              <div className="text-lg font-bold" style={{ color: colors.text }}>{count}</div>
              <div className="text-[10px] font-medium" style={{ color: colors.text }}>
                {STATUS_LABELS[status] ?? status}
              </div>
            </div>
          );
        })}
      </div>

      {/* Items table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">BOQ — Budget Analysis</CardTitle>
          <div className="flex items-center gap-3">
            {/* Category filter */}
            <BoqCategoryFilterWrapper categories={uniqueCategories} />
            <span className="text-sm font-mono text-[#7C818E]">{items.length} items &middot; {formatINR(totalValue)}</span>
            {!isBoqCompleted && <BoqCompleteButton projectId={projectId} isCompleted={false} />}
            <Link href={`/projects/${projectId}?tab=delivery`}>
              <Button size="sm" variant="ghost" className="text-xs">
                Continue to Delivery →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" id="boq-table">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Brand / Model</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Rate (₹)</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">GST %</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-n-500">Total (₹)</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-n-500">Status</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any) => {
                  return (
                    <tr key={item.id} className="border-b border-n-100 hover:bg-n-50 group boq-row" data-category={item.item_category}>
                      <td className="px-3 py-2 font-mono text-n-400">{item.line_number}</td>
                      <td className="px-3 py-2 font-medium text-n-900">{getCategoryLabel(item.item_category)}</td>
                      <td className="px-3 py-2 text-n-700">{item.item_description}</td>
                      <td className="px-3 py-2 text-n-500">
                        {[item.brand, item.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{item.quantity} {item.unit}</td>
                      <td className="px-3 py-2 text-right">
                        <BoqInlineEdit
                          projectId={projectId}
                          itemId={item.id}
                          field="unit_price"
                          currentValue={Number(item.unit_price)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BoqInlineEdit
                          projectId={projectId}
                          itemId={item.id}
                          field="gst_rate"
                          currentValue={Number(item.gst_rate)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{formatINR(Number(item.total_price))}</td>
                      <td className="px-3 py-2">
                        <BoqItemStatusSelect
                          projectId={projectId}
                          itemId={item.id}
                          currentStatus={item.procurement_status}
                        />
                      </td>
                      <td className="px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <BoqDeleteButton
                          projectId={projectId}
                          itemId={item.id}
                          label={item.item_description}
                        />
                      </td>
                    </tr>
                  );
                })}

                {/* Add item row */}
                <BoqAddItemRow projectId={projectId} />

                {/* Grand Total row */}
                <tr className="border-t-2 border-n-200 bg-n-50">
                  <td colSpan={7} className="px-3 py-3 text-right font-bold text-n-900 text-sm">Grand Total Budget</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-n-900 text-base">{formatINR(totalValue)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
