'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { upsertLeadFollowupTask } from '@/lib/leads-task-actions';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';
import { fyToOrderDate } from '@/lib/helpers/fiscal-year';

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
}): Promise<ActionResult<void>> {
  const op = '[updateCellValue]';

  const { entityType, rowId, value } = input;
  let { field } = input;
  let outValue: string | number | boolean | null = value;

  // Projects "Year" cell edits the fiscal year: store order_date = 1-Apr of the FY
  // start (keeps the FY filter + status-summary header reading the same field).
  if (entityType === 'projects' && field === 'year') {
    const iso = typeof value === 'string' ? fyToOrderDate(value) : null;
    if (!iso) return err('Pick a valid fiscal year', 'INVALID_FY');
    field = 'order_date';
    outValue = iso;
  }

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
    return err(`Unknown entity type: ${entityType}`, 'UNKNOWN_ENTITY');
  }

  // Block sensitive fields
  if (BLOCKED_FIELDS.has(field)) {
    console.error(`${op} Field not editable: ${field}`);
    return err(`Field "${field}" cannot be edited`, 'BLOCKED_FIELD');
  }

  // Verify user is authenticated
  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { supabase } = authed.data;

  console.log(`${op} Updating ${tableName}.${field} for ${rowId}`);

  const { data: updatedRows, error } = await supabase
    .from(tableName as any)
    .update({ [field]: outValue } as any)
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
    return err(error.message, error.code);
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.error(`${op} 0 rows affected — RLS blocked or row missing:`, {
      table: tableName,
      field,
      rowId,
      timestamp: new Date().toISOString(),
    });
    return err('Update blocked — permission denied or row missing', 'NO_ROWS_AFFECTED');
  }

  // Flush the stage-count cache whenever a lead's status changes.
  if (entityType === 'leads' && field === 'status') {
    revalidateTag('lead-stage-counts');
  }

  // After successful lead next_followup_date change, upsert a follow-up task (non-fatal)
  if (entityType === 'leads' && field === 'next_followup_date' && typeof value === 'string' && value) {
    upsertLeadFollowupTask(rowId, value).catch((e) => {
      console.error(`${op} upsertLeadFollowupTask failed (non-fatal):`, {
        rowId,
        value,
        error: e,
        timestamp: new Date().toISOString(),
      });
    });
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
  return ok(undefined);
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
}): Promise<ActionResult<{ updated: number }>> {
  const op = '[bulkUpdateField]';
  const { entityType, rowIds, value } = input;
  let { field } = input;

  if (!rowIds || rowIds.length === 0) {
    return err('No rows selected', 'NO_ROWS');
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
    return err(`Unknown entity type: ${entityType}`, 'UNKNOWN_ENTITY');
  }

  if (BLOCKED_FIELDS.has(field)) {
    console.error(`${op} Field not editable: ${field}`);
    return err(`Field "${field}" cannot be edited`, 'BLOCKED_FIELD');
  }

  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { supabase } = authed.data;

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
    return err(error.message, error.code);
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
  return ok({ updated: count ?? rowIds.length });
}
