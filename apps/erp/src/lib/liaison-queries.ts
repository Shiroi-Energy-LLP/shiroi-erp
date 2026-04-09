import { createClient } from '@repo/supabase/server';

export async function getNetMeteringApplication(projectId: string) {
  const op = '[getNetMeteringApplication]';
  console.log(`${op} Starting for: ${projectId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('net_metering_applications')
    .select('*, projects(id, project_number, customer_name, system_size_kwp, system_type, site_city, ceig_required, ceig_cleared), employees!net_metering_applications_managed_by_fkey(full_name)')
    .eq('project_id', projectId)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to load net metering application: ${error.message}`);
  }
  return data;
}

export async function getLiaisonDocuments(projectId: string) {
  const op = '[getLiaisonDocuments]';
  console.log(`${op} Starting for: ${projectId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('liaison_documents')
    .select('*, employees!liaison_documents_uploaded_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load liaison documents: ${error.message}`);
  }
  return data ?? [];
}

export async function getLiaisonObjections(projectId: string) {
  const op = '[getLiaisonObjections]';
  console.log(`${op} Starting for: ${projectId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('liaison_objections')
    .select('*')
    .eq('project_id', projectId)
    .order('objection_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load liaison objections: ${error.message}`);
  }
  return data ?? [];
}

export async function getAllNetMeteringApplications(filters: {
  ceigStatus?: string;
  discomStatus?: string;
  search?: string;
} = {}) {
  const op = '[getAllNetMeteringApplications]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('net_metering_applications')
    .select('*, projects(id, project_number, customer_name, system_size_kwp, system_type, site_city, ceig_required)')
    .order('created_at', { ascending: false });

  if (filters.ceigStatus) {
    query = query.eq('ceig_status', filters.ceigStatus);
  }
  if (filters.discomStatus) {
    query = query.eq('discom_status', filters.discomStatus);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load net metering applications: ${error.message}`);
  }

  let results = data ?? [];

  // Client-side search on project name/number (join filter not supported well in Supabase)
  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter((app: any) =>
      app.projects?.customer_name?.toLowerCase().includes(s) ||
      app.projects?.project_number?.toLowerCase().includes(s) ||
      app.discom_application_number?.toLowerCase().includes(s)
    );
  }

  return results;
}
