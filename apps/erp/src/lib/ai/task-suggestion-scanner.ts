// Server-only utility — no 'use server' directive needed (not a Server Action module).
import { createAdminClient } from '@repo/supabase/admin';
import type { Database } from '@repo/types/database';

import { MS_PER_DAY } from '@/lib/helpers/time-helpers';

type LeadRow = Database['public']['Tables']['leads']['Row'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];
type TicketRow = Database['public']['Tables']['om_service_tickets']['Row'];

export interface StaleItem {
  entity_type: 'lead' | 'project' | 'service_ticket';
  entity_id: string;
  staleness_signal: string;
  suggested_assignee_employee_id: string | null;
  context_blurb: string;
}

/**
 * scanStaleItems — finds stale leads, projects, and service tickets
 * that have no open follow-up task and returns them as StaleItem[].
 *
 * Ordered: critical service tickets first, then stale projects, then stale leads.
 * Used by the task-suggestions cron at 06:00 IST.
 */
export async function scanStaleItems(): Promise<StaleItem[]> {
  const op = '[scanStaleItems]';
  const admin = createAdminClient();

  const results: StaleItem[] = [];

  // ── 1. Critical/High service tickets open for > 3 days with no service_ticket_followup task ──
  const { data: tickets, error: ticketError } = await admin
    .from('om_service_tickets')
    .select(`
      id,
      ticket_number,
      title,
      description,
      status,
      severity,
      project_id,
      assigned_to,
      created_at,
      projects!om_service_tickets_project_id_fkey(project_number, customer_name)
    `)
    .eq('status', 'open')
    .in('severity', ['critical', 'high'])
    .lt('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .is('closed_at', null)
    .returns<(TicketRow & {
      projects: { project_number: string; customer_name: string } | null;
    })[]>();

  if (ticketError) {
    console.error(`${op} Ticket query failed:`, { error: ticketError, timestamp: new Date().toISOString() });
  } else if (tickets && tickets.length > 0) {
    // Batch lookup: pull all open tasks for any of these tickets in a single query,
    // then index by entity_id for O(1) lookup inside the loop.
    const ticketIds = tickets.map((t) => t.id);
    const { data: openTaskRows, error: openTaskErr } = await admin
      .from('tasks')
      .select('entity_id')
      .eq('entity_type', 'service_ticket')
      .in('entity_id', ticketIds)
      .eq('is_completed', false)
      .is('deleted_at', null);

    if (openTaskErr) {
      console.error(`${op} Ticket open-task batch query failed:`, { error: openTaskErr, timestamp: new Date().toISOString() });
    }

    const ticketsWithOpenTask = new Set<string>();
    for (const row of openTaskRows ?? []) {
      if (row.entity_id) ticketsWithOpenTask.add(row.entity_id);
    }

    for (const ticket of tickets) {
      // Skip if this ticket already has an open service_ticket_followup task
      if (ticketsWithOpenTask.has(ticket.id)) continue;

      const proj = ticket.projects;
      const projectRef = proj ? `${proj.project_number} (${proj.customer_name})` : 'unknown project';
      const daysOld = Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / (MS_PER_DAY));

      results.push({
        entity_type: 'service_ticket',
        entity_id: ticket.id,
        staleness_signal: `open_${ticket.severity}_ticket_${daysOld}d`,
        suggested_assignee_employee_id: ticket.assigned_to ?? null,
        context_blurb:
          `Ticket ${ticket.ticket_number} for project ${projectRef}. ` +
          `Severity: ${ticket.severity}. Issue: "${ticket.title}". ` +
          `Open for ${daysOld} days with no resolution.`,
      });
    }
  }

  // ── 2. Projects stale > 21 days with no open project_followup task ──
  const { data: projects, error: projectError } = await admin
    .from('projects')
    .select(`
      id,
      project_number,
      customer_name,
      status,
      status_updated_at,
      project_manager_id,
      system_size_kwp,
      site_city
    `)
    .in('status', ['in_progress', 'yet_to_start', 'holding_shiroi'])
    .lt('status_updated_at', new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString())
    .is('deleted_at', null)
    .returns<Pick<ProjectRow,
      'id' | 'project_number' | 'customer_name' | 'status' | 'status_updated_at' |
      'project_manager_id' | 'system_size_kwp' | 'site_city'
    >[]>();

  if (projectError) {
    console.error(`${op} Project query failed:`, { error: projectError, timestamp: new Date().toISOString() });
  } else if (projects && projects.length > 0) {
    // Batch lookup: one query for all candidate projects' open project_followup tasks.
    const projectIds = projects.map((p) => p.id);
    const { data: openProjectTaskRows, error: openProjectTaskErr } = await admin
      .from('tasks')
      .select('entity_id')
      .eq('entity_type', 'project')
      .eq('category', 'project_followup')
      .in('entity_id', projectIds)
      .eq('is_completed', false)
      .is('deleted_at', null);

    if (openProjectTaskErr) {
      console.error(`${op} Project open-task batch query failed:`, { error: openProjectTaskErr, timestamp: new Date().toISOString() });
    }

    const projectsWithOpenTask = new Set<string>();
    for (const row of openProjectTaskRows ?? []) {
      if (row.entity_id) projectsWithOpenTask.add(row.entity_id);
    }

    for (const project of projects) {
      // Skip if this project already has an open project_followup task
      if (projectsWithOpenTask.has(project.id)) continue;

      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(project.status_updated_at).getTime()) / (MS_PER_DAY),
      );

      results.push({
        entity_type: 'project',
        entity_id: project.id,
        staleness_signal: `no_status_update_${daysSinceUpdate}d`,
        suggested_assignee_employee_id: project.project_manager_id ?? null,
        context_blurb:
          `Project ${project.project_number} for ${project.customer_name} in ${project.site_city ?? 'unknown city'}. ` +
          `${project.system_size_kwp}kWp system. Status: ${project.status}. ` +
          `Last status update: ${daysSinceUpdate} days ago.`,
      });
    }
  }

  // ── 3. Leads stale > 14 days with no open lead_followup task ──
  const { data: leads, error: leadError } = await admin
    .from('leads')
    .select(`
      id,
      customer_name,
      city,
      status,
      updated_at,
      assigned_to,
      estimated_size_kwp,
      segment
    `)
    .not('status', 'in', '("won","lost","disqualified","converted")')
    .lt('updated_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .is('deleted_at', null)
    .returns<Pick<LeadRow,
      'id' | 'customer_name' | 'city' | 'status' | 'updated_at' |
      'assigned_to' | 'estimated_size_kwp' | 'segment'
    >[]>();

  if (leadError) {
    console.error(`${op} Lead query failed:`, { error: leadError, timestamp: new Date().toISOString() });
  } else if (leads && leads.length > 0) {
    // Batch lookup: one query for all candidate leads' open lead_followup tasks.
    const leadIds = leads.map((l) => l.id);
    const { data: openLeadTaskRows, error: openLeadTaskErr } = await admin
      .from('tasks')
      .select('entity_id')
      .eq('entity_type', 'lead')
      .eq('category', 'lead_followup')
      .in('entity_id', leadIds)
      .eq('is_completed', false)
      .is('deleted_at', null);

    if (openLeadTaskErr) {
      console.error(`${op} Lead open-task batch query failed:`, { error: openLeadTaskErr, timestamp: new Date().toISOString() });
    }

    const leadsWithOpenTask = new Set<string>();
    for (const row of openLeadTaskRows ?? []) {
      if (row.entity_id) leadsWithOpenTask.add(row.entity_id);
    }

    for (const lead of leads) {
      // Skip if this lead already has an open lead_followup task
      if (leadsWithOpenTask.has(lead.id)) continue;

      const daysSinceActivity = Math.floor(
        (Date.now() - new Date(lead.updated_at).getTime()) / (MS_PER_DAY),
      );
      const sizeInfo = lead.estimated_size_kwp ? `${lead.estimated_size_kwp}kWp` : 'size unknown';

      results.push({
        entity_type: 'lead',
        entity_id: lead.id,
        staleness_signal: `no_activity_${daysSinceActivity}d`,
        suggested_assignee_employee_id: lead.assigned_to ?? null,
        context_blurb:
          `Lead: ${lead.customer_name}, ${lead.city}, ${lead.segment} segment, ${sizeInfo}. ` +
          `Current status: ${lead.status}. No activity for ${daysSinceActivity} days.`,
      });
    }
  }

  return results;
}
