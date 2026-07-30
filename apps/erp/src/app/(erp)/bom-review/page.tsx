/**
 * /bom-review — review and fix BOM line items across all proposals.
 *
 * Converted to ListPageShell so the category filter bar and the table header
 * stay frozen while rows scroll, and the table no longer needs its own
 * horizontal scroller — every column wraps instead.
 *
 * NEVER-DO compliance:
 * - #13: count:'estimated' on proposal_bom_lines (~24.7k rows).
 * - #15: reads live in bom-review-queries.ts, not inline in the page.
 * - #21: the client table imports labels from bom-review-constants.ts.
 * - #25: paginated via count + .range(), never a bare .limit().
 */

import Link from 'next/link';
import { Card, CardContent, EmptyState } from '@repo/ui';
import { ListChecks, Upload } from 'lucide-react';
import { ListPageShell } from '@/components/list-page-shell';
import { getBomReviewSummary, getBomReviewLines } from '@/lib/bom-review-queries';
import { bomCategoryLabel } from '@/lib/bom-review-constants';
import { BomReviewTable } from './bom-review-table';

export const metadata = { title: 'BOM Review' };

const PER_PAGE = 100;

interface PageProps {
  searchParams: Promise<{ category?: string; proposal_id?: string; page?: string }>;
}

export default async function BomReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const categoryFilter = params.category ?? '';
  const proposalFilter = params.proposal_id ?? '';
  const page = Math.max(1, parseInt(params.page ?? '1', 10));

  const [summary, { lines, filteredCount }] = await Promise.all([
    getBomReviewSummary(),
    getBomReviewLines({
      category: categoryFilter || undefined,
      proposalId: proposalFilter || undefined,
      page,
      perPage: PER_PAGE,
    }),
  ]);

  const totalPages = Math.ceil(filteredCount / PER_PAGE);

  function pageUrl(p: number) {
    const q = new URLSearchParams();
    if (categoryFilter) q.set('category', categoryFilter);
    if (proposalFilter) q.set('proposal_id', proposalFilter);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/bom-review${qs ? `?${qs}` : ''}`;
  }

  function categoryUrl(cat: string) {
    const q = new URLSearchParams();
    if (cat) q.set('category', cat);
    if (proposalFilter) q.set('proposal_id', proposalFilter);
    const qs = q.toString();
    return `/bom-review${qs ? `?${qs}` : ''}`;
  }

  const chipBase = 'rounded-full px-3 py-1 text-xs font-medium transition-colors';
  const chipOn = 'bg-shiroi-gold text-shiroi-ink';
  const chipOff = 'bg-n-100 text-n-600 hover:bg-n-200';

  return (
    <ListPageShell
      header={
        <div className="flex items-start justify-between gap-4">
          {/* Category chips — frozen with the header band */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="text-xs text-n-500">Category:</span>
            <Link
              href={categoryUrl('')}
              className={`${chipBase} ${!categoryFilter ? chipOn : chipOff}`}
            >
              All ({summary.total.toLocaleString('en-IN')})
            </Link>
            {Object.entries(summary.category_counts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([cat, count]) => (
                <Link
                  key={cat}
                  href={categoryUrl(cat)}
                  className={`${chipBase} ${categoryFilter === cat ? chipOn : chipOff}`}
                >
                  {bomCategoryLabel(cat)} ({count.toLocaleString('en-IN')})
                </Link>
              ))}
          </div>
          <Link
            href="/bom-review/import"
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md bg-shiroi-gold px-3 text-xs font-medium text-shiroi-ink hover:bg-shiroi-gold/90"
          >
            <Upload className="h-3.5 w-3.5" />
            Import from Excel
          </Link>
        </div>
      }
    >
      <div className="space-y-1">
        <h1 className="text-lg font-heading font-bold text-n-950">
          BOM Line Items Review{' '}
          <span className="text-sm font-normal text-n-500">
            ({filteredCount.toLocaleString('en-IN')} lines)
          </span>
        </h1>
        <p className="text-sm text-n-500">
          Review and fix BOM data across all proposals. Double-click any cell to edit.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-n-950">
              {summary.total.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-n-500">Total BOM Lines</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-green-600">
              {summary.with_rate.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-n-500">With Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-orange-600">
              {summary.no_rate.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-n-500">Missing Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-red-600">
              {summary.flagged.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-n-500">Flagged Items</p>
          </CardContent>
        </Card>
      </div>

      {/* BOM Table */}
      <Card>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-12 w-12" />}
              title="No BOM lines found"
              description={
                categoryFilter
                  ? `No items in category "${bomCategoryLabel(categoryFilter)}"`
                  : 'No BOM line items in the database.'
              }
            />
          ) : (
            <BomReviewTable data={lines} startIndex={(page - 1) * PER_PAGE} />
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pb-2">
          {page > 1 && (
            <Link href={pageUrl(page - 1)} className="rounded bg-n-100 px-3 py-1 text-sm hover:bg-n-200">
              Previous
            </Link>
          )}
          <span className="text-sm text-n-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageUrl(page + 1)} className="rounded bg-n-100 px-3 py-1 text-sm hover:bg-n-200">
              Next
            </Link>
          )}
        </div>
      )}
    </ListPageShell>
  );
}
