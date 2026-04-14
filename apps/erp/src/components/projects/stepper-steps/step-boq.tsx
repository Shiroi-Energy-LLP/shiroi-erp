import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepBoqData, getStepBomData, getBoiState, getApprovedSiteExpenses } from '@/lib/project-stepper-queries';
import { Calculator, CheckCircle2, Package } from 'lucide-react';
import {
  BoqSeedButton,
  BoqItemStatusSelect,
  BoqInlineEdit,
  BoqAddItemRow,
  BoqDeleteButton,
  BoqFinalSummary,
  BoqCompleteButton,
  SendToPurchaseButton,
  ApplyPriceBookButton,
} from '@/components/projects/forms/boq-variance-form';
import { getCategoryLabel, BOI_CATEGORIES } from '@/lib/boi-constants';
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


export async function StepBoq({ projectId }: StepBoqProps) {
  let boqData: Awaited<ReturnType<typeof getStepBoqData>>;
  let bomLines: any[] = [];
  let boiState: any = null;
  let approvedSiteExpenses = 0;

  try {
    [boqData, bomLines, boiState, approvedSiteExpenses] = await Promise.all([
      getStepBoqData(projectId),
      getStepBomData(projectId),
      getBoiState(projectId),
      getApprovedSiteExpenses(projectId),
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
  const estimatedSiteExpensesBudget = Number(boiState?.estimated_site_expenses_budget ?? 0);

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
  const totalWithoutGst = items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity || 0);
    const rate = Number(item.unit_price || 0);
    return sum + qty * rate;
  }, 0);

  // Status summary
  const statusCounts = items.reduce((acc: Record<string, number>, item: any) => {
    acc[item.procurement_status] = (acc[item.procurement_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Unique categories for filter
  const uniqueCategories = [...new Set(items.map((item: any) => item.item_category as string))].sort();

  // Category-wise subtotals
  const categoryTotals: Record<string, { count: number; totalWithGst: number; totalWithoutGst: number }> = {};
  for (const item of items) {
    const cat = item.item_category as string;
    if (!categoryTotals[cat]) {
      categoryTotals[cat] = { count: 0, totalWithGst: 0, totalWithoutGst: 0 };
    }
    categoryTotals[cat].count++;
    categoryTotals[cat].totalWithGst += Number(item.total_price || 0);
    categoryTotals[cat].totalWithoutGst += Number(item.quantity || 0) * Number(item.unit_price || 0);
  }

  // Count items with zero pricing (for auto-price button)
  const zeroPriceCount = items.filter((item: any) => !Number(item.unit_price)).length;
  const yetToFinalizeCount = statusCounts['yet_to_finalize'] ?? 0;

  return (
    <div className="space-y-4">
      {/* Completed banner */}
      {isBoqCompleted && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <p className="text-sm font-medium text-green-800">BOQ Budget Analysis Completed</p>
        </div>
      )}

      {/* Final Summary (5-card layout: Project Cost, Material, Site Expenses, Total, Margin) */}
      <BoqFinalSummary
        projectId={projectId}
        contractedValue={contractedValue}
        projectCostManual={projectCostManual}
        boqTotal={totalValue}
        siteExpensesApproved={approvedSiteExpenses}
        estimatedSiteExpensesBudget={estimatedSiteExpensesBudget}
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

      {/* Category-wise Breakdown */}
      {uniqueCategories.length > 1 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-semibold text-[#7C818E] uppercase tracking-wide">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-n-200 bg-[#F8F9FA]">
                    <th className="px-3 py-1.5 text-left font-medium text-[#7C818E]">Category</th>
                    <th className="px-3 py-1.5 text-right font-medium text-[#7C818E]">Items</th>
                    <th className="px-3 py-1.5 text-right font-medium text-[#7C818E]">Subtotal (excl. GST)</th>
                    <th className="px-3 py-1.5 text-right font-medium text-[#7C818E]">Subtotal (incl. GST)</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueCategories.map((cat) => {
                    const totals = categoryTotals[cat];
                    if (!totals) return null;
                    return (
                      <tr key={cat} className="border-b border-n-100 hover:bg-[#F8F9FA]">
                        <td className="px-3 py-1.5 font-medium text-[#1A1D24]">{getCategoryLabel(cat)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[#7C818E]">{totals.count}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[#3F424D]">{formatINR(totals.totalWithoutGst)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-medium text-[#1A1D24]">{formatINR(totals.totalWithGst)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-n-200 bg-[#F8F9FA]">
                    <td className="px-3 py-1.5 font-bold text-[#1A1D24]">Total</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">{items.length}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">{formatINR(totalWithoutGst)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">{formatINR(totalValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">BOQ &mdash; Budget Analysis</CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Category filter */}
            <BoqCategoryFilterWrapper categories={uniqueCategories} />

            {/* Action buttons */}
            <ApplyPriceBookButton projectId={projectId} zeroPriceCount={zeroPriceCount} />
            <SendToPurchaseButton projectId={projectId} yetToFinalizeCount={yetToFinalizeCount} />

            <span className="text-sm font-mono text-[#7C818E]">{items.length} items &middot; {formatINR(totalValue)}</span>
            {!isBoqCompleted && <BoqCompleteButton projectId={projectId} isCompleted={false} />}
            <Link href={`/projects/${projectId}?tab=delivery`}>
              <Button size="sm" variant="ghost" className="text-xs">
                Continue to Delivery &rarr;
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" id="boq-table">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[30px]">#</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[140px]">Category</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500">Description</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[80px]">Brand</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[60px]">Qty</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[80px]">Rate</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[50px]">GST%</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[90px]">Amt (excl.)</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium text-n-500 w-[90px]">Total (incl.)</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[110px]">Status</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any) => {
                  const qty = Number(item.quantity || 0);
                  const rate = Number(item.unit_price || 0);
                  const amtWithoutGst = qty * rate;

                  return (
                    <tr key={item.id} className="border-b border-n-100 hover:bg-n-50 group boq-row" data-category={item.item_category}>
                      <td className="px-2 py-1.5 font-mono text-n-400">{item.line_number}</td>
                      <td className="px-2 py-1.5 font-medium text-n-900">{getCategoryLabel(item.item_category)}</td>
                      <td className="px-2 py-1.5 text-n-700">{item.item_description}</td>
                      <td className="px-2 py-1.5 text-n-500">
                        {[item.brand, item.model].filter(Boolean).join(' ') || '\u2014'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        <BoqInlineEdit
                          projectId={projectId}
                          itemId={item.id}
                          field="quantity"
                          currentValue={qty}
                        />
                        <span className="text-[10px] text-n-400 ml-0.5">{item.unit}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <BoqInlineEdit
                          projectId={projectId}
                          itemId={item.id}
                          field="unit_price"
                          currentValue={rate}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <BoqInlineEdit
                          projectId={projectId}
                          itemId={item.id}
                          field="gst_rate"
                          currentValue={Number(item.gst_rate)}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-n-500">
                        {formatINR(amtWithoutGst)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-medium">{formatINR(Number(item.total_price))}</td>
                      <td className="px-2 py-1.5">
                        <BoqItemStatusSelect
                          projectId={projectId}
                          itemId={item.id}
                          currentStatus={item.procurement_status}
                        />
                      </td>
                      <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <td colSpan={7} className="px-2 py-2.5 text-right font-bold text-n-900 text-[12px]">Grand Total</td>
                  <td className="px-2 py-2.5 text-right font-mono font-bold text-n-700">{formatINR(totalWithoutGst)}</td>
                  <td className="px-2 py-2.5 text-right font-mono font-bold text-n-900 text-sm">{formatINR(totalValue)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Site Expenses Info Banner */}
      {(approvedSiteExpenses > 0 || estimatedSiteExpensesBudget > 0) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
          <Package className="h-4 w-4 shrink-0" />
          <span>
            Site Expenses ({approvedSiteExpenses > 0 ? 'approved' : 'estimated'}): <strong>{formatINR(approvedSiteExpenses > 0 ? approvedSiteExpenses : estimatedSiteExpensesBudget)}</strong>
            {' '}&mdash; included in margin calculation above.
            {approvedSiteExpenses === 0 && estimatedSiteExpensesBudget > 0 && (
              <span className="text-[11px] text-amber-600"> Double-click the Site Expenses card to edit the estimate.</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
