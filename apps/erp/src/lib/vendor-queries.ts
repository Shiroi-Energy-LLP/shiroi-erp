import { createClient } from '@repo/supabase/server';

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
    query = query.or(
      `company_name.ilike.%${filters.search}%,vendor_code.ilike.%${filters.search}%`
    );
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
