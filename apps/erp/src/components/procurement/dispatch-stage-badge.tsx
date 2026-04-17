/**
 * DispatchStageBadge — 4-stage dispatch lifecycle badge driven by the generated
 * `purchase_orders.dispatch_stage` column (migration 065).
 *
 * The column derives from timestamps:
 *   acknowledged_at IS NOT NULL          → 'received'
 *   vendor_tracking_number IS NOT NULL   → 'in_transit'
 *   vendor_dispatch_date IS NOT NULL     → 'shipped'
 *   sent_to_vendor_at IS NOT NULL        → 'draft'   (PO sent to vendor but nothing else yet)
 *   otherwise                            → NULL     (PO not yet sent to vendor)
 *
 * We purposely keep the label distinct from the PO `status` enum — this is the
 * logistics view, not the approval/commercial state.
 */

import { Badge } from '@repo/ui';

type DispatchStage = 'draft' | 'shipped' | 'in_transit' | 'received';

const STAGE_VARIANT: Record<DispatchStage, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral' | 'outline'> = {
  draft: 'neutral',
  shipped: 'pending',
  in_transit: 'info',
  received: 'success',
};

const STAGE_LABEL: Record<DispatchStage, string> = {
  draft: 'Sent to vendor',
  shipped: 'Vendor shipped',
  in_transit: 'In transit',
  received: 'Received',
};

export function DispatchStageBadge({ stage }: { stage: string | null | undefined }) {
  if (!stage) {
    return <span className="text-[10px] text-n-400">—</span>;
  }
  const s = stage as DispatchStage;
  return (
    <Badge variant={STAGE_VARIANT[s] ?? 'neutral'}>
      {STAGE_LABEL[s] ?? stage}
    </Badge>
  );
}
