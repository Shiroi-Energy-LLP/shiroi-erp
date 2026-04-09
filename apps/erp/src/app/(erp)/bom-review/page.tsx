import { createClient } from '@repo/supabase/server';
import Link from 'next/link';
import { Card, CardContent, Badge, Eyebrow, EmptyState } from '@repo/ui';
import { ListChecks, Flag } from 'lucide-react';
import { BomReviewTable } from './bom-review-table';

export const metadata = { title: 'BOM Review' };

interface PageProps {
  searchParams: Promise<{ category?: string; proposal_id?: string; page?: string }>;
}

export default async function BomReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const categoryFilter = params.category ?? '';
  const proposalFilter = params.proposal_id ?? '';
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const perPage = 100;

  const supabase = await createClient();

  // ── Summary stats ──
  const { count: totalCount } = await supabase
    .from('proposal_bom_lines')
    .select('*', { count: 'exact', head: true });

  const { count: withRateCount } = await supabase
    .from('proposal_bom_lines')
    .select('*', { count: 'exact', head: true })
    .gt('unit_price', 0);

  const { count: noRateCount } = await supabase
    .from('proposal_bom_lines')
    .select('*', { count: 'exact', head: true })
    .eq('unit_price', 0);

  // ── Flags count for BOM items ──
  const { count: flaggedCount } = await (supabase as any)
    .from('data_flags')
    .select('*', { count: 'exact', head: true })
    .eq('entity_type', 'bom_item')
    .is('resolved_at', null);

  // ── Category breakdown ──
  const { data: catData } = await supabase
    .from('proposal_bom_lines')
    .select('item_category');

  const categoryCounts: Record<string, number> = {};
  (catData ?? []).forEach((row: any) => {
    const cat = row.item_category ?? 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  // ── Paginated BOM lines ──
  let query = supabase
    .from('proposal_bom_lines')
    .select('*, proposals!inner(proposal_number, lead_id)', { count: 'estimated' })
    .order('item_category', { ascending: true })
    .order('line_number', { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);

  if (categoryFilter) query = query.eq('item_category', categoryFilter);
  if (proposalFilter) query = query.eq('proposal_id', proposalFilter);

  const { data: bomLines, count: filteredCount } = await query;
  const totalPages = Math.ceil((filteredCount ?? 0) / perPage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">BOM REVIEW</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">BOM Line Items Review</h1>
        <p className="text-sm text-[#7C818E]">
          Review and fix BOM data across all proposals. Double-click any cell to edit.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-[#1A1D24]">
              {(totalCount ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-[#7C818E]">Total BOM Lines</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-green-600">
              {(withRateCount ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-[#7C818E]">With Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-orange-600">
              {(noRateCount ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-[#7C818E]">Missing Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-heading font-bold text-red-600">
              {flaggedCount ?? 0}
            </p>
            <p className="text-xs text-[#7C818E]">Flagged Items</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-[#7C818E]">Category:</span>
        <Link
          href="/bom-review"
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            !categoryFilter ? 'bg-[#00B050] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({totalCount?.toLocaleString('en-IN')})
        </Link>
        {Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([cat, count]) => (
            <Link
              key={cat}
              href={`/bom-review?category=${cat}`}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                categoryFilter === cat ? 'bg-[#00B050] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat.replace(/_/g, ' ')} ({count.toLocaleString('en-IN')})
            </Link>
          ))}
      </div>

      {/* BOM Table */}
      <Card>
        <CardContent className="p-0">
          {(bomLines ?? []).length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-12 w-12" />}
              title="No BOM lines found"
              description={categoryFilter ? `No items in category "${categoryFilter.replace(/_/g, ' ')}"` : 'No BOM line items in the database.'}
            />
          ) : (
            <BomReviewTable data={bomLines ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/bom-review?page=${page - 1}${categoryFilter ? `&category=${categoryFilter}` : ''}`}
              className="px-3 py-1 rounded bg-gray-100 text-sm hover:bg-gray-200"
            >
              Previous
            </Link>
          )}
          <span className="px-3 py-1 text-sm text-[#7C818E]">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/bom-review?page=${page + 1}${categoryFilter ? `&category=${categoryFilter}` : ''}`}
              className="px-3 py-1 rounded bg-gray-100 text-sm hover:bg-gray-200"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
