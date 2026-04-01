import Link from 'next/link';
import { getProjects } from '@/lib/projects-queries';
import { ProjectStatusBadge, PROJECT_STATUS_LABELS } from '@/components/projects/project-status-badge';
import { formatINR, toIST } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
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
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const projects = await getProjects({
    status: (params.status as ProjectStatus) || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Projects</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="status" defaultValue={params.status ?? ''} className="w-52">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search project # or customer..."
              className="w-72"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.status || params.search) && (
              <Link href="/projects">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="text-right">Size (kWp)</TableHead>
                <TableHead className="text-right">Contracted Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead>Project Manager</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No projects found.
                  </TableCell>
                </TableRow>
              ) : (
                projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-[#00B050] hover:underline font-medium font-mono text-sm"
                      >
                        {project.project_number}
                      </Link>
                    </TableCell>
                    <TableCell>{project.customer_name}</TableCell>
                    <TableCell className="capitalize text-sm">
                      {project.system_type.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {project.system_size_kwp}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatINR(project.contracted_value)}
                    </TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                      {project.ceig_required && !project.ceig_cleared && (
                        <span className="ml-1 text-xs text-[#9A3412]" title="CEIG clearance pending">
                          CEIG
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <CompletionBar pct={project.completion_pct} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {project.employees?.full_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {toIST(project.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'bg-[#065F46]' : pct >= 50 ? 'bg-[#00B050]' : 'bg-[#FCA524]';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground">{pct}%</span>
    </div>
  );
}
