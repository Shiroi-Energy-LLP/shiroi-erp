/**
 * /om/tickets/[id] — Service Ticket detail page.
 *
 * Opened by clicking a ticket Title on /om/tickets. Shows the full work
 * description + supporting documents, an all-fields edit panel, and a combined
 * day-by-day timeline (manual notes + system events). Edits flow through the
 * same server actions the list uses, so changes reflect back on /om/tickets.
 *
 * NEVER-DO compliance:
 * - #15: no inline Supabase — uses service-ticket-actions.ts queries.
 * - #21: client children import only from server actions / client-safe constants.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTicketDetail } from '@/lib/service-ticket-actions';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { formatDate, formatINR } from '@repo/ui/formatters';
import { Card, CardContent, Badge } from '@repo/ui';
import { ArrowLeft } from 'lucide-react';
import { issueTypeLabel, severityVariant } from '@/lib/ticket-constants';
import { TicketStatusToggle } from '@/components/om/ticket-status-toggle';
import { TicketEditPanel } from '@/components/om/ticket-edit-panel';
import { TicketAttachments } from '@/components/om/ticket-attachments';
import { TicketTimeline } from '@/components/om/ticket-timeline';
import { DeleteTicketButton } from '@/components/om/delete-ticket-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-n-500">{label}</div>
      <div className="text-xs text-n-800 mt-0.5">{children}</div>
    </div>
  );
}

export default async function TicketDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [ticket, employees, projects] = await Promise.all([
    getTicketDetail(id),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  if (!ticket) notFound();

  const projectInfo = ticket.projects;
  const assigneeName = ticket.assignee?.full_name ?? null;
  const resolvedByName = ticket.resolved_by_employee?.full_name ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Back link */}
      <Link href="/om/tickets" className="inline-flex items-center gap-1 text-xs text-n-500 hover:text-n-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-n-400">{ticket.ticket_number}</span>
                <TicketStatusToggle ticketId={ticket.id} currentStatus={ticket.status} slaBreached={ticket.sla_breached} />
              </div>
              <h1 className="mt-1 text-lg font-heading font-bold text-n-900 break-words">{ticket.title}</h1>
            </div>
            <div className="flex-shrink-0">
              <DeleteTicketButton ticketId={ticket.id} ticketTitle={ticket.title} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetaItem label="Project">
              {ticket.project_id && projectInfo ? (
                <Link href={`/projects/${ticket.project_id}`} className="text-shiroi-gold-dark hover:underline">
                  {projectInfo.customer_name}
                </Link>
              ) : (
                <span>{ticket.project_name_custom ?? '—'}</span>
              )}
            </MetaItem>
            <MetaItem label="Issue Type">{issueTypeLabel(ticket.issue_type)}</MetaItem>
            <MetaItem label="Severity">
              <Badge variant={severityVariant(ticket.severity)} className="text-[10px] px-1.5 py-0 capitalize">
                {ticket.severity}
              </Badge>
            </MetaItem>
            <MetaItem label="Assigned To">{assigneeName ?? '—'}</MetaItem>
            <MetaItem label="Created">{formatDate(ticket.created_at)}</MetaItem>
            <MetaItem label="SLA Due">
              {ticket.sla_deadline ? (
                <span className={ticket.sla_breached ? 'text-red-600 font-medium' : ''}>{formatDate(ticket.sla_deadline)}</span>
              ) : '—'}
            </MetaItem>
            <MetaItem label="Done By">{resolvedByName ?? '—'}</MetaItem>
            <MetaItem label="Service Amount">
              <span className="font-medium tabular-nums">{(ticket.service_amount ?? 0) > 0 ? formatINR(ticket.service_amount ?? 0) : '—'}</span>
            </MetaItem>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: edit + documents */}
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-heading font-bold text-n-900">Ticket Details</h2>
              <TicketEditPanel
                ticket={{
                  id: ticket.id,
                  title: ticket.title,
                  description: ticket.description ?? '',
                  issue_type: ticket.issue_type,
                  severity: ticket.severity,
                  status: ticket.status,
                  assigned_to: ticket.assigned_to,
                  resolved_by: ticket.resolved_by,
                  service_amount: ticket.service_amount ?? 0,
                  resolution_notes: ticket.resolution_notes ?? null,
                  project_id: ticket.project_id,
                  project_name_custom: ticket.project_name_custom,
                }}
                employees={employees}
                projects={projects}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-heading font-bold text-n-900">Supporting Documents</h2>
              <TicketAttachments
                ticketId={ticket.id}
                paths={ticket.attachment_paths ?? []}
                names={ticket.attachment_names ?? []}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: timeline */}
        <Card>
          <CardContent className="py-4">
            <h2 className="mb-3 text-sm font-heading font-bold text-n-900">Work Progress & Activity</h2>
            <TicketTimeline ticketId={ticket.id} events={ticket.events} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
