'use client';

// apps/erp/src/app/(erp)/data-review/projects/_components/data-review-shell.tsx
// Tabs + KPI strip + search + pagination + table/audit switcher.

import { useState, useTransition, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Input,
  Button,
} from '@repo/ui';
import { CheckCircle, Copy, Clock, Layers } from 'lucide-react';
import type { ReviewProjectRow, ProjectReviewCounts, ReviewTab } from '@/lib/data-review-queries';
import { ProjectsTable } from './projects-table';
import { AuditLogTab } from './audit-log-tab';

interface Props {
  tab: ReviewTab;
  counts: ProjectReviewCounts;
  rows: ReviewProjectRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  search: string;
}

export function DataReviewShell({
  tab,
  counts,
  rows,
  totalRows,
  page,
  pageSize,
  search,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(search);
  const [, startTransition] = useTransition();

  // Debounce helper using a simple ref-based approach
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (params: Partial<{ tab: string; page: string; search: string }>) => {
      const sp = new URLSearchParams();
      const currentTab = params.tab ?? tab;
      const currentPage = params.page ?? '0';
      const currentSearch = params.search !== undefined ? params.search : searchValue;
      if (currentTab !== 'needs_review') sp.set('tab', currentTab);
      if (currentPage !== '0') sp.set('page', currentPage);
      if (currentSearch) sp.set('search', currentSearch);
      startTransition(() => {
        router.push(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`);
      });
    },
    [router, pathname, tab, searchValue, startTransition],
  );

  const handleSearch = (value: string) => {
    setSearchValue(value);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(
      setTimeout(() => {
        navigate({ search: value, page: '0' });
      }, 300),
    );
  };

  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          bg="bg-amber-50"
          count={counts.needs_review}
          label="Needs Review"
        />
        <KpiCard
          icon={<Layers className="h-5 w-5 text-blue-600" />}
          bg="bg-blue-50"
          count={counts.all_projects}
          label="All Projects"
        />
        <KpiCard
          icon={<CheckCircle className="h-5 w-5 text-green-600" />}
          bg="bg-green-50"
          count={counts.confirmed}
          label="Confirmed"
        />
        <KpiCard
          icon={<Copy className="h-5 w-5 text-red-600" />}
          bg="bg-red-50"
          count={counts.duplicate}
          label="Duplicates"
        />
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ tab: v, page: '0' })}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="needs_review">
              Needs Review{counts.needs_review > 0 ? ` · ${counts.needs_review}` : ''}
            </TabsTrigger>
            <TabsTrigger value="all">All · {counts.all_projects}</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmed · {counts.confirmed}</TabsTrigger>
            <TabsTrigger value="duplicates">Duplicates · {counts.duplicate}</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>

          {tab !== 'audit' && (
            <Input
              className="h-8 w-64 text-sm"
              placeholder="Search customer or project#…"
              value={searchValue}
              onChange={(e) => handleSearch(e.target.value)}
            />
          )}
        </div>

        <TabsContent value="needs_review" className="mt-4">
          <ProjectsTable rows={rows} />
          <Pagination page={page} totalPages={totalPages} onNavigate={navigate} />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <ProjectsTable rows={rows} />
          <Pagination page={page} totalPages={totalPages} onNavigate={navigate} />
        </TabsContent>

        <TabsContent value="confirmed" className="mt-4">
          <ProjectsTable rows={rows} showActions={false} />
          <Pagination page={page} totalPages={totalPages} onNavigate={navigate} />
        </TabsContent>

        <TabsContent value="duplicates" className="mt-4">
          <ProjectsTable rows={rows} showActions={false} />
          <Pagination page={page} totalPages={totalPages} onNavigate={navigate} />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  icon,
  bg,
  count,
  label,
}: {
  icon: React.ReactNode;
  bg: string;
  count: number;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1D24]">{count}</p>
            <p className="text-xs text-[#7C818E]">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Pagination({
  page,
  totalPages,
  onNavigate,
}: {
  page: number;
  totalPages: number;
  onNavigate: (p: Partial<{ tab: string; page: string; search: string }>) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-[#7C818E]">
      <span>
        Page {page + 1} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onNavigate({ page: String(page - 1) })}
        >
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages - 1}
          onClick={() => onNavigate({ page: String(page + 1) })}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
