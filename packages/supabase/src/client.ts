import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';
import type { Database } from '@repo/types/database';

let client: ReturnType<typeof _createBrowserClient<Database>> | null = null;

/**
 * Creates a typed Supabase client for use in browser/client components.
 * Uses the publishable key — RLS is enforced on all queries.
 * Returns a singleton instance (safe to call multiple times).
 */
export function createClient() {
  const op = '[createClient:browser]';

  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL`);
  if (!supabaseKey) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`);

  client = _createBrowserClient<Database>(supabaseUrl, supabaseKey);
  return client;
}
