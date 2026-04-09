import { getProjects } from '@/lib/projects-queries';
import { getMyViews } from '@/lib/views-actions';
import { ProjectsTableWrapper } from '@/components/projects/projects-table-wrapper';
import { getDefaultColumns } from '@/components/data-table/column-config';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
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
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, views] = await Promise.all([
    getProjects({
      status: (params.status as ProjectStatus) || undefined,
      search: params.search || undefined,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('projects'),
  ]);

  // Flatten employee relationship for DataTable
  const flatData = result.data.map((p: any) => ({
    ...p,
    project_manager_name: p.employees?.full_name ?? '—',
    site_city: p.site_city ?? '—',
    year: p.created_at ? new Date(p.created_at).getFullYear().toString() : '—',
    remarks: p.notes ?? '',
  }));

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.search) currentFilters.search = params.search;

  // If explicit view param, use that. Otherwise fall back to user's default view.
  const activeView = params.view
    ? views.find((v: any) => v.id === params.view)
    : views.find((v: any) => v.is_default) ?? null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('projects');

  const filterBar = (
    <FilterBar basePath="/projects" filterParams={['search', 'status']}>
      <FilterSelect paramName="status" className="w-44 h-9 text-sm">
        <option value="">All Statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </FilterSelect>
      <SearchInput
        placeholder="Search project # or customer..."
        className="w-64 h-9 text-sm"
      />
    </FilterBar>
  );

  return (
    <ProjectsTableWrapper
      filterBar={filterBar}
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
