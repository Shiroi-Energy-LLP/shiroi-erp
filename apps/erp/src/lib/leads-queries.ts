import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

// Re-export pure helpers for convenience
export { isValidTransition, normalizePhone, getValidNextStatuses } from './leads-helpers';

export interface LeadFilters {
  status?: LeadStatus;
  source?: Database['public']['Enums']['lead_source'];
  search?: string;
  assignedTo?: string;
  includeConverted?: boolean;
}

export async function getLeads(filters: LeadFilters = {}) {
  const op = '[getLeads]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  let query = supabase
    .from('leads')
    .select('id, customer_name, phone, email, city, segment, source, status, estimated_size_kwp, assigned_to, next_followup_date, created_at, employees!leads_assigned_to_fkey(full_name)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else if (!filters.includeConverted) {
    // By default, hide migration placeholder leads (converted = already a project)
    query = query.not('status', 'eq', 'converted');
  }
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.search) query = query.or(`customer_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }
  return data ?? [];
}

export async function getLead(id: string) {
  const op = '[getLead]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('*, employees!leads_assigned_to_fkey(full_name)')
    .eq('id', id)
    .single();
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load lead: ${error.message}`);
  }
  if (!data) return null;
  return data;
}

export async function getLeadActivities(leadId: string) {
  const op = '[getLeadActivities]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*, employees!lead_activities_performed_by_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('activity_date', { ascending: false });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, leadId });
    throw new Error(`Failed to load activities: ${error.message}`);
  }
  return data ?? [];
}

export async function getSalesEngineers() {
  const op = '[getSalesEngineers]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load sales engineers: ${error.message}`);
  }
  return data ?? [];
}
