'use server';

import { createClient } from '@repo/supabase/server';

type ProjectLite = { id: string; project_number: string; customer_name: string };

type TicketWithProject = {
  project_id: string | null;
  projects: ProjectLite | null;
};

/**
 * Returns the distinct set of projects that have at least one om_service_ticket.
 * Used by the service-tickets filter dropdown so we only show projects that
 * actually have tickets (avoids empty filter clutter).
 */
export async function getProjectsWithTickets(): Promise<ProjectLite[]> {
  const op = '[getProjectsWithTickets]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('om_service_tickets')
    .select('project_id, projects!om_service_tickets_project_id_fkey(id, project_number, customer_name)')
    .not('project_id', 'is', null)
    .limit(500)
    .returns<TicketWithProject[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  const seen = new Set<string>();
  const result: ProjectLite[] = [];
  for (const row of data ?? []) {
    const p = row.projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({
        id: p.id,
        project_number: p.project_number ?? '',
        customer_name: p.customer_name ?? '',
      });
    }
  }
  return result.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}
