import { createClient } from '@repo/supabase/server';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Contacts ──

export interface ContactFilters {
  search?: string;
  lifecycleStage?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export async function getContacts(filters: ContactFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getContacts]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const sortCol = filters.sort ?? 'created_at';
  const sortDir = filters.dir === 'asc' ? 'asc' : 'desc';

  // TODO (security review 2026-06-06 #S10): search_contacts RPC returns the
  // entire contact row plus joined contact_company_roles + companies. That likely
  // includes email, phone, designation, and any contact-level address fields
  // — but the list view only needs id/name/role/company display columns. Audit
  // every caller of getContacts (and the RPC return shape) and trim the SELECT
  // server-side to the minimum needed before exposing this to non-founder roles.
  // Leaving as-is for now to avoid breaking downstream destructures across the
  // codebase; will need a coordinated change of the RPC signature + callers.
  // Item 2b — parameterized search RPC replaces PostgREST .or() interpolation.
  // The RPC returns nested contact_company_roles via jsonb_agg to preserve the
  // embed shape callers consume downstream.
  const { data, error } = await supabase.rpc('search_contacts', {
    p_query: filters.search ?? undefined,
    p_lifecycle_stage: filters.lifecycleStage ?? undefined,
    p_sort: sortCol,
    p_dir: sortDir,
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load contacts: ${error.message}`);
  }

  const rows = (data ?? []) as Array<any>;
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  // Strip the per-row total_count window column from the shape callers see.
  const stripped = rows.map(({ total_count: _tc, ...rest }) => rest);
  return { data: stripped, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getContact(id: string) {
  const op = '[getContact]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*, contact_company_roles(*, companies(id, name, segment))')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load contact: ${error.message}`);
  }
  return data;
}

export async function getEntityContacts(entityType: string, entityId: string) {
  const op = '[getEntityContacts]';
  console.log(`${op} Starting for: ${entityType}/${entityId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('entity_contacts')
    .select('id, role_label, is_primary, contacts(id, name, first_name, last_name, phone, email, designation)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('is_primary', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load entity contacts: ${error.message}`);
  }
  return data ?? [];
}

export async function getContactEntities(contactId: string) {
  const op = '[getContactEntities]';
  console.log(`${op} Starting for: ${contactId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('entity_contacts')
    .select('id, entity_type, entity_id, role_label, is_primary, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load contact entities: ${error.message}`);
  }
  return data ?? [];
}

export async function searchContacts(query: string) {
  const op = '[searchContacts]';
  const supabase = await createClient();

  // Item 2b — uses search_contacts RPC with name-ascending sort to mirror
  // the prior .order('name').limit(20) behaviour.
  const { data, error } = await supabase.rpc('search_contacts', {
    p_query: query,
    p_lifecycle_stage: undefined,
    p_sort: 'name',
    p_dir: 'asc',
    p_limit: 20,
    p_offset: 0,
  });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to search contacts: ${error.message}`);
  }
  const rows = (data ?? []) as Array<any>;
  return rows.map(({ id, name, first_name, last_name, phone, email, designation }) => ({
    id, name, first_name, last_name, phone, email, designation,
  }));
}

// ── Companies ──

export async function getCompanyOptions(): Promise<{ id: string; name: string }[]> {
  const op = '[getCompanyOptions]';
  const supabase = await createClient();
  const { data, error } = await supabase.from('companies').select('id, name').order('name');
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load companies: ${error.message}`);
  }
  return data ?? [];
}

export interface CompanyFilters {
  search?: string;
  segment?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getCompanies]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const sortCol = filters.sort ?? 'name';
  // Original behaviour: dir=asc OR (no dir + sortCol='name') => ascending.
  const sortDir = filters.dir === 'asc' || (!filters.dir && sortCol === 'name') ? 'asc' : 'desc';

  // Item 2b — parameterized search RPC replaces PostgREST .or() interpolation.
  const { data, error } = await supabase.rpc('search_companies', {
    p_query: filters.search ?? undefined,
    p_segment: filters.segment ?? undefined,
    p_sort: sortCol,
    p_dir: sortDir,
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load companies: ${error.message}`);
  }

  const rows = (data ?? []) as Array<any>;
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const stripped = rows.map(({ total_count: _tc, ...rest }) => rest);
  return { data: stripped, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getCompany(id: string) {
  const op = '[getCompany]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('companies')
    .select('*, contact_company_roles(*, contacts(id, name, first_name, last_name, phone, email, designation))')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load company: ${error.message}`);
  }
  return data;
}

// ── Activities ──

export async function getEntityActivities(entityType: string, entityId: string) {
  const op = '[getEntityActivities]';
  console.log(`${op} Starting for: ${entityType}/${entityId}`);
  const supabase = await createClient();

  const { data: assocs, error: assocErr } = await supabase
    .from('activity_associations')
    .select('activity_id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  if (assocErr) {
    console.error(`${op} Assoc query failed:`, { code: assocErr.code, message: assocErr.message });
    throw new Error(`Failed to load activity associations: ${assocErr.message}`);
  }

  if (!assocs || assocs.length === 0) return [];

  const activityIds = assocs.map((a: any) => a.activity_id);

  const { data, error } = await supabase
    .from('activities')
    .select('*, owner:profiles!activities_owner_id_fkey(full_name)')
    .in('id', activityIds)
    .order('occurred_at', { ascending: false });

  if (error) {
    console.error(`${op} Activities query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load activities: ${error.message}`);
  }
  return data ?? [];
}
