import { Badge } from '@repo/ui';
import type { Database } from '@repo/types/database';

type DelayResponsibility = Database['public']['Enums']['delay_responsibility'];

const RESPONSIBILITY_VARIANT: Record<DelayResponsibility, 'info' | 'pending' | 'warning' | 'success' | 'error' | 'neutral'> = {
  shiroi: 'error',
  client: 'warning',
  vendor: 'pending',
  discom: 'info',
  weather: 'neutral',
  ceig: 'info',
  other: 'neutral',
};

const RESPONSIBILITY_LABEL: Record<DelayResponsibility, string> = {
  shiroi: 'Shiroi',
  client: 'Client',
  vendor: 'Vendor',
  discom: 'DISCOM',
  weather: 'Weather',
  ceig: 'CEIG',
  other: 'Other',
};

export function DelayResponsibilityBadge({ responsibility }: { responsibility: DelayResponsibility }) {
  return (
    <Badge variant={RESPONSIBILITY_VARIANT[responsibility]}>
      {RESPONSIBILITY_LABEL[responsibility]}
    </Badge>
  );
}
