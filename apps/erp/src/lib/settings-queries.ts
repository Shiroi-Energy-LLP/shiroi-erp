import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import type { Database } from '@repo/types/database';

type BugReportRow = Database['public']['Tables']['bug_reports']['Row'];
type ProfileRow   = Database['public']['Tables']['profiles']['Row'];

/**
 * Returns the signed-in user's bug reports, newest first.
 * RLS scopes the query automatically — no explicit user_id filter needed,
 * but the ORDER BY + LIMIT are for defence and UX consistency.
 */
export async function listMyBugReports(): Promise<BugReportRow[]> {
  const op = '[listMyBugReports]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error(`${op} query failed`, { code: error.code, message: error.message });
    return [];
  }
  if (!data) return [];
  return data;
}

/**
 * Founder-only list of all employee profiles. Callers MUST verify the caller
 * is a founder before invoking (the Users tab performs that check); RLS on
 * profiles does not restrict SELECT at the table level today.
 */
export async function listAllUsers(): Promise<
  Pick<ProfileRow, 'id' | 'full_name' | 'email' | 'role' | 'is_active'>[]
> {
  const op = '[listAllUsers]';
  const caller = await getUserProfile();
  if (!caller || caller.role !== 'founder') {
    console.error(`${op} called without founder role`, { callerRole: caller?.role });
    return [];
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .order('full_name', { ascending: true });
  if (error) {
    console.error(`${op} query failed`, { code: error.code, message: error.message });
    return [];
  }
  if (!data) return [];
  return data;
}
