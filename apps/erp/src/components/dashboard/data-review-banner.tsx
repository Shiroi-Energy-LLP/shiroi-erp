// apps/erp/src/components/dashboard/data-review-banner.tsx
// Banner for /dashboard showing pending project data-review count.
// Auto-hides at 0. Per-request fetch (no unstable_cache — see the /cash
// crash post-mortem in CHANGELOG 2026-05-02: unstable_cache + createClient()
// are incompatible because createClient reads cookies() at render time).

import Link from 'next/link';
import { getProjectReviewCounts } from '@/lib/data-review-queries';

export async function DataReviewBanner() {
  const counts = await getProjectReviewCounts();
  if (counts.needs_review === 0) return null;
  return (
    <div className="mb-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <span>
        ⚠ {counts.needs_review} project{counts.needs_review !== 1 ? 's' : ''} need a quick data
        review — system size + order value verification
      </span>
      <Link href="/data-review/projects" className="ml-4 shrink-0 font-medium underline">
        Open triage →
      </Link>
    </div>
  );
}
