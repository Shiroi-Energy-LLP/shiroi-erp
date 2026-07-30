import * as React from 'react';
import { getAllTickets, getServiceTicketKpis } from '@/lib/service-ticket-actions';
import { getActiveEmployees, getActiveProjects } from '@/lib/tasks-actions';
import { formatDateFromTimestamp, formatINR as formatINRBase } from '@repo/ui/formatters';
import { CreateTicketDialog } from '@/components/om/create-ticket-dialog';
import { DeleteTicketButton } from '@/components/om/delete-ticket-button';
import { TicketStatusToggle } from '@/components/om/ticket-status-toggle';
import { TicketProjectFilter } from '@/components/om/ticket-project-filter';
import {
  Card,
  CardContent,
  Button,
} from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { Wrench, Pencil } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { ISSUE_TYPES, issueTypeLabel } from '@/lib/ticket-constants';
import Link from 'next/link';

// Filter-specific status options: 'open' means "all active" (see getAllTickets).
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (All Active)' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

function formatINR(amount: number): string {
  if (!amount) return '—';
  return formatINRBase(amount);
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

  const [{ tickets, total }, employees, projects, kpis] = await Promise.all([
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
    getServiceTicketKpis(),
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
    <ListPageShell
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FilterBar basePath="/om/tickets" filterParams={['search', 'status', 'issue_type', 'project', 'assigned_to']}>
              <TicketProjectFilter projects={projects} />
              <FilterSelect paramName="status" className="w-36 text-xs h-8">
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((s) => (
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
              <SearchInput
                placeholder="Search customer, project, or ticket…"
                className="w-56 h-8 text-xs"
              />
            </FilterBar>
          </div>
          <CreateTicketDialog employees={employees} projects={projects} />
        </div>
      }
    >
      {/* Title + KPI cards — scroll away */}
      <div className="space-y-3">
        <h1 className="text-lg font-heading font-bold text-n-900">
          Service Tickets{' '}
          <span className="text-sm font-normal text-n-500">
            ({total} total)
          </span>
        </h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-n-500 uppercase tracking-wider">Open Services</div>
              <div className="text-2xl font-heading font-bold text-n-900 mt-1">{kpis.openCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-n-500 uppercase tracking-wider">Closed Services</div>
              <div className="text-2xl font-heading font-bold text-n-900 mt-1">{kpis.closedCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-n-500 uppercase tracking-wider">Total Service Amount</div>
              <div className="text-2xl font-heading font-bold text-n-900 mt-1 tabular-nums">{formatINR(kpis.totalAmount)}</div>
            </CardContent>
          </Card>
        </div>
      </div>

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
            <table className="w-full text-sm [&_td]:align-top">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Title</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Assigned To</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Created</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Done By</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Amount (₹)</th>
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
                    return (
                      <tr
                        key={ticket.id}
                        className="border-b border-n-100 hover:bg-n-50"
                      >
                        {/* Project */}
                        <td className="px-2 py-1.5">
                          {ticket.project_id ? (
                            <Link href={`/projects/${ticket.project_id}`} className="text-shiroi-gold-dark hover:underline">
                              {projectInfo?.customer_name ?? '—'}
                            </Link>
                          ) : ticket.project_name_custom ? (
                            <span className="text-n-700">{ticket.project_name_custom}</span>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>

                        {/* Title — links to detail page */}
                        <td className="px-2 py-1.5 font-medium">
                          <Link
                            href={`/om/tickets/${ticket.id}`}
                            className="text-shiroi-gold-dark hover:underline"
                            title={ticket.title}
                          >
                            {ticket.title}
                          </Link>
                        </td>

                        {/* Issue Type */}
                        <td className="px-2 py-1.5 text-n-600">
                          {ticket.issue_type ? issueTypeLabel(ticket.issue_type) : <span className="text-n-300">—</span>}
                        </td>

                        {/* Assigned To */}
                        <td className="px-2 py-1.5 text-n-700">
                          {assigneeName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Status — inline toggle */}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <TicketStatusToggle
                            ticketId={ticket.id}
                            currentStatus={ticket.status}
                            slaBreached={ticket.sla_breached}
                          />
                        </td>

                        {/* Created — created_at is TIMESTAMPTZ, not a date-only column */}
                        <td className="px-2 py-1.5 text-n-500 whitespace-nowrap">
                          {formatDateFromTimestamp(ticket.created_at)}
                        </td>

                        {/* Done By */}
                        <td className="px-2 py-1.5 text-n-600">
                          {resolvedByName ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Amount */}
                        <td className="px-2 py-1.5 text-n-700 font-medium whitespace-nowrap tabular-nums">
                          {ticket.service_amount > 0 ? formatINR(ticket.service_amount) : <span className="text-n-300">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="flex gap-0.5">
                            {/* Edit opens the detail page — the only all-fields edit surface. */}
                            <Link
                              href={`/om/tickets/${ticket.id}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-n-500 hover:bg-n-100 hover:text-n-800"
                              title="Edit ticket"
                            >
                              <Pencil className="h-3 w-3" />
                            </Link>
                            <DeleteTicketButton ticketId={ticket.id} ticketTitle={ticket.title} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </table>
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
    </ListPageShell>
  );
}
