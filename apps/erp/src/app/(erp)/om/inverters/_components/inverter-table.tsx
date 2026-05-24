'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Card, CardContent } from '@repo/ui';
import { Activity, Pencil } from 'lucide-react';
import type { InverterWithProject } from '@/lib/inverters-queries';
import { HealthCheckButton } from './healthcheck-button';
import { EditInverterDialogTrigger } from './edit-inverter-dialog';

// ── Filter state ──────────────────────────────────────────────────────

interface FilterState {
  brand: string;
  project: string;
  pollingEnabled: '' | 'true' | 'false';
}

// ── Status badge helpers ──────────────────────────────────────────────

type InverterStatus = 'active' | 'offline' | 'fault' | 'derated' | 'unknown' | 'decommissioned';

function statusBadgeVariant(
  status: InverterStatus | string | null,
): 'success' | 'warning' | 'destructive' | 'outline' {
  switch (status) {
    case 'active': return 'success';
    case 'fault': return 'destructive';
    case 'derated': return 'warning';
    default: return 'outline';
  }
}

function statusLabel(status: InverterStatus | string | null): string {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Brand badge ───────────────────────────────────────────────────────

function brandBadgeVariant(
  brand: string | null,
): 'info' | 'success' | 'warning' | 'outline' {
  switch (brand) {
    case 'sungrow': return 'info';
    case 'growatt': return 'success';
    case 'sma': return 'warning';
    default: return 'outline';
  }
}

// ── Brand options for filter dropdown ────────────────────────────────

const BRAND_OPTIONS = [
  { value: 'sungrow', label: 'Sungrow' },
  { value: 'growatt', label: 'Growatt' },
  { value: 'sma', label: 'SMA' },
  { value: 'huawei', label: 'Huawei' },
  { value: 'fronius', label: 'Fronius' },
  { value: 'solarman', label: 'SolarMan' },
  { value: 'goodwe', label: 'GoodWe' },
  { value: 'fimer', label: 'FIMER' },
  { value: 'polycab', label: 'Polycab' },
  { value: 'havells', label: 'Havells' },
  { value: 'flin_energy', label: 'Flin Energy' },
  { value: 'other', label: 'Other' },
];

// ── Props ─────────────────────────────────────────────────────────────

interface InverterTableProps {
  inverters: InverterWithProject[];
}

// ── Component ─────────────────────────────────────────────────────────

export function InverterTable({ inverters }: InverterTableProps) {
  const [filters, setFilters] = React.useState<FilterState>({
    brand: '',
    project: '',
    pollingEnabled: '',
  });

  const [editingInverter, setEditingInverter] = React.useState<InverterWithProject | null>(null);

  // Unique projects for the filter dropdown (derived from passed data)
  const projectOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const opts: { id: string; label: string }[] = [];
    for (const inv of inverters) {
      const p = inv.projects;
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        opts.push({ id: p.id, label: p.customer_name });
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [inverters]);

  // Apply client-side filters
  const filtered = React.useMemo(() => {
    return inverters.filter((inv) => {
      if (filters.brand && inv.brand !== filters.brand) return false;
      if (filters.project && inv.project_id !== filters.project) return false;
      if (filters.pollingEnabled === 'true' && !inv.polling_enabled) return false;
      if (filters.pollingEnabled === 'false' && inv.polling_enabled) return false;
      return true;
    });
  }, [inverters, filters]);

  const hasFilters = filters.brand || filters.project || filters.pollingEnabled;

  function clearFilters() {
    setFilters({ brand: '', project: '', pollingEnabled: '' });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-2">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Brand filter */}
            <select
              value={filters.brand}
              onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))}
              className="h-8 rounded-md border border-n-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green w-32"
            >
              <option value="">All Brands</option>
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>

            {/* Project filter */}
            <select
              value={filters.project}
              onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))}
              className="h-8 rounded-md border border-n-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green w-44"
            >
              <option value="">All Projects</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Polling enabled filter */}
            <select
              value={filters.pollingEnabled}
              onChange={(e) => setFilters((f) => ({ ...f, pollingEnabled: e.target.value as FilterState['pollingEnabled'] }))}
              className="h-8 rounded-md border border-n-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green w-36"
            >
              <option value="">All Polling</option>
              <option value="true">Polling enabled</option>
              <option value="false">Polling disabled</option>
            </select>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="h-8 px-3 text-xs text-n-600 hover:text-n-900 rounded-md hover:bg-n-100"
              >
                Clear
              </button>
            )}

            <span className="ml-auto text-[10px] text-n-400">
              {filtered.length} of {inverters.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">
                {inverters.length === 0 ? 'No Inverters Yet' : 'No Matches'}
              </h2>
              <p className="text-xs text-n-500 max-w-[360px] mt-1">
                {inverters.length === 0
                  ? 'Add inverters using the button above to start tracking telemetry.'
                  : 'No inverters match your current filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Brand</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Serial</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Model</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">kWp</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Polling</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Last Poll</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Last Reading</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => {
                    const customerName = inv.projects?.customer_name ?? '—';
                    const projectNumber = inv.projects?.project_number;
                    return (
                      <tr key={inv.id} className="border-b border-n-100 hover:bg-n-50">
                        {/* Brand */}
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={brandBadgeVariant(inv.brand)}
                            className="text-[10px] px-1.5 py-0 capitalize"
                          >
                            {inv.brand}
                          </Badge>
                        </td>

                        {/* Project */}
                        <td className="px-2 py-1.5">
                          {inv.project_id ? (
                            <Link
                              href={`/projects/${inv.project_id}`}
                              className="text-[#00B050] hover:underline text-xs font-medium"
                            >
                              {customerName}
                              {projectNumber && (
                                <span className="ml-1 font-mono text-[9px] text-n-400">
                                  {projectNumber}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <span className="text-xs text-n-400">{customerName}</span>
                          )}
                        </td>

                        {/* Serial */}
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {inv.serial_number}
                        </td>

                        {/* Model */}
                        <td className="px-2 py-1.5 text-[11px] text-n-600">
                          {inv.model ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Rated kWp */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700 text-right font-mono">
                          {Number(inv.rated_capacity_kw).toFixed(1)}
                        </td>

                        {/* Polling */}
                        <td className="px-2 py-1.5">
                          <span
                            className={`text-[10px] font-medium ${inv.polling_enabled ? 'text-green-700' : 'text-n-400'}`}
                          >
                            {inv.polling_enabled ? `Every ${inv.polling_interval_minutes}m` : 'Off'}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={statusBadgeVariant(inv.current_status)}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {statusLabel(inv.current_status)}
                          </Badge>
                        </td>

                        {/* Last Poll */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {inv.last_poll_at
                            ? new Date(inv.last_poll_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                            : <span className="text-n-300">Never</span>
                          }
                        </td>

                        {/* Last Reading */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {inv.last_reading_at
                            ? new Date(inv.last_reading_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                            : <span className="text-n-300">Never</span>
                          }
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingInverter(inv)}
                              className="p-1 rounded hover:bg-n-100 text-n-500 hover:text-n-900"
                              title="Edit inverter"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <HealthCheckButton inverterId={inv.id} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog — rendered here so it can receive the selected inverter */}
      {editingInverter && (
        <EditInverterDialogTrigger
          inverter={editingInverter}
          open={true}
          onClose={() => setEditingInverter(null)}
        />
      )}
    </div>
  );
}
