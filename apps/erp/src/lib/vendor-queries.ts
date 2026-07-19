import { createClient } from '@repo/supabase/server';
import { sanitizeForIlike } from './helpers/sanitize-or-filter';

export interface VendorFilters {
  type?: string;
  search?: string;
}

export async function getVendors(filters: VendorFilters = {}) {
  const op = '[getVendors]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('vendors')
    .select('*')
    .is('deleted_at', null)
    .order('company_name');

  if (filters.type) {
    query = query.eq('vendor_type', filters.type);
  }
  if (filters.search) {
    const s = sanitizeForIlike(filters.search);
    query = query.or(`company_name.ilike.${s},vendor_code.ilike.${s}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, {
      code: error.code,
      message: error.message,
    });
    throw new Error(`Failed to load vendors: ${error.message}`);
  }
  return data ?? [];
}
