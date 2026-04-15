import { Badge } from '@repo/ui';
import type { Band } from '@/lib/closure-actions';

/**
 * Visual indicator for where a lead sits in the discount band at closure.
 *
 * Thresholds (per plan D4 and closure-actions.ts):
 *   green  ≥ 10%  → Prem approves alone
 *   amber  8-10%  → Founder approval required
 *   red    < 8%   → won blocked, renegotiate or mark Lost
 */
export function ClosureBandBadge({
  band,
  grossMargin,
  size = 'md',
}: {
  band: Band;
  grossMargin: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants: Record<Band, 'success' | 'warning' | 'error'> = {
    green: 'success',
    amber: 'warning',
    red: 'error',
  };

  const labels: Record<Band, string> = {
    green: 'Green band',
    amber: 'Amber band',
    red: 'Red band',
  };

  const sizeClasses =
    size === 'lg' ? 'text-sm px-3 py-1' : size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <Badge variant={variants[band]} className={sizeClasses}>
      {labels[band]} • {grossMargin.toFixed(1)}%
    </Badge>
  );
}

/**
 * Read-only copy that explains what a given band means. Surfaced in the Quote
 * tab and the /sales/[id] closure_soon stage UI.
 */
export function ClosureBandHelper({ band }: { band: Band }) {
  if (band === 'green') {
    return (
      <p className="text-xs text-green-700">
        Gross margin is healthy. Prem can approve and flip the lead to Won with a single click.
      </p>
    );
  }
  if (band === 'amber') {
    return (
      <p className="text-xs text-amber-700">
        Margin is below the 10% threshold but above the 8% floor. Founder approval required —
        clicking Won creates a pending approval request and notifies Vivek.
      </p>
    );
  }
  return (
    <p className="text-xs text-red-700">
      Margin is below the 8% floor. The Won transition is blocked. Either negotiate the price up
      or mark this lead as Lost.
    </p>
  );
}
