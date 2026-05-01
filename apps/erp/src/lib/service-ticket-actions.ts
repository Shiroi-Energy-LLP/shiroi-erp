'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { emitErpEvent } from '@/lib/n8n/emit';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type ServiceTicket = Database['public']['Tables']['om_service_tickets']['Row'];
type ServiceTicketInsert = Database['public']['Tables']['om_service_tickets']['Insert'];
type ServiceTicketUpdate = Database['public']['Tables']['om_service_tickets']['Update'];
export type TicketStatus = Database['public']['Enums']['ticket_status'];

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
  projectId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  assignedTo?: string;
}): Promise<ActionResult<{ ticketId: string; ticketNumber: string }>> {
  const op = '[createServiceTicket]';
  console.log(`${op} Starting: ${input.title}`);

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

  const insert: ServiceTicketInsert = {
    project_id: input.projectId,
    title: input.title,
    description: input.description,
    issue_type: input.issueType,
    severity: input.severity,
    status: 'open',
    ticket_number: ticketNumber,
    raised_by_employee: employee.id,
    assigned_to: input.assignedTo || null,
    sla_hours: slaHoursForSeverity(input.severity),
  };

  const { data, error } = await supabase
    .from('om_service_tickets')
    .insert(insert)
    .select('id, ticket_number')
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    return err(error?.message ?? 'Failed to create ticket', error?.code);
  }

  revalidatePath('/om/tickets');

  void emitOmTicketCreated(data.id);

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
  title?: string;
  description?: string;
  issueType?: string;
  severity?: string;
  assignedTo?: string;
  serviceAmount?: number;
  resolutionNotes?: string;
}): Promise<ActionResult<void>> {
  const op = '[updateServiceTicket]';
  console.log(`${op} Starting for ticket: ${input.ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: ServiceTicketUpdate = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description || '';
  if (input.issueType !== undefined) updateData.issue_type = input.issueType;
  if (input.severity !== undefined) {
    updateData.severity = input.severity;
    updateData.sla_hours = slaHoursForSeverity(input.severity);
  }
  if (input.assignedTo !== undefined) updateData.assigned_to = input.assignedTo || null;
  if (input.serviceAmount !== undefined) updateData.service_amount = input.serviceAmount;
  if (input.resolutionNotes !== undefined) updateData.resolution_notes = input.resolutionNotes || null;

  const { error } = await supabase
    .from('om_service_tickets')
    .update(updateData)
    .eq('id', input.ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/tickets');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Toggle Ticket Status
// ═══════════════════════════════════════════════════════════════════════

export async function updateTicketStatus(
  ticketId: string,
  newStatus: TicketStatus,
): Promise<ActionResult<void>> {
  const op = '[updateTicketStatus]';
  console.log(`${op} Toggling ticket ${ticketId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: ServiceTicketUpdate = { status: newStatus };

  if (newStatus === 'resolved' || newStatus === 'closed') {
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    if (newStatus === 'resolved') {
      updateData.resolved_at = nowIso;
      if (emp) updateData.resolved_by = emp.id;
    }
    if (newStatus === 'closed') {
      updateData.closed_at = nowIso;
      updateData.resolved_at = nowIso;
      if (emp) updateData.resolved_by = emp.id;
    }
  }

  if (newStatus === 'open') {
    updateData.resolved_at = null;
    updateData.resolved_by = null;
    updateData.closed_at = null;
  }

  const { error } = await supabase
    .from('om_service_tickets')
    .update(updateData)
    .eq('id', ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/tickets');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Delete Ticket (soft-close)
// ═══════════════════════════════════════════════════════════════════════

export async function deleteServiceTicket(ticketId: string): Promise<ActionResult<void>> {
  const op = '[deleteServiceTicket]';
  console.log(`${op} Closing ticket: ${ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: ServiceTicketUpdate = {
    status: 'closed',
    closed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('om_service_tickets')
    .update(update)
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
  | 'raised_by_employee'
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
      'id, ticket_number, title, description, issue_type, severity, status, service_amount, created_at, sla_deadline, sla_breached, sla_hours, resolved_at, closed_at, resolution_notes, assigned_to, project_id, raised_by_employee, projects!om_service_tickets_project_id_fkey(project_number, customer_name), assignee:employees!om_service_tickets_assigned_to_fkey(full_name), resolved_by_employee:employees!om_service_tickets_resolved_by_fkey(full_name)',
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
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  const { data, error, count } = await query.returns<TicketListRow[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { tickets: [], total: 0 };
  }

  return { tickets: data ?? [], total: count ?? 0 };
}
