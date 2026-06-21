import Link from 'next/link';
import { Card, CardContent, Eyebrow } from '@repo/ui';
import { FileSpreadsheet } from 'lucide-react';
import { getUserProfile } from '@/lib/auth';
import {
  getBomImports,
  getBomImportStats,
  getProjectsForPicker,
  type BomImportFilters,
} from '@/lib/bom-import-queries';
import { BOM_IMPORT_STATUS_TABS } from '@/lib/bom-import-constants';
import { BomUploadDialog } from './_components/bom-upload-dialog';
import { BomImportList } from './_components/bom-import-list';
import { FilterBar } from '@/components/filter-bar';
import { SearchInput } from '@/components/search-input';

export const metadata = { title: 'BOM Import' };

const ALLOWED = new Set(['founder', 'project_manager']);

interface PageProps {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}

export default async function BomImportPage({ searchParams }: PageProps) {
  const profile = await getUserProfile();
  if (!profile || !ALLOWED.has(profile.role)) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <h1 className="text-sm font-heading font-bold text-n-700">Not available</h1>
          <p className="text-xs text-n-500 mt-1">BOM import is restricted to the founder and project managers.</p>
        </CardContent>
      </Card>
    );
  }

  const params = await searchParams;
  const currentStatus = params.status || 'pending';
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const filters: BomImportFilters = {
    status_review: currentStatus,
    search: params.search || undefined,
    page: currentPage,
    per_page: perPage,
  };

  const [{ items, total }, stats, projects] = await Promise.all([
    getBomImports(filters),
    getBomImportStats(),
    getProjectsForPicker(),
  ]);

  const totalPages = Math.ceil(total / perPage);

  function statusCount(s: string): number {
    switch (s) {
      case 'pending': return stats.pending;
      case 'imported': return stats.imported;
      case 'rejected': return stats.rejected;
      case 'error': return stats.error;
      default: return 0;
    }
  }
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (currentStatus !== 'pending') p.set('status', currentStatus);
    if (params.search) p.set('search', params.search);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/bom-review/import${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow className="mb-1">BOM REVIEW</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-n-950">BOM Import</h1>
          <p className="text-sm text-n-500">
            Upload per-project BOM sheets, confirm the project match, then import the lines
            (contracted + actual + voucher) into the project&apos;s procurement BOM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/bom-review" className="text-xs text-n-500 hover:text-n-900 underline">← Line review</Link>
          <BomUploadDialog />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="py-3"><div className="text-xs text-n-500 uppercase tracking-wider">Pending</div><div className="text-2xl font-heading font-bold text-n-900 mt-1">{stats.pending}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-n-500 uppercase tracking-wider">Exact / Fuzzy / None</div><div className="text-2xl font-heading font-bold text-n-900 mt-1">{stats.exact_pending}<span className="text-amber-600"> / {stats.fuzzy_pending}</span><span className="text-n-400"> / {stats.none_pending}</span></div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-n-500 uppercase tracking-wider">Imported</div><div className="text-2xl font-heading font-bold text-[#16A34A] mt-1">{stats.imported}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-n-500 uppercase tracking-wider">Errors</div><div className="text-2xl font-heading font-bold text-red-600 mt-1">{stats.error}</div></CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-n-200">
        {BOM_IMPORT_STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/bom-review/import?status=${tab.value}`}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              currentStatus === tab.value
                ? 'border-shiroi-gold text-shiroi-gold-dark'
                : 'border-transparent text-n-500 hover:text-n-900'
            }`}
          >
            {tab.label} · {statusCount(tab.value)}
          </Link>
        ))}
      </div>

      {/* Search */}
      <Card><CardContent className="py-3">
        <FilterBar basePath="/bom-review/import" filterParams={['search']}>
          <SearchInput placeholder="Search project / sheet name…" className="w-72 h-8 text-xs" />
        </FilterBar>
      </CardContent></Card>

      {/* List */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileSpreadsheet className="h-10 w-10 text-n-300 mb-3" />
            <h2 className="text-sm font-heading font-bold text-n-700">Nothing in {currentStatus}</h2>
            <p className="text-xs text-n-500 max-w-[420px] mt-1">
              {currentStatus === 'pending'
                ? 'Upload a BOM workbook to stage sheets for review.'
                : `No rows in the ${currentStatus} state yet.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <BomImportList items={items} projects={projects} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-n-500">
          <div>Showing {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, total)} of {total}</div>
          <div className="flex gap-1">
            {currentPage > 1 && <Link href={pageUrl(currentPage - 1)} className="px-3 py-1 border border-n-200 rounded hover:bg-n-50">Previous</Link>}
            <span className="px-2 py-1">Page {currentPage} of {totalPages}</span>
            {currentPage < totalPages && <Link href={pageUrl(currentPage + 1)} className="px-3 py-1 border border-n-200 rounded hover:bg-n-50">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
