import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, Badge, Button } from '@repo/ui';
import { Activity, ExternalLink } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import {
  listPlantMonitoringCredentials,
  getProjectsWithCredentials,
  getAllActiveProjects,
  getPlantMonitoringSummary,
} from '@/lib/plant-monitoring-queries';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import { PlantMonitoringPasswordCell } from '@/components/om/plant-monitoring-password-cell';
import { CreatePlantMonitoringDialog } from '@/components/om/create-plant-monitoring-dialog';
import { EditPlantMonitoringDialog } from '@/components/om/edit-plant-monitoring-dialog';
import { DeletePlantMonitoringButton } from '@/components/om/delete-plant-monitoring-button';
import { FilterBar } from '@/components/filter-bar';
import { FilterSelect } from '@/components/filter-select';
import { SearchInput } from '@/components/search-input';

const BRAND_OPTIONS = [
  { value: 'sungrow', label: 'Sungrow' },
  { value: 'growatt', label: 'Growatt' },
  { value: 'sma', label: 'SMA' },
  { value: 'huawei', label: 'Huawei' },
  { value: 'fronius', label: 'Fronius' },
  { value: 'solis', label: 'Solis' },
  { value: 'other', label: 'Other' },
];

function brandBadgeVariant(brand: string | null): 'info' | 'success' | 'warning' | 'outline' {
  switch (brand) {
    case 'sungrow': return 'info';
    case 'growatt': return 'success';
    case 'sma': return 'warning';
    case 'huawei':
    case 'fronius':
    case 'solis':
      return 'info';
    default:
      return 'outline';
  }
}

interface PageProps {
  searchParams: Promise<{
    project?: string;
    brand?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function PlantMonitoringPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const [{ items, total }, filterProjects, allProjects, summary, viewerRole] = await Promise.all([
    listPlantMonitoringCredentials({
      project_id: params.project || undefined,
      brand: params.brand || undefined,
      search: params.search || undefined,
      page: currentPage,
      per_page: perPage,
    }),
    getProjectsWithCredentials(),
    getAllActiveProjects(),
    getPlantMonitoringSummary(),
    getCurrentUserRoleForProject(),
  ]);

  const canEdit = viewerRole === 'founder' || viewerRole === 'project_manager';
  const totalPages = Math.ceil(total / perPage);
  const hasFilters = Boolean(params.project || params.brand || params.search);

  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.project) p.set('project', params.project);
    if (params.brand) p.set('brand', params.brand);
    if (params.search) p.set('search', params.search);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/om/plant-monitoring${qs ? `?${qs}` : ''}`;
  }

  // Top 3 brands for the summary card
  const sortedBrands = Object.entries(summary.brands)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Plant Monitoring{' '}
            <span className="text-sm font-normal text-n-500">({total} total)</span>
          </h1>
          <p className="text-xs text-n-500 mt-0.5">
            Online portal credentials for every commissioned plant. Auto-synced from commissioning reports.
          </p>
        </div>
        {canEdit && <CreatePlantMonitoringDialog projects={allProjects} />}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Plants Monitored</div>
            <div className="text-2xl font-heading font-bold text-n-900 mt-1">{summary.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Top Brands</div>
            {sortedBrands.length === 0 ? (
              <div className="text-sm text-n-400 mt-1">No data yet</div>
            ) : (
              <div className="flex gap-2 mt-1 flex-wrap">
                {sortedBrands.map(([brand, count]) => (
                  <span key={brand} className="text-xs font-medium text-n-700 capitalize">
                    {brand}: <span className="font-bold">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Missing Credentials</div>
            <div className={`text-2xl font-heading font-bold mt-1 ${summary.missing > 0 ? 'text-amber-600' : 'text-n-900'}`}>
              {summary.missing}
            </div>
            {summary.missing > 0 && (
              <div className="text-[10px] text-n-500 mt-0.5">
                Projects with finalized commissioning but no credential
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/om/plant-monitoring" filterParams={['search', 'project', 'brand']}>
            <FilterSelect paramName="project" className="w-48 text-xs h-8">
              <option value="">All Projects</option>
              {filterProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.customer_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="brand" className="w-32 text-xs h-8">
              <option value="">All Brands</option>
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search username/notes..."
              className="w-56 h-8 text-xs"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Credentials Yet</h2>
              <p className="text-xs text-n-500 max-w-[360px] mt-1">
                {hasFilters
                  ? 'No credentials match your current filters.'
                  : 'Credentials will appear here automatically when an engineer finalizes a commissioning report. You can also add them manually.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Brand</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Username</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Password</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Monitoring Link</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Created</th>
                    {canEdit && <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-20">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((cred) => {
                    const customerName = cred.projects?.customer_name ?? '—';
                    return (
                      <tr key={cred.id} className="border-b border-n-100 hover:bg-n-50">
                        <td className="px-2 py-1.5">
                          {cred.project_id ? (
                            <Link href={`/projects/${cred.project_id}`} className="text-[#00B050] hover:underline text-xs font-medium">
                              {customerName}
                            </Link>
                          ) : customerName}
                        </td>
                        <td className="px-2 py-1.5">
                          {cred.inverter_brand ? (
                            <Badge variant={brandBadgeVariant(cred.inverter_brand)} className="text-[10px] px-1.5 py-0 capitalize">
                              {cred.inverter_brand}
                            </Badge>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {cred.username}
                        </td>
                        <td className="px-2 py-1.5">
                          <PlantMonitoringPasswordCell password={cred.password} />
                        </td>
                        <td className="px-2 py-1.5">
                          <a
                            href={cred.portal_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#00B050] hover:underline text-[11px] inline-flex items-center gap-1 max-w-[260px]"
                            title={cred.portal_url}
                          >
                            <span className="truncate">{cred.portal_url}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(cred.created_at)}
                        </td>
                        {canEdit && (
                          <td className="px-2 py-1.5">
                            <div className="flex gap-0.5">
                              <EditPlantMonitoringDialog
                                credential={{
                                  id: cred.id,
                                  portal_url: cred.portal_url,
                                  username: cred.username,
                                  password: cred.password,
                                  notes: cred.notes,
                                }}
                              />
                              <DeletePlantMonitoringButton
                                credentialId={cred.id}
                                customerName={customerName}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-n-500">
          <div>
            Showing {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, total)} of {total}
          </div>
          <div className="flex gap-1">
            {currentPage > 1 && (
              <Link href={pageUrl(currentPage - 1)}>
                <Button variant="outline" size="sm" className="h-7 text-xs">Previous</Button>
              </Link>
            )}
            <span className="px-2 py-1">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link href={pageUrl(currentPage + 1)}>
                <Button variant="outline" size="sm" className="h-7 text-xs">Next</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
