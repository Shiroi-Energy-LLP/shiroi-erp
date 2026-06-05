import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@repo/ui';
import { Upload } from 'lucide-react';
import { listPendingImports, getImportSummary, type ListFilters } from '@/lib/import-review-queries';
import { ImportReviewList } from './_components/import-review-list';
import { FilterBar } from '@/components/filter-bar';
import { FilterSelect } from '@/components/filter-select';
import { SearchInput } from '@/components/search-input';

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'imported', label: 'Imported' },
  { value: 'error', label: 'Errors' },
];

const MATCH_OPTIONS = [
  { value: '', label: 'All matches' },
  { value: 'exact', label: 'Exact match' },
  { value: 'fuzzy', label: 'Fuzzy match' },
  { value: 'none', label: 'No match' },
];

const SOURCE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Running', label: 'Running' },
  { value: 'On Progress', label: 'On Progress' },
  { value: 'Waiting for Net Meter', label: 'Waiting for Net Meter' },
  { value: 'Holding from client', label: 'Holding from client' },
  { value: 'Holding from Shiroi', label: 'Holding from Shiroi' },
  { value: 'Yet to Start', label: 'Yet to Start' },
];

const YEAR_OPTIONS = [
  { value: '', label: 'All years' },
  { value: '2022', label: '2022' },
  { value: '2023', label: '2023' },
  { value: '2024', label: '2024' },
  { value: '2025', label: '2025' },
  { value: '2026', label: '2026' },
];

const BRAND_OPTIONS = [
  { value: '', label: 'All brands' },
  { value: 'deye', label: 'Deye' },
  { value: 'goodwe', label: 'Goodwe' },
  { value: 'fimer', label: 'Fimer' },
  { value: 'growatt', label: 'Growatt' },
  { value: 'sungrow', label: 'Sungrow' },
  { value: 'polycab', label: 'Polycab' },
  { value: 'fronius', label: 'Fronius' },
  { value: 'havells', label: 'Havells' },
  { value: 'flin_energy', label: 'Flin Energy' },
];

interface PageProps {
  searchParams: Promise<{
    status?: string;
    match?: string;
    source_status?: string;
    year?: string;
    brand?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function ImportReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentStatus = params.status || 'pending';
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const filters: ListFilters = {
    status_review: currentStatus,
    match_confidence: params.match || undefined,
    source_status: params.source_status || undefined,
    source_year: params.year ? Number(params.year) : undefined,
    portal_brand: params.brand || undefined,
    search: params.search || undefined,
    page: currentPage,
    per_page: perPage,
  };

  const [{ items, total }, summary] = await Promise.all([
    listPendingImports(filters),
    getImportSummary(),
  ]);

  const totalPages = Math.ceil(total / perPage);

  function tabUrl(status: string) {
    return `/om/import-review?status=${status}`;
  }
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (currentStatus !== 'pending') p.set('status', currentStatus);
    if (params.match) p.set('match', params.match);
    if (params.source_status) p.set('source_status', params.source_status);
    if (params.year) p.set('year', params.year);
    if (params.brand) p.set('brand', params.brand);
    if (params.search) p.set('search', params.search);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/om/import-review${qs ? `?${qs}` : ''}`;
  }

  function statusCount(s: string): number {
    switch (s) {
      case 'pending': return summary.pending;
      case 'approved': return summary.approved;
      case 'rejected': return summary.rejected;
      case 'imported': return summary.imported;
      case 'error': return summary.errors;
      default: return 0;
    }
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Import Review{' '}
            <span className="text-sm font-normal text-n-500">({total} in {currentStatus})</span>
          </h1>
          <p className="text-xs text-n-500 mt-0.5">
            Historical-plant candidates staged from XLSX masters. Approve to create projects + inverters + monitoring credentials.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Pending review</div>
            <div className="text-2xl font-heading font-bold text-n-900 mt-1">{summary.pending}</div>
            <div className="text-[10px] text-n-500 mt-0.5">{summary.completed_pending} Status=Completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Already in DB (exact)</div>
            <div className="text-2xl font-heading font-bold text-n-900 mt-1">{summary.exact_pending}</div>
            <div className="text-[10px] text-n-500 mt-0.5">Confirm matches</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Likely matches (fuzzy)</div>
            <div className="text-2xl font-heading font-bold text-amber-600 mt-1">{summary.fuzzy_pending}</div>
            <div className="text-[10px] text-n-500 mt-0.5">Needs your eyeball</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Imported</div>
            <div className="text-2xl font-heading font-bold text-[#00B050] mt-1">{summary.imported}</div>
            {summary.errors > 0 && (
              <div className="text-[10px] text-red-600 mt-0.5">{summary.errors} errors</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-n-200">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabUrl(tab.value)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              currentStatus === tab.value
                ? 'border-[#00B050] text-[#00B050]'
                : 'border-transparent text-n-500 hover:text-n-900'
            }`}
          >
            {tab.label} · {statusCount(tab.value)}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/om/import-review" filterParams={['search', 'match', 'source_status', 'year', 'brand']}>
            <FilterSelect paramName="match" className="w-36 text-xs h-8">
              {MATCH_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </FilterSelect>
            <FilterSelect paramName="source_status" className="w-44 text-xs h-8">
              {SOURCE_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </FilterSelect>
            <FilterSelect paramName="year" className="w-24 text-xs h-8">
              {YEAR_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </FilterSelect>
            <FilterSelect paramName="brand" className="w-32 text-xs h-8">
              {BRAND_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </FilterSelect>
            <SearchInput placeholder="Search name/phone/email/portal user..." className="w-72 h-8 text-xs" />
          </FilterBar>
        </CardContent>
      </Card>

      {/* List */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Upload className="h-10 w-10 text-n-300 mb-3" />
            <h2 className="text-sm font-heading font-bold text-n-700">Nothing in {currentStatus}</h2>
            <p className="text-xs text-n-500 max-w-[420px] mt-1">
              {currentStatus === 'pending'
                ? 'No pending imports match your current filters. Adjust filters or check other tabs.'
                : `No rows in the ${currentStatus} state yet.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ImportReviewList items={items} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-n-500">
          <div>
            Showing {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, total)} of {total}
          </div>
          <div className="flex gap-1">
            {currentPage > 1 && (
              <Link href={pageUrl(currentPage - 1)} className="px-3 py-1 border border-n-200 rounded hover:bg-n-50">Previous</Link>
            )}
            <span className="px-2 py-1">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link href={pageUrl(currentPage + 1)} className="px-3 py-1 border border-n-200 rounded hover:bg-n-50">Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
