import { createClient } from '@supabase/supabase-js';
import type { Database } from '@repo/types/database';

/**
 * Creates a typed Supabase admin client using the secret key.
 * Bypasses RLS — use ONLY for system automation, nightly aggregations,
 * and admin operations. NEVER import this in client-side code.
 *
 * Returns a new instance on each call (no singleton — admin operations
 * should be explicit and short-lived).
 */
export function createAdminClient() {
  const op = '[createAdminClient]';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL`);
  if (!supabaseKey) throw new Error(`${op} Missing SUPABASE_SECRET_KEY`);

  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
