import { getProjects, getProjectStatusSummary } from '@/lib/projects-queries';
import { getMyViews } from '@/lib/views-actions';
import { ProjectsTableWrapper } from '@/components/projects/projects-table-wrapper';
import { ProjectsSummaryHeader } from '@/components/projects/projects-summary-header';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { FilterSelect } from '@/components/filter-select';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { FilterBar } from '@/components/filter-bar';
import { ProjectsSearchBox } from '@/components/projects/projects-search-box';
import { dateToFy, fyOptions } from '@/lib/helpers/fiscal-year';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'order_received', label: 'Order Received' },
  { value: 'yet_to_start', label: 'Yet to Start' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'holding_shiroi', label: 'Holding from Shiroi' },
  { value: 'holding_client', label: 'Holding from Client' },
  { value: 'waiting_net_metering', label: 'Waiting for Net Metering' },
  { value: 'meter_client_scope', label: 'Meter - Client Scope' },
];

interface ProjectsPageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
    year?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const now = new Date();
  const fyList = fyOptions(now.getFullYear(), now.getMonth());

  // Multi-select: comma-separated ?status= param, validated against the known
  // enum values so junk in the URL never reaches PostgREST.
  const validStatuses = new Set<string>(STATUS_OPTIONS.map((s) => s.value));
  const statusFilter = (params.status ?? '')
    .split(',')
    .filter((s): s is ProjectStatus => validStatuses.has(s));

  const [result, views, statusSummary] = await Promise.all([
    getProjects({
      status: statusFilter.length > 0 ? statusFilter : undefined,
      search: params.search || undefined,
      fy: params.year || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('projects'),
    getProjectStatusSummary(params.year || undefined),
  ]);

  // Flatten employee relationship for DataTable
  const flatData = result.data.map((p: any) => ({
    ...p,
    project_manager_name: p.employees?.full_name ?? '—',
    site_city: p.site_city ?? '—',
    // Year column = fiscal year of order_date (created_at fallback) — editable FY cell.
    year: dateToFy(p.order_date ?? p.created_at) ?? '—',
    notes: p.notes ?? '',
    remarks: p.notes ?? '',
  }));

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.search) currentFilters.search = params.search;
  if (params.year) currentFilters.year = params.year;

  // If explicit view param, use that. Otherwise fall back to user's default view.
  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('projects');

  const filterBar = (
    <FilterBar basePath="/projects" filterParams={['search', 'status', 'year']}>
      <FilterMultiSelect paramName="status" label="Statuses" options={STATUS_OPTIONS} />
      <FilterSelect paramName="year" className="w-36 h-9 text-sm">
        <option value="">All years</option>
        {fyList.map((fy) => (
          <option key={fy} value={fy}>{`FY ${fy}`}</option>
        ))}
      </FilterSelect>
      <ProjectsSearchBox />
    </FilterBar>
  );

  return (
    <ProjectsTableWrapper
      filterBar={filterBar}
      summaryHeader={<ProjectsSummaryHeader rows={statusSummary} />}
      data={flatData}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      totalPages={result.totalPages}
      sortColumn={params.sort}
      sortDirection={params.dir}
      currentFilters={currentFilters}
      views={views}
      activeViewId={params.view ?? activeView?.id ?? null}
      visibleColumns={visibleColumns}
    />
  );
}
