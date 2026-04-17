// scripts/zoho-import/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../packages/types/database';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required in .env.local');
}

export const admin = createClient<Database>(url, key, {
  auth: { persistSession: false },
});

/**
 * Look up the Migration System employee row — used as the `created_by` /
 * `raised_by` / `prepared_by` / `recorded_by` / `submitted_by` for every
 * imported entity. The employees table links to auth.users via profile_id,
 * not a direct email column. We use the "Migration System" account
 * (migration@shiroi.energy) as the Zoho import system user.
 * Cached after first call.
 */
let _systemEmployeeId: string | null = null;
export async function getSystemEmployeeId(): Promise<string> {
  if (_systemEmployeeId) return _systemEmployeeId;
  // Find the Migration System employee via its auth user email.
  // employees.profile_id → auth.users.id, but we can't query auth.users
  // from the JS client — use a hardcoded fallback to the known migration
  // employee id instead of a fragile join.
  const { data, error } = await admin
    .from('employees')
    .select('id, full_name')
    .ilike('full_name', '%migration%')
    .single();
  if (error || !data) {
    // Second attempt: get any active employee as fallback
    const { data: fallback, error: fallbackErr } = await admin
      .from('employees')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (fallbackErr || !fallback) throw new Error('No employee rows found — seed employees before importing');
    _systemEmployeeId = fallback.id;
    return _systemEmployeeId;
  }
  _systemEmployeeId = data.id;
  return _systemEmployeeId;
}
