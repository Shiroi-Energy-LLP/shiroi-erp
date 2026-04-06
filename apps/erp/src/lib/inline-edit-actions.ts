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
    projects: { remarks: 'notes' },
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

  const { error } = await supabase
    .from(tableName as any)
    .update({ [field]: value } as any)
    .eq('id', rowId);

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      table: tableName,
      field,
      rowId,
    });
    return { success: false, error: error.message };
  }

  // Revalidate the entity list page
  revalidatePath(`/${entityType}`);
  return { success: true };
}
