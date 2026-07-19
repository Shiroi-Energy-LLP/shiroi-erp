import Link from 'next/link';
import { InfoBox } from '@repo/ui';
import { getSystemSettings } from '@/lib/system-settings-queries';

/** Formats an ISO timestamp into a short human-readable relative string. */
function formatRelative(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Server component. Renders an amber warning banner when the org-wide proposal
 * gate is disabled. Returns null when the gate is enabled (no render, no cost).
 *
 * Reads system_settings on every request (no caching) — acceptable because
 * it is a single-row lookup and the banner must reflect the current state
 * immediately after a toggle.
 */
export async function ProposalGateBanner() {
  const settings = await getSystemSettings();

  // Gate enabled (or read failed) — render nothing.
  if (!settings || settings.proposal_gate_enabled) {
    return null;
  }

  const changedStr = settings.updated_at ? formatRelative(settings.updated_at) : null;
  const byStr = settings.updated_by_name ? ` by ${settings.updated_by_name}` : '';

  return (
    <InfoBox variant="warning" title="Proposal gate disabled site-wide">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p>
          Won transitions are allowed without a proposal. Re-enable in{' '}
          <Link
            href="/settings?tab=system"
            className="underline underline-offset-2 hover:opacity-80"
          >
            Settings &rarr; System
          </Link>{' '}
          when historical cleanup is complete.
          {changedStr && <> Last changed {changedStr}{byStr}.</>}
        </p>
        <Link
          href="/settings?tab=system"
          className="shrink-0 text-xs font-medium underline underline-offset-2 hover:opacity-80"
        >
          Go to Settings
        </Link>
      </div>
    </InfoBox>
  );
}
