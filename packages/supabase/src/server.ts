import { createServerClient as _createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@repo/types/database';

/**
 * Creates a typed Supabase client for use in Next.js server components,
 * Server Actions, and Route Handlers. Uses the publishable key — RLS enforced.
 *
 * Must be called inside a request context (where `cookies()` is available).
 * Handles cookie read/write for auth session management.
 */
export async function createClient() {
  const op = '[createClient:server]';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL`);
  if (!supabaseKey) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`);

  const cookieStore = await cookies();

  return _createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll can fail in Server Components where the response is
          // already streaming. This is expected — the middleware client
          // handles session refresh before rendering begins.
        }
      },
    },
  });
}
