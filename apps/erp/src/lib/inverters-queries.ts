'use server';

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { getSessionContext } from '@/lib/auth';

// ═══════════════════════════════════════════════════════════════════════
// getCurrentUserRole — role guard helper for the inverters page
// ═══════════════════════════════════════════════════════════════════════

export async function getCurrentUserRole(): Promise<{
  userId: string | null;
  role: string | null;
}> {
  // Shares the request-scoped session resolution (NEVER-DO #22 / master-ref §4.17).
  const { userId, role } = await getSessionContext();
  return { userId, role };
}

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

export type InverterRow = Database['public']['Tables']['inverters']['Row'];
export type InverterPollFailureRow = Database['public']['Tables']['inverter_poll_failures']['Row'];
export type InverterMonitoringCredentialRow =
  Database['public']['Tables']['inverter_monitoring_credentials']['Row'];

type ProjectLite = { id: string; customer_name: string; project_number: string | null; project_name?: string | null };

export type InverterWithProject = InverterRow & {
  projects: ProjectLite | null;
};

// ═══════════════════════════════════════════════════════════════════════
// listInverters — ordered by created_at desc, embeds project info
// ═══════════════════════════════════════════════════════════════════════

export async function listInverters(): Promise<InverterWithProject[]> {
  const op = '[listInverters]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inverters')
    .select(
      'id, project_id, serial_number, brand, model, rated_capacity_kw, string_count, commissioned_at, monitoring_credentials_id, monitoring_site_id, monitoring_device_id, polling_interval_minutes, polling_enabled, last_poll_at, last_reading_at, current_status, created_at, updated_at, projects!inverters_project_id_fkey(id, customer_name, project_number)',
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} failed`, { error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return (data ?? []) as unknown as InverterWithProject[];
}

// ═══════════════════════════════════════════════════════════════════════
// getInverterById
// ═══════════════════════════════════════════════════════════════════════

export async function getInverterById(id: string): Promise<InverterWithProject | null> {
  const op = '[getInverterById]';
  if (!id) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inverters')
    .select(
      'id, project_id, serial_number, brand, model, rated_capacity_kw, string_count, commissioned_at, monitoring_credentials_id, monitoring_site_id, monitoring_device_id, polling_interval_minutes, polling_enabled, last_poll_at, last_reading_at, current_status, created_at, updated_at, projects!inverters_project_id_fkey(id, customer_name, project_number)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} failed`, { id, error: error.message, timestamp: new Date().toISOString() });
    return null;
  }

  return (data ?? null) as unknown as InverterWithProject | null;
}

// ═══════════════════════════════════════════════════════════════════════
// listRecentPollFailures
// ═══════════════════════════════════════════════════════════════════════

export async function listRecentPollFailures(limit = 20): Promise<InverterPollFailureRow[]> {
  const op = '[listRecentPollFailures]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inverter_poll_failures')
    .select('*')
    .order('attempted_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`${op} failed`, { error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// listInvertersByProject
// ═══════════════════════════════════════════════════════════════════════

export async function listInvertersByProject(projectId: string): Promise<InverterRow[]> {
  const op = '[listInvertersByProject]';
  if (!projectId) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inverters')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} failed`, { projectId, error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// listInverterMonitoringCredentials — for the credential picker in the dialogs
// ═══════════════════════════════════════════════════════════════════════

export async function listInverterMonitoringCredentials(
  brand?: string,
): Promise<InverterMonitoringCredentialRow[]> {
  const op = '[listInverterMonitoringCredentials]';
  const supabase = await createClient();

  let query = supabase
    .from('inverter_monitoring_credentials')
    .select('*')
    .order('label', { ascending: true });

  if (brand) {
    query = query.eq('brand', brand);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${op} failed`, { brand, error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// getAllProjectsForInverters — for the Add dialog's project picker
// ═══════════════════════════════════════════════════════════════════════

export async function getAllProjectsForInverters(): Promise<ProjectLite[]> {
  const op = '[getAllProjectsForInverters]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number, project_name')
    .order('customer_name', { ascending: true })
    .limit(1000);

  if (error) {
    console.error(`${op} failed`, { error: error.message, timestamp: new Date().toISOString() });
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    customer_name: p.customer_name ?? '',
    project_number: p.project_number ?? null,
    project_name: p.project_name ?? null,
  }));
}
