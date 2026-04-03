import { Badge } from '@repo/ui';

type POStatus = 'draft' | 'approved' | 'partially_delivered' | 'fully_delivered' | 'cancelled';

const STATUS_VARIANT: Record<POStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  draft: 'neutral',
  approved: 'info',
  partially_delivered: 'warning',
  fully_delivered: 'success',
  cancelled: 'error',
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  partially_delivered: 'Partially Delivered',
  fully_delivered: 'Fully Delivered',
  cancelled: 'Cancelled',
};

export function POStatusBadge({ status }: { status: string }) {
  const poStatus = status as POStatus;
  return (
    <Badge variant={STATUS_VARIANT[poStatus] ?? 'neutral'}>
      {STATUS_LABEL[poStatus] ?? status}
    </Badge>
  );
}
