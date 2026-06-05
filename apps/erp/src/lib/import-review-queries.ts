'use server';

import { createClient } from '@repo/supabase/server';

export interface PendingImport {
  id: string;
  project_name: string;
  normalized_name: string;
  source_sheets: Array<{ sheet: string; raw: string }>;
  is_multi_inverter_parent: boolean;
  parent_import_id: string | null;
  child_count: number;
  matched_project_id: string | null;
  matched_customer_name: string | null;
  match_confidence: 'exact' | 'fuzzy' | 'none';
  match_score: number;
  status_review: 'pending' | 'approved' | 'rejected' | 'imported' | 'error';
  source_status: string | null;
  source_year: number | null;
  system_size_kwp: number | null;
  system_type: string | null;
  net_meter: string | null;
  industry: string | null;
  category: string | null;
  mounting_type: string | null;
  project_cost: number | null;
  actual_cost: number | null;
  profit_inr: number | null;
  panel_make: string | null;
  panel_model: string | null;
  panel_wattage: number | null;
  panel_qty: number | null;
  inverter_make: string | null;
  inverter_model: string | null;
  inverter_capacity_kw: number | null;
  inverter_qty: number | null;
  inverter_serial_number: string | null;
  inverter_power_module_sn: string | null;
  acdb_sn: string | null;
  dcdb_sn: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  google_maps_url: string | null;
  folder_link: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  commissioning_date: string | null;
  portal_brand: string | null;
  portal_url: string | null;
  portal_username: string | null;
  portal_password: string | null;
  local_login_ip: string | null;
  local_admin_user: string | null;
  local_admin_password: string | null;
  local_user: string | null;
  local_user_password: string | null;
  internet_type: string | null;
  jio_password: string | null;
  jio_primary_sim: string | null;
  jio_backup_sim: string | null;
  datalogger_mac: string | null;
  datalogger_pk: string | null;
  amc_type: string | null;
  amc_visits: Array<{ scheduled: string | null; completed: string | null }>;
  remarks: string | null;
  import_error: string | null;
  rejection_reason: string | null;
  create_amc_contract: boolean;
  imported_project_id: string | null;
  reviewed_at: string | null;
}

export interface ListFilters {
  status_review?: string;
  match_confidence?: string;
  source_status?: string;
  source_year?: number;
  portal_brand?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface ListResult {
  items: PendingImport[];
  total: number;
}

export async function listPendingImports(filters: ListFilters): Promise<ListResult> {
  const op = '[listPendingImports]';
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 100;
  const supabase = await createClient();

  const { data, error } = await (supabase.rpc as any)('list_pending_imports', {
    p_status_review: filters.status_review ?? 'pending',
    p_match_confidence: filters.match_confidence ?? null,
    p_source_status: filters.source_status ?? null,
    p_source_year: filters.source_year ?? null,
    p_portal_brand: filters.portal_brand ?? null,
    p_query: filters.search ?? null,
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return { items: [], total: 0 };
  }

  const rows = (data ?? []) as Array<PendingImport & { total_count: number | string }>;
  const total = rows.length > 0 ? Number(rows[0]!.total_count ?? 0) : 0;
  const items = rows.map((r) => {
    const { total_count: _tc, ...rest } = r;
    return {
      ...rest,
      source_sheets: Array.isArray(rest.source_sheets) ? rest.source_sheets : [],
      amc_visits: Array.isArray(rest.amc_visits) ? rest.amc_visits : [],
    } as PendingImport;
  });

  return { items, total };
}

export interface ImportSummary {
  pending: number;
  approved: number;
  rejected: number;
  imported: number;
  errors: number;
  completed_pending: number;
  exact_pending: number;
  fuzzy_pending: number;
}

export async function getImportSummary(): Promise<ImportSummary> {
  const op = '[getImportSummary]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pending_project_imports')
    .select('status_review, match_confidence, source_status, parent_import_id')
    .is('parent_import_id', null);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return { pending: 0, approved: 0, rejected: 0, imported: 0, errors: 0, completed_pending: 0, exact_pending: 0, fuzzy_pending: 0 };
  }
  const rows = (data ?? []) as Array<{ status_review: string; match_confidence: string; source_status: string | null }>;
  return {
    pending: rows.filter((r) => r.status_review === 'pending').length,
    approved: rows.filter((r) => r.status_review === 'approved').length,
    rejected: rows.filter((r) => r.status_review === 'rejected').length,
    imported: rows.filter((r) => r.status_review === 'imported').length,
    errors: rows.filter((r) => r.status_review === 'error').length,
    completed_pending: rows.filter((r) => r.status_review === 'pending' && (r.source_status?.toLowerCase() === 'completed' || r.source_status?.toLowerCase() === 'running')).length,
    exact_pending: rows.filter((r) => r.status_review === 'pending' && r.match_confidence === 'exact').length,
    fuzzy_pending: rows.filter((r) => r.status_review === 'pending' && r.match_confidence === 'fuzzy').length,
  };
}

export interface PendingChild {
  id: string;
  project_name: string;
  system_size_kwp: number | null;
  inverter_capacity_kw: number | null;
  inverter_serial_number: string | null;
  inverter_power_module_sn: string | null;
  acdb_sn: string | null;
  dcdb_sn: string | null;
}

export async function getPendingChildren(parentId: string): Promise<PendingChild[]> {
  const op = '[getPendingChildren]';
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)('get_pending_import_children', { p_parent_id: parentId });
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return [];
  }
  return (data ?? []) as PendingChild[];
}
