import { AlertTriangle } from 'lucide-react';

type Props = {
  financialsInvalidated: boolean;
  systemSizeUncertain: boolean;
  reason: string | null;
  storedTotal: number | null;
  systemSizeKwp: number | null;
};

export function ProposalDataQualityBanner({
  financialsInvalidated,
  systemSizeUncertain,
  reason,
  storedTotal,
  systemSizeKwp,
}: Props) {
  // Compute the soft-trigger: even without flags, surface a banner if the stored
  // per-kWp is implausibly high (catches the Tier B cases not covered by the Tier A reset).
  const perKwp =
    storedTotal && systemSizeKwp && systemSizeKwp > 0
      ? Number(storedTotal) / Number(systemSizeKwp)
      : 0;
  const softTrigger = perKwp > 200_000 && !financialsInvalidated;

  if (!financialsInvalidated && !systemSizeUncertain && !softTrigger) return null;

  let title: string;
  let body: string;
  if (financialsInvalidated && systemSizeUncertain) {
    title = 'Financials and system size both need re-verification';
    body =
      'This proposal was reset by the 2026-04-30 data cleanup. Re-confirm both the kWp size and the price before sending.';
  } else if (financialsInvalidated) {
    title = 'Financials need re-quoting';
    body =
      'This proposal was reset by the 2026-04-30 data cleanup. Re-quote before sending.';
  } else if (systemSizeUncertain) {
    title = 'System size uncertain';
    body =
      'The kWp size on this proposal could not be corroborated against the lead or project. Verify before relying on it.';
  } else {
    title = 'Total looks unusually high';
    body = `Stored total works out to ₹${Math.round(perKwp / 1000)}K/kWp, which is unusually high. Verify before sending.`;
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm">{body}</div>
        {reason && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer">Audit details</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words">{reason}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
