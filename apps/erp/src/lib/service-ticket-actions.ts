'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { emitErpEvent } from '@/lib/n8n/emit';
import { matchProjectIdsByText } from '@/lib/helpers/project-search-ids';
import { sanitizeForIlike } from '@/lib/helpers/sanitize-or-filter';
import { getCurrentEmployeeId } from '@/lib/auth';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type ServiceTicket = Database['public']['Tables']['om_service_tickets']['Row'];
type ServiceTicketInsert = Database['public']['Tables']['om_service_tickets']['Insert'];
type ServiceTicketUpdate = Database['public']['Tables']['om_service_tickets']['Update'];
type TicketEvent = Database['public']['Tables']['om_ticket_events']['Row'];
type TicketEventInsert = Database['public']['Tables']['om_ticket_events']['Insert'];
export type TicketStatus = Database['public']['Enums']['ticket_status'];

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Append a `system` event to the ticket timeline (status change, edits, etc.).
 * Best-effort + non-blocking: a failed log must never fail the parent mutation,
 * so we swallow errors here. `actorId` is the acting employee (NEVER-DO: *_by
 * columns are employees.id, resolved via getCurrentEmployeeId — not the auth uid).
 */
async function logSystemEvent(
  supabase: SupabaseServerClient,
  ticketId: string,
  body: string,
  actorId: string | null,
): Promise<void> {
  const op = '[logSystemEvent]';
  const insert: TicketEventInsert = {
    ticket_id: ticketId,
    entry_type: 'system',
    body,
    created_by: actorId,
  };
  const { error } = await supabase.from('om_ticket_events').insert(insert);
  if (error) {
    console.error(`${op} Failed (non-blocking):`, { ticketId, code: error.code, message: error.message });
  }
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
  escalated: 'Escalated',
};

// SLA defaults per severity — centralized so createServiceTicket and
// updateServiceTicket agree.
function slaHoursForSeverity(severity: string): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 24;
    case 'medium':
      return 48;
    default:
      return 72;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Create Service Ticket
// ═══════════════════════════════════════════════════════════════════════

export async function createServiceTicket(input: {
  projectId?: string;
  projectNameCustom?: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  assignedTo?: string;
  /** Defaults to 'open'. Creating straight into resolved/closed stamps the resolution fields. */
  status?: TicketStatus;
  /** "Done By" — explicit employee attribution. */
  doneBy?: string | null;
  serviceAmount?: number;
  /** Back-dated creation, 'YYYY-MM-DD'. Defaults to now. */
  createdAt?: string;
}): Promise<ActionResult<{ ticketId: string; ticketNumber: string }>> {
  const op = '[createServiceTicket]';
  console.log(`${op} Starting: ${input.title}`);

  if (!input.projectId && !input.projectNameCustom?.trim()) {
    return err('A project or a project name is required');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Get employee ID
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!employee) return err('Employee profile not found');

  // Generate ticket number
  const { data: lastTicket } = await supabase
    .from('om_service_tickets')
    .select('ticket_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNum = lastTicket?.ticket_number
    ? parseInt(lastTicket.ticket_number.split('-').pop() ?? '0', 10) + 1
    : 1;
  const ticketNumber = `TKT-${String(nextNum).padStart(4, '0')}`;

  const status: TicketStatus = input.status ?? 'open';

  const insert: ServiceTicketInsert = {
    project_id: input.projectId || null,
    project_name_custom: input.projectId ? null : (input.projectNameCustom?.trim() ?? null),
    title: input.title,
    description: input.description,
    issue_type: input.issueType,
    severity: input.severity,
    status,
    ticket_number: ticketNumber,
    raised_by_employee: employee.id,
    assigned_to: input.assignedTo || null,
    resolved_by: input.doneBy || null,
    service_amount: input.serviceAmount ?? 0,
    sla_hours: slaHoursForSeverity(input.severity),
  };

  // Back-dated entry — service work is routinely logged days after the visit.
  // Stamped at IST midday (06:30 UTC) so the UTC-stored value never renders as
  // the previous day in Asia/Kolkata.
  if (input.createdAt) insert.created_at = `${input.createdAt}T06:30:00.000Z`;

  // Created straight into resolved/closed: apply the same stamping the toggle
  // uses, or the row sits closed with a null resolved_at.
  const stamp: ServiceTicketUpdate = {};
  applyStatusTransition(stamp, status, employee.id, input.doneBy || null);
  Object.assign(insert, stamp);

  const { data, error } = await supabase
    .from('om_service_tickets')
    .insert(insert)
    .select('id, ticket_number')
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    return err(error?.message ?? 'Failed to create ticket', error?.code);
  }

  await logSystemEvent(supabase, data.id, 'Ticket created', employee.id);

  revalidatePath('/om/tickets');

  void emitOmTicketCreated(data.id);
  // Logged as already-done: downstream resolution consumers would otherwise
  // never see this ticket, since no status transition will ever fire.
  if (status === 'resolved' || status === 'closed') void emitOmTicketResolved(data.id);

  return ok({ ticketId: data.id, ticketNumber: data.ticket_number });
}

