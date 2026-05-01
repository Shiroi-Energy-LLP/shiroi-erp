'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

/** Map entity types to their database table names */
const ENTITY_TABLE_MAP: Record<string, string> = {
  leads: 'leads',
  proposals: 'proposals',
  projects: 'projects',
  contacts: 'contacts',
  companies: 'companies',
  vendors: 'vendors',
  purchase_orders: 'purchase_orders',
  bom_items: 'proposal_bom_lines',
};

/** Fields that are NEVER editable inline (safety guard) */
const BLOCKED_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'owner_id',
  'bank_account_number', 'aadhar_number', 'pan_number',
  'gross_monthly', 'basic_salary', 'ctc_monthly', 'ctc_annual',
  'net_take_home', 'commission_amount', 'pf_employee',
]);

export async function updateCellValue(input: {
  entityType: string;
  rowId: string;
  field: string;
  value: string | number | boolean | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCellValue]';

  const { entityType, rowId, value } = input;
  let { field } = input;

  // Map display field names to actual DB column names
  const FIELD_ALIAS_MAP: Record<string, Record<string, string>> = {
    projects: { remarks: 'notes', project_manager_name: 'project_manager_id' },
    vendors: { company_name: 'company_name' },
  };
  const alias = FIELD_ALIAS_MAP[entityType]?.[field];
  if (alias) {
    field = alias;
  }

  // Validate entity type
  const tableName = ENTITY_TABLE_MAP[entityType];
  if (!tableName) {
    console.error(`${op} Unknown entity type: ${entityType}`);
    return { success: false, error: `Unknown entity type: ${entityType}` };
  }

  // Block sensitive fields
  if (BLOCKED_FIELDS.has(field)) {
    console.error(`${op} Field not editable: ${field}`);
    return { success: false, error: `Field "${field}" cannot be edited` };
  }

  const supabase = await createClient();

  // Verify user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  console.log(`${op} Updating ${tableName}.${field} for ${rowId}`);

  const { data: updatedRows, error } = await supabase
    .from(tableName as any)
    .update({ [field]: value } as any)
    .eq('id', rowId)
    .select('id');

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      table: tableName,
      field,
      rowId,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: error.message };
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.error(`${op} 0 rows affected — RLS blocked or row missing:`, {
      table: tableName,
      field,
      rowId,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: 'Update blocked — permission denied or row missing' };
  }

  // Revalidate the entity list page
  const PATH_MAP: Record<string, string> = {
    leads: '/leads',
    proposals: '/proposals',
    projects: '/projects',
    contacts: '/contacts',
    companies: '/companies',
    vendors: '/vendors',
    purchase_orders: '/procurement',
    bom_items: '/bom-review',
  };
  revalidatePath(PATH_MAP[entityType] ?? `/${entityType}`);
  return { success: true };
}

/**
 * Bulk-update a single field across multiple rows of the same entity.
 * Used by the selection action bar (e.g. change status of 20 projects at once).
 */
export async function bulkUpdateField(input: {
  entityType: string;
  rowIds: string[];
  field: string;
  value: string | number | boolean | null;
}): Promise<{ success: boolean; updated: number; error?: string }> {
  const op = '[bulkUpdateField]';
  const { entityType, rowIds, value } = input;
  let { field } = input;

  if (!rowIds || rowIds.length === 0) {
    return { success: false, updated: 0, error: 'No rows selected' };
  }

  const FIELD_ALIAS_MAP: Record<string, Record<string, string>> = {
    projects: { remarks: 'notes', project_manager_name: 'project_manager_id' },
  };
  const alias = FIELD_ALIAS_MAP[entityType]?.[field];
  if (alias) {
    field = alias;
  }

  const tableName = ENTITY_TABLE_MAP[entityType];
  if (!tableName) {
    console.error(`${op} Unknown entity type: ${entityType}`);
    return { success: false, updated: 0, error: `Unknown entity type: ${entityType}` };
  }

  if (BLOCKED_FIELDS.has(field)) {
    console.error(`${op} Field not editable: ${field}`);
    return { success: false, updated: 0, error: `Field "${field}" cannot be edited` };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, updated: 0, error: 'Not authenticated' };
  }

  console.log(`${op} Updating ${tableName}.${field} for ${rowIds.length} rows`);

  const { error, count } = await supabase
    .from(tableName as any)
    .update({ [field]: value } as any, { count: 'exact' })
    .in('id', rowIds);

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      table: tableName,
      field,
      rowCount: rowIds.length,
    });
    return { success: false, updated: 0, error: error.message };
  }

  const PATH_MAP: Record<string, string> = {
    leads: '/leads',
    proposals: '/proposals',
    projects: '/projects',
    contacts: '/contacts',
    companies: '/companies',
    vendors: '/vendors',
    purchase_orders: '/procurement',
    bom_items: '/bom-review',
  };
  revalidatePath(PATH_MAP[entityType] ?? `/${entityType}`);
  return { success: true, updated: count ?? rowIds.length };
}
