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
  page?: number;
  pageSize?: number;
}

export async function getContacts(filters: ContactFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getContacts]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('contacts')
    .select(
      'id, name, phone, email, designation, created_at, contact_company_roles(company_id, role_title, is_primary, ended_at, companies(name))',
      { count: 'exact' }
    )
    .order('name', { ascending: true });

  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load contacts: ${error.message}`);
  }

  const total = count ?? 0;
  return { data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getContact(id: string) {
  const op = '[getContact]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*, contact_company_roles(*, companies(name, segment))')
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
    .select('id, role_label, is_primary, contacts(id, name, phone, email, designation)')
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

  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, email, designation')
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
    .order('name')
    .limit(20);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to search contacts: ${error.message}`);
  }
  return data ?? [];
}

// ── Companies ──

export interface CompanyFilters {
  search?: string;
  segment?: string;
  page?: number;
  pageSize?: number;
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getCompanies]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('companies')
    .select('id, name, segment, gstin, city, state, created_at', { count: 'exact' })
    .order('name', { ascending: true });

  if (filters.segment) query = query.eq('segment', filters.segment);
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,gstin.ilike.%${filters.search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load companies: ${error.message}`);
  }

  const total = count ?? 0;
  return { data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getCompany(id: string) {
  const op = '[getCompany]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('companies')
    .select('*, contact_company_roles(*, contacts(id, name, phone, email, designation))')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load company: ${error.message}`);
  }
  return data;
}
