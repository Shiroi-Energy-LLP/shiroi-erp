'use server';

import { createClient } from '@repo/supabase/server';

export async function getProjectsWithTickets(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getProjectsWithTickets]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('om_service_tickets' as any)
    .select('project_id, projects!om_service_tickets_project_id_fkey(id, project_number, customer_name)')
    .not('project_id', 'is', null)
    .limit(500);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  const seen = new Set<string>();
  const result: { id: string; project_number: string; customer_name: string }[] = [];
  for (const row of data ?? []) {
    const p = (row as any).projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({ id: p.id, project_number: p.project_number, customer_name: p.customer_name });
    }
  }
  return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
}
