import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getBoiState, getBoisForProject, getBoiItems, getStepBoqData } from '@/lib/project-stepper-queries';
import { Package, Lock, CheckCircle2, Clock, Send } from 'lucide-react';
import {
  BoiInlineAddRow, BoiDeleteButton,
  BoiSubmitButton, BoiApproveButton, BoiLockVersionButton, CreateNewBoiButton,
  BoiEditButton, BoiItemHistoryButton,
} from '@/components/projects/forms/bom-line-form';
import { BoqSeedButton } from '@/components/projects/forms/boq-variance-form';
import { getCategoryLabel } from '@/lib/boi-constants';
import { getItemSuggestions } from '@/lib/item-suggestions-queries';
import { listItemCategories, listItemUnits } from '@/lib/item-catalog-queries';
import { BoiCategoryFilter } from '@/components/projects/forms/boi-category-filter';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import Link from 'next/link';

interface StepBomProps {
  projectId: string;
}

function BoiStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'locked':
      return <Badge variant="default" className="text-[10px]"><Lock className="h-3 w-3 mr-1" /> Locked</Badge>;
    case 'approved':
      return <Badge variant="success" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>;
    case 'submitted':
      return <Badge variant="pending" className="text-[10px]"><Send className="h-3 w-3 mr-1" /> Submitted</Badge>;
    case 'draft':
    default:
      return <Badge variant="neutral" className="text-[10px]"><Clock className="h-3 w-3 mr-1" /> Draft</Badge>;
  }
}

