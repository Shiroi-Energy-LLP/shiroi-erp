import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectHeader } from '@/lib/projects-queries';
import { ProjectStatusBadge } from '@/components/projects/project-status-badge';
import { ProjectTabs } from '@/components/projects/project-tabs';
import { AdvanceStatusButton } from '@/components/projects/advance-status-button';
import { formatINR } from '@repo/ui/formatters';

interface ProjectDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export default async function ProjectDetailLayout({ params, children }: ProjectDetailLayoutProps) {
  const { id } = await params;
  const project = await getProjectHeader(id);

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/projects" className="text-sm text-muted-foreground hover:text-[#00B050]">
              Projects
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-bold text-[#1A1D24] font-mono">
              {project.project_number}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ProjectStatusBadge status={project.status} />
            <span className="text-sm text-muted-foreground">
              {project.customer_name}
            </span>
            <span className="text-sm text-muted-foreground">
              {project.system_size_kwp} kWp {project.system_type.replace(/_/g, ' ')}
            </span>
            <span className="text-sm font-mono text-muted-foreground">
              {formatINR(project.contracted_value)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Completion indicator */}
          <div className="text-right">
            <div className="text-2xl font-bold text-[#1A1D24]">{project.completion_pct}%</div>
            <div className="text-xs text-muted-foreground">Complete</div>
          </div>
          {project.ceig_required && !project.ceig_cleared && (
            <div className="px-3 py-1.5 bg-[#FFF7ED] border border-[#9A3412] rounded-md text-xs text-[#9A3412] font-medium">
              CEIG Pending
            </div>
          )}
          {project.automation_paused && (
            <div className="px-3 py-1.5 bg-[#FEF2F2] border border-[#991B1B] rounded-md text-xs text-[#991B1B] font-medium">
              Automation Paused
            </div>
          )}
        </div>
      </div>

      {/* Advance Status */}
      <AdvanceStatusButton projectId={id} currentStatus={project.status} />

      {/* Tabs */}
      <ProjectTabs projectId={id} />

      {/* Tab content */}
      {children}
    </div>
  );
}
