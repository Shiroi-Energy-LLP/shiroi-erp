'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setProjectStatus } from '@/lib/project-detail-actions';
import { PROJECT_STATUS_LABELS } from '@/components/projects/project-status-badge';
import { formatINR } from '@repo/ui/formatters';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

const STATUS_STYLES: Record<ProjectStatus, string> = {
  order_received: 'bg-blue-50 text-blue-700 border-blue-200',
  yet_to_start: 'bg-n-100 text-n-700 border-n-300',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  holding_shiroi: 'bg-orange-50 text-orange-700 border-orange-200',
  holding_client: 'bg-red-50 text-red-700 border-red-200',
  waiting_net_metering: 'bg-purple-50 text-purple-700 border-purple-200',
  meter_client_scope: 'bg-sky-50 text-sky-700 border-sky-200',
};

const STATUS_ORDER: ProjectStatus[] = [
  'order_received',
  'yet_to_start',
  'in_progress',
  'waiting_net_metering',
  'completed',
  'holding_shiroi',
  'holding_client',
  'meter_client_scope',
];

interface ProjectHeaderProps {
  project: {
    id: string;
    project_number: string;
    customer_name: string;
    status: ProjectStatus;
    system_size_kwp: number;
    system_type: string;
    contracted_value: number;
    completion_pct: number;
    ceig_required: boolean;
    ceig_cleared: boolean;
    automation_paused: boolean;
  };
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value as ProjectStatus;
    if (newStatus === project.status) return;

    const ok = window.confirm(
      `Change status to "${PROJECT_STATUS_LABELS[newStatus]}"?`,
    );
    if (!ok) {
      // Reset the select by forcing re-render — parent will pass old value back
      router.refresh();
      return;
    }

    setBusy(true);
    setError(null);
    const res = await setProjectStatus({ projectId: project.id, newStatus });
    setBusy(false);

    if (!res.success) {
      setError(res.error ?? 'Failed to update');
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm text-n-500 hover:text-shiroi-green">
            Projects
          </Link>
          <span className="text-n-400">/</span>
          <h1 className="text-2xl font-bold text-[#1A1D24] font-mono truncate">
            {project.project_number}
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-n-600">{project.customer_name}</span>
          <span className="text-sm text-n-500">
            {project.system_size_kwp} kWp · {project.system_type.replace(/_/g, ' ')}
          </span>
          <span className="text-sm font-mono text-n-600">
            {formatINR(project.contracted_value)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap justify-end">
        {project.ceig_required && !project.ceig_cleared && (
          <div className="px-2.5 py-1 bg-[#FFF7ED] border border-[#9A3412] rounded-md text-xs text-[#9A3412] font-medium">
            CEIG Pending
          </div>
        )}
        {project.automation_paused && (
          <div className="px-2.5 py-1 bg-[#FEF2F2] border border-[#991B1B] rounded-md text-xs text-[#991B1B] font-medium">
            Automation Paused
          </div>
        )}

        {/* Editable status dropdown */}
        <div className="flex flex-col items-end gap-0.5">
          <label className="text-[10px] uppercase tracking-wider text-n-500">Status</label>
          <select
            value={project.status}
            disabled={busy}
            onChange={handleStatusChange}
            className={`h-9 text-sm font-medium rounded-md border px-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-shiroi-green/30 ${STATUS_STYLES[project.status]} disabled:opacity-60`}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>

        <div className="text-right border-l border-n-200 pl-3">
          <div className="text-2xl font-bold text-[#1A1D24]">{project.completion_pct}%</div>
          <div className="text-xs text-n-500">Complete</div>
        </div>
      </div>
    </div>
  );
}
