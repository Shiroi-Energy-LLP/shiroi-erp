import { Badge } from '@repo/ui';

type POStatus = 'draft' | 'approved' | 'sent' | 'acknowledged' | 'partially_delivered' | 'fully_delivered' | 'closed' | 'cancelled';

const STATUS_VARIANT: Record<POStatus, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral' | 'outline'> = {
  draft: 'neutral',
  approved: 'info',
  sent: 'info',
  acknowledged: 'info',
  partially_delivered: 'warning',
  fully_delivered: 'success',
  closed: 'outline',
  cancelled: 'error',
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  partially_delivered: 'Partially Delivered',
  fully_delivered: 'Fully Delivered',
  closed: 'Closed',
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
