'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createServiceTicket(input: {
  projectId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  assignedTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createServiceTicket]';
  console.log(`${op} Starting: ${input.title}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate ticket number
  const { data: lastTicket } = await supabase
    .from('om_service_tickets' as any)
    .select('ticket_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const nextNum = lastTicket
    ? parseInt((lastTicket as any).ticket_number?.split('-').pop() ?? '0', 10) + 1
    : 1;
  const ticketNumber = `TKT-${String(nextNum).padStart(4, '0')}`;

  const { error } = await supabase
    .from('om_service_tickets' as any)
    .insert({
      project_id: input.projectId,
      title: input.title,
      description: input.description,
      issue_type: input.issueType,
      severity: input.severity,
      status: 'open',
      ticket_number: ticketNumber,
      raised_by_employee: employee.id,
      assigned_to: input.assignedTo || null,
      sla_hours: input.severity === 'critical' ? 4 : input.severity === 'high' ? 24 : 48,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/tickets');
  return { success: true };
}

// ── Update Ticket ──

export async function updateServiceTicket(input: {
  ticketId: string;
  title?: string;
  description?: string;
  issueType?: string;
  severity?: string;
  assignedTo?: string;
  serviceAmount?: number;
  resolutionNotes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateServiceTicket]';
  console.log(`${op} Starting for ticket: ${input.ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description || null;
  if (input.issueType !== undefined) updateData.issue_type = input.issueType;
  if (input.severity !== undefined) {
    updateData.severity = input.severity;
    updateData.sla_hours = input.severity === 'critical' ? 4 : input.severity === 'high' ? 24 : input.severity === 'medium' ? 48 : 72;
  }
  if (input.assignedTo !== undefined) updateData.assigned_to = input.assignedTo || null;
  if (input.serviceAmount !== undefined) updateData.service_amount = input.serviceAmount;
  if (input.resolutionNotes !== undefined) updateData.resolution_notes = input.resolutionNotes || null;

  const { error } = await supabase
    .from('om_service_tickets' as any)
    .update(updateData as any)
    .eq('id', input.ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/tickets');
  return { success: true };
}

// ── Toggle Ticket Status ──

export async function updateTicketStatus(
  ticketId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[updateTicketStatus]';
  console.log(`${op} Toggling ticket ${ticketId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = { status: newStatus };

  if (newStatus === 'resolved' || newStatus === 'closed') {
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (newStatus === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
      if (emp) updateData.resolved_by = emp.id;
    }
    if (newStatus === 'closed') {
      updateData.closed_at = new Date().toISOString();
      // Also set resolved if not already
      updateData.resolved_at = new Date().toISOString();
      if (emp) updateData.resolved_by = emp.id;
    }
  }

  // If reopening, clear resolution fields
  if (newStatus === 'open') {
    updateData.resolved_at = null;
    updateData.resolved_by = null;
    updateData.closed_at = null;
  }

  const { error } = await supabase
    .from('om_service_tickets' as any)
    .update(updateData as any)
    .eq('id', ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/tickets');
  return { success: true };
}

// ── Delete Ticket (soft-delete via closed status) ──

export async function deleteServiceTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteServiceTicket]';
  console.log(`${op} Closing ticket: ${ticketId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('om_service_tickets' as any)
    .update({ status: 'closed', closed_at: new Date().toISOString() } as any)
    .eq('id', ticketId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/tickets');
  return { success: true };
}

// ── Get All Tickets (paginated, filtered) ──

export async function getAllTickets(filters: {
  status?: string;
  severity?: string;
  issue_type?: string;
  project_id?: string;
  assigned_to?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<{ tickets: any[]; total: number }> {
  const op = '[getAllTickets]';
  const supabase = await createClient();
  const page = filters.page || 1;
  const perPage = filters.per_page || 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .from('om_service_tickets' as any)
    .select(
      'id, ticket_number, title, description, issue_type, severity, status, service_amount, created_at, sla_deadline, sla_breached, sla_hours, resolved_at, closed_at, resolution_notes, assigned_to, project_id, raised_by_employee, projects!om_service_tickets_project_id_fkey(project_number, customer_name), assignee:employees!om_service_tickets_assigned_to_fkey(full_name), resolved_by_employee:employees!om_service_tickets_resolved_by_fkey(full_name)' as any,
      { count: 'estimated' as any },
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
      query = query.eq('status', filters.status);
    }
  }
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.issue_type) query = query.eq('issue_type', filters.issue_type);
  if (filters.project_id) query = query.eq('project_id', filters.project_id);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { tickets: [], total: 0 };
  }

  return { tickets: (data ?? []) as any[], total: count ?? 0 };
}