async function emitOmTicketCreated(ticketId: string): Promise<void> {
  const op = '[emitOmTicketCreated]';
  try {
    const supabase = await createClient();
    const { data: enriched } = await supabase
      .from('om_service_tickets')
      .select(`
        id,
        ticket_number,
        title,
        description,
        issue_type,
        severity,
        sla_hours,
        project:projects!om_service_tickets_project_id_fkey ( project_number, customer_name, customer_phone ),
        assignee:employees!om_service_tickets_assigned_to_fkey ( id, full_name, whatsapp_number ),
        raiser:employees!om_service_tickets_raised_by_employee_fkey ( full_name )
      `)
      .eq('id', ticketId)
      .single();
    if (!enriched) return;

    const project = Array.isArray(enriched.project) ? enriched.project[0] : enriched.project;
    const assignee = Array.isArray(enriched.assignee) ? enriched.assignee[0] : enriched.assignee;
    const raiser = Array.isArray(enriched.raiser) ? enriched.raiser[0] : enriched.raiser;

    await emitErpEvent('om_ticket.created', {
      ticket_id: enriched.id,
      ticket_number: enriched.ticket_number,
      title: enriched.title,
      description: enriched.description,
      issue_type: enriched.issue_type,
      severity: enriched.severity,
      sla_hours: enriched.sla_hours,
      project_code: project?.project_number ?? null,
      customer_name: project?.customer_name ?? null,
      customer_phone: project?.customer_phone ?? null,
      raised_by_name: raiser?.full_name ?? null,
      assignee_name: assignee?.full_name ?? null,
      assignee_whatsapp: assignee?.whatsapp_number ?? null,
      erp_url: `https://erp.shiroienergy.com/om/tickets/${enriched.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      ticketId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Update Service Ticket
// ═══════════════════════════════════════════════════════════════════════

export async function updateServiceTicket(input: {
  ticketId: string;
  projectId?: string;
  projectNameCustom?: string;
  title?: string;
  description?: string;
  issueType?: string;
  severity?: string;
  status?: TicketStatus;
  assignedTo?: string;
  /** "Done By" — explicit employee attribution. `null` clears, `undefined` leaves as-is. */
  doneBy?: string | null;
  serviceAmount?: number;
  resolutionNotes?: string;
}): Promise<ActionResult<void>> {
  const op = '[updateServiceTicket]';
  console.log(`${op} Starting for ticket: ${input.ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Load current row so the system-event log can summarise what actually changed.
  const { data: current, error: loadError } = await supabase
    .from('om_service_tickets')
    .select('title, issue_type, severity, status, assigned_to, resolved_by, service_amount, project_id, project_name_custom')
    .eq('id', input.ticketId)
    .maybeSingle();
  if (loadError) {
    console.error(`${op} Load failed:`, { code: loadError.code, message: loadError.message });
    return err(loadError.message, loadError.code);
  }
  if (!current) return err('Ticket not found');

  const updateData: ServiceTicketUpdate = {};
  const changes: string[] = [];

  // Project reassignment: a project id and a free-text name are mutually exclusive
  // (CHECK om_service_tickets_project_or_custom — exactly one is non-null).
  if (input.projectId !== undefined && input.projectId) {
    updateData.project_id = input.projectId;
    updateData.project_name_custom = null;
    if (input.projectId !== current.project_id) changes.push('project reassigned');
  } else if (input.projectNameCustom !== undefined && input.projectNameCustom.trim()) {
    updateData.project_id = null;
    updateData.project_name_custom = input.projectNameCustom.trim();
    if (input.projectNameCustom.trim() !== current.project_name_custom) changes.push('project name updated');
  }

  if (input.title !== undefined && input.title !== current.title) {
    updateData.title = input.title;
    changes.push('title');
  }
  if (input.description !== undefined) updateData.description = input.description || '';
  if (input.issueType !== undefined && input.issueType !== current.issue_type) {
    updateData.issue_type = input.issueType;
    changes.push(`issue type → ${input.issueType.replace(/_/g, ' ')}`);
  }
  if (input.severity !== undefined && input.severity !== current.severity) {
    updateData.severity = input.severity;
    updateData.sla_hours = slaHoursForSeverity(input.severity);
    changes.push(`severity → ${input.severity}`);
  }
  if (input.assignedTo !== undefined && (input.assignedTo || null) !== current.assigned_to) {
    updateData.assigned_to = input.assignedTo || null;
    changes.push(input.assignedTo ? 'reassigned' : 'unassigned');
  }
  if (input.serviceAmount !== undefined && input.serviceAmount !== Number(current.service_amount)) {
    updateData.service_amount = input.serviceAmount;
    changes.push('service amount');
  }
  if (input.resolutionNotes !== undefined) updateData.resolution_notes = input.resolutionNotes || null;

  // Status edits go through the same resolution-stamping logic as the inline toggle.
  let statusChanged = false;
  if (input.status !== undefined && input.status !== current.status) {
    applyStatusTransition(updateData, input.status, await getCurrentEmployeeId(), current.resolved_by ?? null);
    statusChanged = true;
    changes.push(`status → ${STATUS_LABELS[input.status] ?? input.status}`);
  }

  // Applied after the transition so an explicit "Done By" always beats the
  // fill-if-empty auto-stamp above.
  if (input.doneBy !== undefined && (input.doneBy || null) !== (current.resolved_by ?? null)) {
    updateData.resolved_by = input.doneBy || null;
    changes.push(input.doneBy ? 'done by' : 'done by cleared');
  }

  const { error } = await supabase
    .from('om_service_tickets')
    .update(updateData)
    .eq('id', input.ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  if (changes.length > 0) {
    await logSystemEvent(supabase, input.ticketId, `Ticket updated: ${changes.join(', ')}`, await getCurrentEmployeeId());
  }
  if (statusChanged && (input.status === 'resolved' || input.status === 'closed')) {
    void emitOmTicketResolved(input.ticketId);
  }

  revalidatePath('/om/tickets');
  revalidatePath(`/om/tickets/${input.ticketId}`);
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Toggle Ticket Status
// ═══════════════════════════════════════════════════════════════════════

/**
 * Stamp resolution/close fields on an update payload for a status transition.
 * Shared by the inline toggle (updateTicketStatus) and the detail-page edit
 * (updateServiceTicket) so both agree on resolved_at/resolved_by/closed_at.
 */
function applyStatusTransition(
  updateData: ServiceTicketUpdate,
  newStatus: TicketStatus,
  actorId: string | null,
  currentResolvedBy: string | null,
): void {
  updateData.status = newStatus;
  const nowIso = new Date().toISOString();
  if (newStatus === 'resolved' || newStatus === 'closed') {
    updateData.resolved_at = nowIso;
    if (newStatus === 'closed') updateData.closed_at = nowIso;
    // Fill-if-empty: "Done By" is an explicit picker now, so the actor is only a
    // fallback for tickets nobody has attributed yet. Overwriting here would put
    // the admin who clicked the toggle over the technician who did the work.
    if (actorId && !currentResolvedBy) updateData.resolved_by = actorId;
  } else if (newStatus === 'open') {
    updateData.resolved_at = null;
    updateData.closed_at = null;
    // resolved_by deliberately preserved — reopening shouldn't erase a
    // deliberately entered technician. Clear it via the Done By picker instead.
  }
}

export async function updateTicketStatus(
  ticketId: string,
  newStatus: TicketStatus,
): Promise<ActionResult<void>> {
  const op = '[updateTicketStatus]';
  console.log(`${op} Toggling ticket ${ticketId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const actorId = await getCurrentEmployeeId();

  // Needed so the auto-stamp stays fill-if-empty and never clobbers an
  // explicitly picked "Done By".
  const { data: current } = await supabase
    .from('om_service_tickets')
    .select('resolved_by')
    .eq('id', ticketId)
    .maybeSingle();

  const updateData: ServiceTicketUpdate = {};
  applyStatusTransition(updateData, newStatus, actorId, current?.resolved_by ?? null);

  const { error } = await supabase
    .from('om_service_tickets')
    .update(updateData)
    .eq('id', ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  await logSystemEvent(supabase, ticketId, `Status changed to ${STATUS_LABELS[newStatus] ?? newStatus}`, actorId);

  if (newStatus === 'resolved' || newStatus === 'closed') {
    void emitOmTicketResolved(ticketId);
  }

  revalidatePath('/om/tickets');
  revalidatePath(`/om/tickets/${ticketId}`);
  return ok(undefined);
}

async function emitOmTicketResolved(ticketId: string): Promise<void> {
  const op = '[emitOmTicketResolved]';
  try {
    const supabase = await createClient();
    const { data: enriched } = await supabase
      .from('om_service_tickets')
      .select(`
        id,
        ticket_number,
        title,
        severity,
        status,
        resolution_notes,
        resolved_at,
        sla_breached,
        project:projects!om_service_tickets_project_id_fkey ( project_number, customer_name, customer_phone ),
        resolver:employees!om_service_tickets_resolved_by_fkey ( full_name, whatsapp_number )
      `)
      .eq('id', ticketId)
      .single();
    if (!enriched) return;

    const project = Array.isArray(enriched.project) ? enriched.project[0] : enriched.project;
    const resolver = Array.isArray(enriched.resolver) ? enriched.resolver[0] : enriched.resolver;

    await emitErpEvent('om_ticket.resolved', {
      ticket_id: enriched.id,
      ticket_number: enriched.ticket_number,
      title: enriched.title,
      severity: enriched.severity,
      status: enriched.status,
      resolution_notes: enriched.resolution_notes,
      resolved_at: enriched.resolved_at,
      sla_breached: enriched.sla_breached,
      project_code: project?.project_number ?? null,
      customer_name: project?.customer_name ?? null,
      customer_phone: project?.customer_phone ?? null,
      resolved_by_name: resolver?.full_name ?? null,
      resolved_by_whatsapp: resolver?.whatsapp_number ?? null,
      erp_url: `https://erp.shiroienergy.com/om/tickets/${enriched.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      ticketId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Delete Ticket (soft-close)
// ═══════════════════════════════════════════════════════════════════════

export async function deleteServiceTicket(ticketId: string): Promise<ActionResult<void>> {
  const op = '[deleteServiceTicket]';
  console.log(`${op} Hard-deleting ticket: ${ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Gather every Storage path owned by this ticket (ticket-level docs + per-event
  // attachments) so we can clean up the bucket before the row + events cascade away.
  const { data: ticket } = await supabase
    .from('om_service_tickets')
    .select('attachment_paths')
    .eq('id', ticketId)
    .maybeSingle();
  const { data: events } = await supabase
    .from('om_ticket_events')
    .select('attachment_path')
    .eq('ticket_id', ticketId);

  const paths = [
    ...(ticket?.attachment_paths ?? []),
    ...(events ?? []).map((e) => e.attachment_path).filter((p): p is string => !!p),
  ];
  if (paths.length > 0) {
    // Best-effort: a Storage failure must not block the row delete.
    const { error: storageError } = await supabase.storage.from('project-files').remove(paths);
    if (storageError) {
      console.error(`${op} Storage cleanup failed (non-blocking):`, { ticketId, message: storageError.message });
    }
  }

  // Hard delete — om_ticket_events rows cascade via the FK (ON DELETE CASCADE).
  const { error } = await supabase
    .from('om_service_tickets')
    .delete()
    .eq('id', ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/tickets');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Get All Tickets (paginated, filtered)
// ═══════════════════════════════════════════════════════════════════════

export type TicketListRow = Pick<
  ServiceTicket,
  | 'id' | 'ticket_number' | 'title' | 'description' | 'issue_type'
  | 'severity' | 'status' | 'service_amount' | 'created_at'
  | 'sla_deadline' | 'sla_breached' | 'sla_hours' | 'resolved_at'
  | 'closed_at' | 'resolution_notes' | 'assigned_to' | 'project_id'
  | 'project_name_custom' | 'raised_by_employee'
> & {
  projects: { project_number: string; customer_name: string } | null;
  assignee: { full_name: string } | null;
  resolved_by_employee: { full_name: string } | null;
};

export async function getAllTickets(filters: {
  status?: string;
  severity?: string;
  issue_type?: string;
  project_id?: string;
  assigned_to?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<{ tickets: TicketListRow[]; total: number }> {
  const op = '[getAllTickets]';
  const supabase = await createClient();
  const page = filters.page || 1;
  const perPage = filters.per_page || 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .from('om_service_tickets')
    .select(
      'id, ticket_number, title, description, issue_type, severity, status, service_amount, created_at, sla_deadline, sla_breached, sla_hours, resolved_at, closed_at, resolution_notes, assigned_to, project_id, project_name_custom, raised_by_employee, projects!om_service_tickets_project_id_fkey(project_number, customer_name), assignee:employees!om_service_tickets_assigned_to_fkey(full_name), resolved_by_employee:employees!om_service_tickets_resolved_by_fkey(full_name)',
      { count: 'estimated' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.status) {
    if (filters.status === 'open') {
      query = query.not('status', 'in', '("resolved","closed")');
    } else if (filters.status === 'resolved') {
      query = query.eq('status', 'resolved');
    } else if (filters.status === 'closed') {
      query = query.eq('status', 'closed');
    } else {
      const VALID: TicketStatus[] = [
        'open', 'assigned', 'in_progress', 'resolved', 'closed', 'escalated',
      ];
      if ((VALID as string[]).includes(filters.status)) {
        query = query.eq('status', filters.status as TicketStatus);
      }
    }
  }
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.issue_type) query = query.eq('issue_type', filters.issue_type);
  if (filters.project_id) query = query.eq('project_id', filters.project_id);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.search) {
    // Free-text search across the ticket title, its free-text project name, OR
    // the linked project's customer/number/name (shared RPC) so typing a
    // customer name filters the table live, like the Projects list.
    const s = sanitizeForIlike(filters.search);
    const projectIds = await matchProjectIdsByText(filters.search);
    const clauses = [`title.ilike.${s}`, `project_name_custom.ilike.${s}`];
    if (projectIds.length > 0) clauses.push(`project_id.in.(${projectIds.join(',')})`);
    query = query.or(clauses.join(','));
  }

  const { data, error, count } = await query.returns<TicketListRow[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { tickets: [], total: 0 };
  }

  return { tickets: data ?? [], total: count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// Total Service Amount (SQL SUM — NEVER-DO #12: never aggregate money in JS)
// ═══════════════════════════════════════════════════════════════════════

export async function getServiceTicketAmountTotal(): Promise<number> {
  const op = '[getServiceTicketAmountTotal]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_service_ticket_amount_total');
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return 0;
  }
  return Number(data ?? 0);
}

// ═══════════════════════════════════════════════════════════════════════
// KPIs — open / closed counts + total amount in one SQL call (NEVER-DO #12)
// ═══════════════════════════════════════════════════════════════════════

export interface TicketKpis {
  openCount: number;
  closedCount: number;
  totalAmount: number;
}

export async function getServiceTicketKpis(): Promise<TicketKpis> {
  const op = '[getServiceTicketKpis]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_service_ticket_kpis');
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { openCount: 0, closedCount: 0, totalAmount: 0 };
  }
  // RETURNS TABLE → a one-row array.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    openCount: Number(row?.open_count ?? 0),
    closedCount: Number(row?.closed_count ?? 0),
    totalAmount: Number(row?.total_amount ?? 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Ticket detail (single ticket + ordered timeline)
// ═══════════════════════════════════════════════════════════════════════

export type TicketEventRow = Pick<
  TicketEvent,
  'id' | 'entry_type' | 'body' | 'attachment_path' | 'attachment_name' | 'created_by' | 'created_at'
> & {
  author: { full_name: string } | null;
};

export type TicketDetail = ServiceTicket & {
  projects: { project_number: string | null; customer_name: string } | null;
  assignee: { full_name: string } | null;
  resolved_by_employee: { full_name: string } | null;
  events: TicketEventRow[];
};

export async function getTicketDetail(ticketId: string): Promise<TicketDetail | null> {
  const op = '[getTicketDetail]';
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('om_service_tickets')
    .select(
      '*, projects!om_service_tickets_project_id_fkey(project_number, customer_name), assignee:employees!om_service_tickets_assigned_to_fkey(full_name), resolved_by_employee:employees!om_service_tickets_resolved_by_fkey(full_name)',
    )
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return null;
  }
  if (!ticket) return null;

  const { data: events, error: eventsError } = await supabase
    .from('om_ticket_events')
    .select('id, entry_type, body, attachment_path, attachment_name, created_by, created_at, author:employees!om_ticket_events_created_by_fkey(full_name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  if (eventsError) {
    console.error(`${op} Events query failed:`, { code: eventsError.code, message: eventsError.message });
  }

  return {
    ...(ticket as ServiceTicket),
    projects: (ticket as TicketDetail).projects ?? null,
    assignee: (ticket as TicketDetail).assignee ?? null,
    resolved_by_employee: (ticket as TicketDetail).resolved_by_employee ?? null,
    events: (events as TicketEventRow[] | null) ?? [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Timeline — manual notes
// ═══════════════════════════════════════════════════════════════════════

export async function addTicketEvent(input: {
  ticketId: string;
  body: string;
  attachmentPath?: string;
  attachmentName?: string;
}): Promise<ActionResult<void>> {
  const op = '[addTicketEvent]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  if (!input.body.trim() && !input.attachmentPath) {
    return err('Add a note or attach a file');
  }

  const actorId = await getCurrentEmployeeId();
  const insert: TicketEventInsert = {
    ticket_id: input.ticketId,
    entry_type: 'note',
    body: input.body.trim() || '(attachment)',
    attachment_path: input.attachmentPath ?? null,
    attachment_name: input.attachmentName ?? null,
    created_by: actorId,
  };

  const { error } = await supabase.from('om_ticket_events').insert(insert);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath(`/om/tickets/${input.ticketId}`);
  return ok(undefined);
}

export async function deleteTicketEvent(
  eventId: string,
  ticketId: string,
): Promise<ActionResult<void>> {
  const op = '[deleteTicketEvent]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Clean up the entry's attachment (best-effort) before deleting the row.
  const { data: event } = await supabase
    .from('om_ticket_events')
    .select('attachment_path, entry_type')
    .eq('id', eventId)
    .maybeSingle();

  if (event?.entry_type === 'system') {
    return err('System events cannot be deleted');
  }
  if (event?.attachment_path) {
    const { error: storageError } = await supabase.storage.from('project-files').remove([event.attachment_path]);
    if (storageError) {
      console.error(`${op} Storage cleanup failed (non-blocking):`, { eventId, message: storageError.message });
    }
  }

  const { error } = await supabase.from('om_ticket_events').delete().eq('id', eventId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath(`/om/tickets/${ticketId}`);
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Ticket-level supporting documents
// ═══════════════════════════════════════════════════════════════════════

export async function addTicketAttachment(input: {
  ticketId: string;
  path: string;
  name: string;
}): Promise<ActionResult<void>> {
  const op = '[addTicketAttachment]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: ticket, error: loadError } = await supabase
    .from('om_service_tickets')
    .select('attachment_paths, attachment_names')
    .eq('id', input.ticketId)
    .maybeSingle();
  if (loadError) {
    console.error(`${op} Load failed:`, { code: loadError.code, message: loadError.message });
    return err(loadError.message, loadError.code);
  }
  if (!ticket) return err('Ticket not found');

  const paths = [...(ticket.attachment_paths ?? []), input.path];
  const names = [...(ticket.attachment_names ?? []), input.name];

  const { error } = await supabase
    .from('om_service_tickets')
    .update({ attachment_paths: paths, attachment_names: names })
    .eq('id', input.ticketId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  await logSystemEvent(supabase, input.ticketId, `Document added: ${input.name}`, await getCurrentEmployeeId());

  revalidatePath(`/om/tickets/${input.ticketId}`);
  return ok(undefined);
}

export async function removeTicketAttachment(input: {
  ticketId: string;
  path: string;
}): Promise<ActionResult<void>> {
  const op = '[removeTicketAttachment]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: ticket, error: loadError } = await supabase
    .from('om_service_tickets')
    .select('attachment_paths, attachment_names')
    .eq('id', input.ticketId)
    .maybeSingle();
  if (loadError) {
    console.error(`${op} Load failed:`, { code: loadError.code, message: loadError.message });
    return err(loadError.message, loadError.code);
  }
  if (!ticket) return err('Ticket not found');

  const paths = ticket.attachment_paths ?? [];
  const names = ticket.attachment_names ?? [];
  const idx = paths.indexOf(input.path);
  if (idx === -1) return ok(undefined); // already gone

  const nextPaths = paths.filter((_, i) => i !== idx);
  const nextNames = names.filter((_, i) => i !== idx);

  const { error: storageError } = await supabase.storage.from('project-files').remove([input.path]);
  if (storageError) {
    console.error(`${op} Storage cleanup failed (non-blocking):`, { message: storageError.message });
  }

  const { error } = await supabase
    .from('om_service_tickets')
    .update({ attachment_paths: nextPaths, attachment_names: nextNames })
    .eq('id', input.ticketId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath(`/om/tickets/${input.ticketId}`);
  return ok(undefined);
}
