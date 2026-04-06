import { getProjects } from '@/lib/projects-queries';
import { getMyViews } from '@/lib/views-actions';
import { ProjectsTableWrapper } from '@/components/projects/projects-table-wrapper';
import { PROJECT_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Card, CardContent, Eyebrow } from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'advance_received', label: 'Advance Received' },
  { value: 'planning', label: 'Planning' },
  { value: 'material_procurement', label: 'Material Procurement' },
  { value: 'installation', label: 'Installation' },
  { value: 'electrical_work', label: 'Electrical Work' },
  { value: 'testing', label: 'Testing' },
  { value: 'commissioned', label: 'Commissioned' },
  { value: 'net_metering_pending', label: 'Net Metering Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'cancelled', label: 'Cancelled' },
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

  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('projects');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">PROJECTS</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">Projects</h1>
        </div>
      </div>

      <Card>
        <CardContent className="py-3">
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
        </CardContent>
      </Card>

      <ProjectsTableWrapper
        data={flatData}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        sortColumn={params.sort}
        sortDirection={params.dir}
        currentFilters={currentFilters}
        views={views}
        activeViewId={params.view ?? null}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
