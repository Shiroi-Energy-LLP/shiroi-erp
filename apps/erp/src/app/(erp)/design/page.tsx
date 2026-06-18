import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { Palette, Ruler } from 'lucide-react';
import { MS_PER_DAY } from '@/lib/helpers/time-helpers';
import { getProjectsNeedingSiteDesign } from '@/lib/projects-queries';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import { MarkSiteDesignCompleteButton } from '@/components/projects/mark-site-design-complete-button';

function statusBadgeVariant(status: string): 'default' | 'outline' {
  return status === 'design_confirmed' ? 'default' : 'outline';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function daysWaiting(isoTimestamp: string): number {
  const from = new Date(isoTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - from.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

function truncateNote(note: string | null, maxLen = 60): string {
  if (!note) return '—';
  return note.length <= maxLen ? note : `${note.slice(0, maxLen)}…`;
}

const COMPLETE_ROLES = new Set(['designer', 'founder', 'project_manager']);

export default async function DesignPage() {
  const op = '[DesignPage]';

  let leads: Array<{
    id: string;
    customer_name: string;
    phone: string | null;
    city: string | null;
    segment: string | null;
    estimated_size_kwp: number | null;
    status: string;
    created_at: string;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .select('id, customer_name, phone, city, segment, estimated_size_kwp, status, created_at')
      .in('status', ['design_in_progress', 'design_confirmed'])
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw error;
    }
    leads = (data ?? []) as typeof leads;
  } catch {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow className="mb-1">DESIGN QUEUE</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Queue</h1>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-n-500">Could not load design queue. Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Section 2 data + viewer role (for "Mark complete" button visibility)
  const [projectsNeedingDesign, viewerRole] = await Promise.all([
    getProjectsNeedingSiteDesign(),
    getCurrentUserRoleForProject(),
  ]);

  const totalCount = leads.length;
  const inDesignCount = leads.filter((l) => l.status === 'design_in_progress').length;
  const designConfirmedCount = leads.filter((l) => l.status === 'design_confirmed').length;
  const canMarkComplete = viewerRole !== null && COMPLETE_ROLES.has(viewerRole);

  return (
    <div className="space-y-8">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div>
        <Eyebrow className="mb-1">DESIGN QUEUE</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Queue</h1>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Section 1: In Design — Leads
          ════════════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-[#1A1D24]">In Design — Leads</h2>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-n-500 uppercase tracking-wide">Total in Queue</p>
              <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{totalCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-n-500 uppercase tracking-wide">In Design</p>
              <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{inDesignCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-n-500 uppercase tracking-wide">Design Confirmed</p>
              <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{designConfirmedCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Leads table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Segment</TableHead>
                  <TableHead className="text-right">Size (kWp)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Days Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        icon={<Palette className="h-12 w-12" />}
                        title="No designs in queue"
                        description="Leads awaiting system design will appear here."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  leads.map((lead) => {
                    const days = daysWaiting(lead.created_at);
                    return (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">
                          <Link href={`/design/${lead.id}`} className="text-shiroi-gold-dark hover:underline">
                            {lead.customer_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {lead.phone ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{lead.city ?? '—'}</TableCell>
                        <TableCell className="text-sm capitalize">{lead.segment ?? '—'}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {lead.estimated_size_kwp != null ? lead.estimated_size_kwp : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(lead.status)}>
                            {statusLabel(lead.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(lead.created_at.slice(0, 10))}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{days}d</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Section 2: At-Site Design — Projects
          ════════════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-[#1A1D24]">At-Site Design — Projects</h2>
          {projectsNeedingDesign.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#EDE9FE] text-[#5B21B6]">
              {projectsNeedingDesign.length}
            </span>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Size (kWp)</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectsNeedingDesign.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        icon={<Ruler className="h-12 w-12" />}
                        title="No at-site design requests"
                        description="Projects flagged for at-site layout work will appear here. Project managers can request this from the project detail page."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  projectsNeedingDesign.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-mono font-medium text-sm">
                        {project.project_number}
                      </TableCell>
                      <TableCell className="font-medium">{project.customer_name}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {project.system_size_kwp != null ? project.system_size_kwp : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {project.needs_site_design_requested_at
                          ? formatDate(project.needs_site_design_requested_at.slice(0, 10))
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {project.requested_by_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                        {truncateNote(project.needs_site_design_note)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/projects/${project.id}`}
                            className="text-xs font-medium text-shiroi-gold-dark hover:underline whitespace-nowrap"
                          >
                            Open
                          </Link>
                          {canMarkComplete && (
                            <MarkSiteDesignCompleteButton projectId={project.id} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