export async function StepBom({ projectId }: StepBomProps) {
  const [bois, boiState, boqData, suggestions, viewerRole, itemCategories, itemUnits] = await Promise.all([
    getBoisForProject(projectId),
    getBoiState(projectId),
    getStepBoqData(projectId),
    getItemSuggestions(),
    getCurrentUserRoleForProject(),
    listItemCategories(),
    listItemUnits(),
  ]);
  const catalogCategories = itemCategories.map((c) => ({ value: c.value, label: c.label }));
  const catalogUnits = itemUnits.map((u) => u.value);
  const canManageItems = !!viewerRole && ['founder', 'project_manager'].includes(viewerRole);

  const hasProposal = !!(boiState as any)?.proposal_id;
  const hasAnyBoi = bois.length > 0;

  // If no BOIs exist yet, show create option or seed from BOM
  if (!hasAnyBoi) {
    // Check if there are legacy items without a BOI
    const legacyItems = boqData.type === 'items' ? boqData.items : [];

    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-12">
          <Package className="w-12 h-12 text-n-500 opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-n-950 mb-1">No Bill of Items</h3>
          <p className="text-[13px] text-n-500 max-w-md text-center mb-4">
            {hasProposal
              ? 'Generate BOI from the linked proposal BOM, or create a new BOI manually.'
              : 'Create a new BOI to start adding items for this project.'}
          </p>
          <div className="flex items-center gap-3">
            {hasProposal && (
              <BoqSeedButton projectId={projectId} hasBomLines={true} hasVariances={false} />
            )}
            <CreateNewBoiButton projectId={projectId} />
          </div>
        </div>
        {legacyItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-n-500">Legacy Items ({legacyItems.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* No overflow wrapper — every column wraps instead of scrolling. */}
              <table className="w-full table-fixed text-sm [&_td]:align-top">
                  <thead>
                    <tr className="border-b border-n-200 bg-n-50">
                      <th className="w-[22%] px-3 py-2 text-left font-medium text-n-500">Category</th>
                      <th className="px-3 py-2 text-left font-medium text-n-500">Item</th>
                      <th className="w-[12%] px-3 py-2 text-right font-medium text-n-500">Qty</th>
                      <th className="w-[14%] px-3 py-2 text-left font-medium text-n-500">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacyItems.map((item: any) => (
                      <tr key={item.id} className="border-b border-n-100">
                        <td className="whitespace-normal break-words px-3 py-2">{getCategoryLabel(item.item_category)}</td>
                        <td className="whitespace-normal break-words px-3 py-2">{item.item_description}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{item.quantity}</td>
                        <td className="whitespace-normal break-words px-3 py-2">{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Pre-fetch items for ALL BOI versions in parallel (avoids async map in JSX)
  const boiItemsMap: Record<string, any[]> = {};
  const itemResults = await Promise.all(
    bois.map((boi: any) => getBoiItems(boi.id))
  );
  bois.forEach((boi: any, idx: number) => {
    boiItemsMap[boi.id] = itemResults[idx] ?? [];
  });

  // Render all BOI versions
  return (
    <div className="space-y-4">
      {/* Header with Create New BOI button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-n-950">
          Bill of Items ({bois.length} version{bois.length !== 1 ? 's' : ''})
        </h3>
        <div className="flex items-center gap-2">
          {/* Only show Create New BOI if latest BOI is locked or approved */}
          {bois.length > 0 && ['locked', 'approved'].includes(bois[bois.length - 1]?.status) && (
            <CreateNewBoiButton projectId={projectId} />
          )}
          <Link href={`/projects/${projectId}?tab=boq`}>
            <Button size="sm" variant="ghost" className="text-xs">
              Continue to BOQ &rarr;
            </Button>
          </Link>
        </div>
      </div>

      {/* Render each BOI version */}
      {bois.map((boi: any) => {
        const items = boiItemsMap[boi.id] ?? [];
        const isDraft = boi.status === 'draft';
        const isSubmitted = boi.status === 'submitted';
        const isApproved = boi.status === 'approved';
        const isLocked = boi.status === 'locked';
        const canEdit = isDraft; // Only draft BOIs can be edited
        const categories = [...new Set(items.map((i: any) => i.item_category as string))];

        return (
          <Card key={boi.id}>
            {/* BOI Header */}
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm font-bold">BOI-{boi.boi_number}</CardTitle>
                  <BoiStatusBadge status={boi.status} />
                  <span className="text-[11px] text-n-500 font-mono">{items.length} items</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Workflow buttons based on status */}
                  {isDraft && items.length > 0 && (
                    <BoiSubmitButton projectId={projectId} boiId={boi.id} />
                  )}
                  {isSubmitted && (
                    <BoiApproveButton projectId={projectId} boiId={boi.id} />
                  )}
                  {isApproved && (
                    <BoiLockVersionButton projectId={projectId} boiId={boi.id} isLocked={false} />
                  )}
                  {isLocked && (
                    <BoiLockVersionButton projectId={projectId} boiId={boi.id} isLocked={true} />
                  )}
                </div>
              </div>

              {/* Prepared By / Approved By */}
              <div className="flex items-center gap-4 mt-1.5 text-[11px] text-n-500">
                {boi.prepared_by_name && (
                  <span>Prepared: <strong className="text-n-950">{boi.prepared_by_name}</strong></span>
                )}
                {boi.approved_by_name && (
                  <span>Approved: <strong className="text-n-950">{boi.approved_by_name}</strong>
                    {boi.approved_at && ` on ${formatDate(boi.approved_at)}`}
                  </span>
                )}
                {boi.locked_by_name && (
                  <span>Locked: <strong className="text-n-950">{boi.locked_by_name}</strong>
                    {boi.locked_at && ` on ${formatDate(boi.locked_at)}`}
                  </span>
                )}
              </div>
              {isLocked && canManageItems && (
                <p className="text-[10px] text-amber-700 mt-1">
                  Locked BOI — PM edits remain possible and are recorded in the item history.
                </p>
              )}
            </CardHeader>

            <CardContent className="p-0">
              {/* Category filter (DOM-based) */}
              {categories.length > 1 && (
                <div className="px-3 py-2 border-b border-n-100">
                  <BoiCategoryFilter categories={categories} boiId={boi.id} />
                </div>
              )}

              {/* Compact BOI Table */}
              {/* No overflow wrapper — every column wraps instead of scrolling. */}
              <table className="w-full table-fixed text-sm [&_td]:align-top">
                  <thead>
                    <tr className="border-b border-n-200 bg-n-050">
                      <th className="w-[18%] px-3 py-2 text-left font-medium text-n-500">Category</th>
                      <th className="px-3 py-2 text-left font-medium text-n-500">Item Name</th>
                      <th className="w-[15%] px-3 py-2 text-left font-medium text-n-500">Make/Brand</th>
                      <th className="w-[9%] px-3 py-2 text-right font-medium text-n-500">Qty</th>
                      <th className="w-[10%] px-3 py-2 text-left font-medium text-n-500">Unit</th>
                      <th className="w-16 px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => (
                      <tr key={item.id}
                        className={`border-b border-n-100 hover:bg-n-050 group boi-row-${boi.id}`}
                        data-category={item.item_category}>
                        <td className="whitespace-normal break-words px-3 py-1.5 font-medium text-n-950">
                          {getCategoryLabel(item.item_category)}
                        </td>
                        <td className="whitespace-normal break-words px-3 py-1.5 text-n-700">{item.item_description}</td>
                        <td className="whitespace-normal break-words px-3 py-1.5 text-n-500">
                          {[item.brand, item.model].filter(Boolean).join(' ') || '\u2014'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-700">{item.quantity}</td>
                        <td className="whitespace-normal break-words px-3 py-1.5 text-n-500">{item.unit}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canManageItems && (
                              <BoiEditButton projectId={projectId} item={item} units={catalogUnits} />
                            )}
                            <BoiItemHistoryButton itemId={item.id} />
                            {canEdit && (
                              <BoiDeleteButton
                                projectId={projectId}
                                itemId={item.id}
                                label={item.item_description}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* Inline add row — only for draft BOIs */}
                    {canEdit && <BoiInlineAddRow projectId={projectId} boiId={boi.id} suggestions={suggestions} categories={catalogCategories} units={catalogUnits} />}

                    {/* Empty state */}
                    {items.length === 0 && !canEdit && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-n-500">
                          No items in this BOI.
                        </td>
                      </tr>
                    )}
                  </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {/* Info: if any BOI is approved, items flow to BOQ */}
      {bois.some((b: any) => b.status === 'approved' || b.status === 'locked') && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-[12px] text-blue-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Approved BOIs are available in the BOQ module for pricing and procurement tracking.
        </div>
      )}
    </div>
  );
}
