// apps/erp/src/app/(erp)/data-review/projects/page.tsx
// Server-rendered: fetches counts + first page of rows, hands off to
// <DataReviewShell> for the client-side tabs/search/pagination.

import { Suspense } from 'react';
import { Breadcrumb } from '@repo/ui';
import {
  listProjectsForReview,
  getProjectReviewCounts,
  type ReviewTab,
} from '@/lib/data-review-queries';
import { DataReviewShell } from './_components/data-review-shell';

export const metadata = { title: 'Project Data Review' };

interface SearchParams {
  tab?: string;
  page?: string;
  search?: string;
}

export default async function DataReviewProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tab = (['needs_review', 'all', 'confirmed', 'duplicates', 'audit'].includes(
    params.tab ?? '',
  )
    ? params.tab
    : 'needs_review') as ReviewTab;
  const page = Math.max(0, Number(params.page ?? '0'));
  const search = params.search ?? '';

  // The audit tab doesn't need a project listing — AuditLogTab fetches its own data client-side.
  const listingTab: Exclude<ReviewTab, 'audit'> =
    tab === 'audit' ? 'needs_review' : tab;

  const [counts, listing] = await Promise.all([
    getProjectReviewCounts(),
    listProjectsForReview({ tab: listingTab, page, pageSize: 50, search }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[{ label: 'Data Review', href: '/data-review/projects' }, { label: 'Projects' }]}
      />
      <div>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Project Data Review</h1>
        <p className="text-sm text-[#7C818E]">
          Confirm system size + order value for all {counts.all_projects} projects. One-time sweep.
        </p>
      </div>

      <Suspense fallback={<div className="p-6 text-sm text-[#7C818E]">Loading…</div>}>
        <DataReviewShell
          tab={tab}
          counts={counts}
          rows={listing.rows}
          totalRows={listing.totalRows}
          page={page}
          pageSize={50}
          search={search}
        />
      </Suspense>
    </div>
  );
}
