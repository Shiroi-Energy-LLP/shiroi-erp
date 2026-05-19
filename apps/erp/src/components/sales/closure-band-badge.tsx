import { Badge } from '@repo/ui';
import type { Band, DataQuality } from '@/lib/closure-helpers';

/**
 * Visual indicator for where a lead sits in the discount band at closure.
 *
 * Thresholds (per plan D4 and closure-actions.ts):
 *   green  ≥ 10%  → Prem approves alone
 *   amber  8-10%  → Founder approval required
 *   red    < 8%   → won blocked, renegotiate or mark Lost
 *
 * dataQuality modifies the display when cost/price inputs are missing (B2).
 */
export function ClosureBandBadge({
  band,
  grossMargin,
  dataQuality = 'ok',
  size = 'md',
}: {
  band: Band;
  grossMargin: number | null;
  dataQuality?: DataQuality;
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

  const marginText =
    grossMargin !== null ? ` • ${grossMargin.toFixed(1)}%` : '';

  // Tooltip / title for data-quality issues
  const qualityTitles: Partial<Record<DataQuality, string>> = {
    no_bom_cost: 'BOM cost not captured — margin not computed',
    no_base_price: 'No base quote price set — margin not computed',
    no_data: 'Neither price nor BOM cost available — treating as unprofitable',
  };
  const qualityTitle = qualityTitles[dataQuality];

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={variants[band]} className={sizeClasses}>
        {labels[band]}{marginText}
      </Badge>
      {qualityTitle && (
        <span
          title={qualityTitle}
          className="cursor-help text-xs text-n-400 select-none"
          aria-label={qualityTitle}
        >
          ⓘ
        </span>
      )}
      {dataQuality === 'no_bom_cost' && (
        <span className="text-xs text-amber-600 italic">BOM cost not captured — margin not computed</span>
      )}
      {dataQuality === 'no_base_price' && (
        <span className="text-xs text-red-600 italic">No base quote price set</span>
      )}
    </div>
  );
}

/**
 * Read-only copy that explains what a given band means. Surfaced in the Quote
 * tab and the /sales/[id] closure_soon stage UI.
 */
export function ClosureBandHelper({ band, dataQuality = 'ok' }: { band: Band; dataQuality?: DataQuality }) {
  if (dataQuality === 'no_bom_cost') {
    return (
      <p className="text-xs text-amber-700">
        BOM cost data is not captured for this lead. Cannot compute gross margin — the band is set to green
        so the Won transition is not blocked. Verify pricing with the team before closing.
      </p>
    );
  }
  if (dataQuality === 'no_base_price') {
    return (
      <p className="text-xs text-red-700">
        No base quote price is set on this lead. Cannot compute gross margin — Won is blocked until a price
        is entered.
      </p>
    );
  }
  if (dataQuality === 'no_data') {
    return (
      <p className="text-xs text-red-700">
        Neither a base price nor BOM cost is available. Cannot assess profitability — Won is blocked.
      </p>
    );
  }
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
