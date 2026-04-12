import * as React from 'react';
import { getAllTickets } from '@/lib/service-ticket-actions';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { formatDate } from '@repo/ui/formatters';
import { CreateTicketDialog } from '@/components/om/create-ticket-dialog';
import { EditTicketDialog } from '@/components/om/edit-ticket-dialog';
import { DeleteTicketButton } from '@/components/om/delete-ticket-button';
import { TicketStatusToggle } from '@/components/om/ticket-status-toggle';
import {
  Card,
  CardContent,
  Badge,
  Button,
} from '@repo/ui';
import { Wrench } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import Link from 'next/link';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (All Active)' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const ISSUE_TYPES = [
  { value: 'no_generation', label: 'No Generation' },
  { value: 'low_generation', label: 'Low Generation' },
  { value: 'inverter_fault', label: 'Inverter Fault' },
  { value: 'panel_damage', label: 'Panel Damage' },
  { value: 'wiring_issue', label: 'Wiring Issue' },
  { value: 'earthing_issue', label: 'Earthing Issue' },
  { value: 'monitoring_offline', label: 'Monitoring Offline' },
  { value: 'physical_damage', label: 'Physical Damage' },
  { value: 'warranty_claim', label: 'Warranty Claim' },
  { value: 'billing_issue', label: 'Billing Issue' },
  { value: 'other', label: 'Other' },
];

function severityVariant(severity: string): 'error' | 'warning' | 'info' | 'outline' {
  switch (severity) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'outline';
  }
}

function formatINR(amount: number): string {
  if (!amount) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface TicketsPageProps {
  searchParams: Promise<{
    status?: string;
    severity?: string;
    issue_type?: string;
    search?: string;
    project?: string;
    assigned_to?: string;
    page?: string;
  }>;
}

export default async function ServiceTicketsPage({ searchParams }: TicketsPageProps) {
  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const [{ tickets, total }, employees, projects] = await Promise.all([
    getAllTickets({
      status: params.status || undefined,
      severity: params.severity || undefined,
      issue_type: params.issue_type || undefined,
      search: params.search || undefined,
      project_id: params.project || undefined,
      assigned_to: params.assigned_to || undefined,
      page: currentPage,
      per_page: perPage,
    }),
    getActiveEmployees(),
    getActiveProjects(),
  ]);

  const totalPages = Math.ceil(total / perPage);
  const hasFilters = params.status || params.severity || params.issue_type || params.search || params.project || params.assigned_to;

  // Build pagination URL helper
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.status) p.set('status', params.status);
    if (params.severity) p.set('severity', params.severity);
    if (params.issue_type) p.set('issue_type', params.issue_type);
    if (params.search) p.set('search', params.search);
    if (params.project) p.set('project', params.project);
    if (params.assigned_to) p.set('assigned_to', params.assigned_to);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/om/tickets${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Service Tickets{' '}
            <span className="text-sm font-normal text-n-500">
              ({total} total)
            </span>
          </h1>
        </div>
        <CreateTicketDialog employees={employees} projects={projects} />
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/om/tickets" filterParams={['search', 'status', 'severity', 'issue_type', 'project', 'assigned_to']}>
            <FilterSelect paramName="status" className="w-36 text-xs h-8">
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="severity" className="w-28 text-xs h-8">
              <option value="">All Severity</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="issue_type" className="w-40 text-xs h-8">
              <option value="">All Issue Types</option>
              {ISSUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="assigned_to" className="w-40 text-xs h-8">
              <option value="">All Engineers</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="project" className="w-44 text-xs h-8">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search ticket..."
              className="w-48 h-8 text-xs"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wrench className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Tickets Found</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No tickets match your current filters.'
                  : 'No service tickets have been created yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Ticket #</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Title</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Severity</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned To</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Service Amt</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Created</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">SLA Due</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Resolved By</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket: any) => {
                    const projectInfo = ticket.projects as { project_number: string; customer_name: string } | null;
                    const assigneeName = ticket.assignee && 'full_name' in ticket.assignee
                      ? (ticket.assignee as { full_name: string }).full_name
                      : null;
                    const resolvedByName = ticket.resolved_by_employee && 'full_name' in ticket.resolved_by_employee
                      ? (ticket.resolved_by_employee as { full_name: string }).full_name
                      : null;
                    const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

                    return (
                      <tr
                        key={ticket.id}
                        className={`border-b border-n-100 hover:bg-n-50 ${isClosed ? 'opacity-50' : ''}`}
                      >
                        {/* Ticket # */}
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {ticket.ticket_number}
                        </td>

                        {/* Project */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {projectInfo ? (
                            <Link href={`/projects/${ticket.project_id}`} className="text-p-600 hover:underline">
                              <div className="font-medium leading-tight">{projectInfo.project_number}</div>
                              <div className="text-n-500 text-[10px] leading-tight">{projectInfo.customer_name}</div>
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>

                        {/* Title */}
                        <td className={`px-2 py-1.5 text-[11px] font-medium ${isClosed ? 'line-through text-n-400' : 'text-n-900'}`}>
                          <span title={ticket.title}>{ticket.title}</span>
                        </td>

                        {/* Issue Type */}
                        <td className="px-2 py-1.5 text-[10px] text-n-600 capitalize">
                          {ticket.issue_type?.replace(/_/g, ' ') ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Severity */}
                        <td className="px-2 py-1.5">
                          <Badge variant={severityVariant(ticket.severity)} className="text-[10px] px-1.5 py-0 capitalize">
                            {ticket.severity}
                          </Badge>
                        </td>

                        {/* Status — inline toggle */}
                        <td className="px-2 py-1.5">
                          <TicketStatusToggle
                            ticketId={ticket.id}
                            currentStatus={ticket.status}
                            slaBreached={ticket.sla_breached}
                          />
                        </td>

                        {/* Assigned To */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700">
                          {assigneeName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Service Amount */}
                        <td className="px-2 py-1.5 text-[11px] text-n-700 font-medium">
                          {ticket.service_amount > 0 ? formatINR(ticket.service_amount) : <span className="text-n-300">—</span>}
                        </td>

                        {/* Created */}
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(ticket.created_at)}
                        </td>

                        {/* SLA Due */}
                        <td className="px-2 py-1.5 text-[11px]">
                          {ticket.sla_deadline ? (
                            <span className={ticket.sla_breached ? 'text-red-600 font-medium' : 'text-n-600'}>
                              {formatDate(ticket.sla_deadline)}
                            </span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Resolved By */}
                        <td className="px-2 py-1.5 text-[11px] text-n-600">
                          {resolvedByName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-1.5">
                          <div className="flex gap-0.5">
                            <EditTicketDialog
                              ticket={{
                                id: ticket.id,
                                title: ticket.title,
                                description: ticket.description ?? '',
                                issue_type: ticket.issue_type,
                                severity: ticket.severity,
                                assigned_to: ticket.assigned_to,
                                service_amount: ticket.service_amount ?? 0,
                                resolution_notes: ticket.resolution_notes ?? null,
                              }}
                              employees={employees}
                            />
                            <DeleteTicketButton ticketId={ticket.id} ticketNumber={ticket.ticket_number} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-n-200 bg-n-50">
              <span className="text-[11px] text-n-500">
                Page {currentPage} of {totalPages} &middot; {total} tickets
              </span>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Link href={pageUrl(currentPage - 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      ← Previous
                    </Button>
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link href={pageUrl(currentPage + 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      Next →
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
