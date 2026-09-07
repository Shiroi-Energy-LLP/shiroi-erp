import { createServerClient as _createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@repo/types/database';

/**
 * Creates a typed Supabase client for use in Next.js middleware.
 * Refreshes the auth session on every request so server components
 * and route handlers always have a valid session.
 *
 * Usage in apps/erp/src/middleware.ts:
 *   import { updateSession } from '@repo/supabase/middleware';
 *   export async function middleware(request: NextRequest) {
 *     return await updateSession(request);
 *   }
 */
export async function updateSession(request: NextRequest) {
  const op = '[updateSession:middleware]';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_URL`);
  if (!supabaseKey) throw new Error(`${op} Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`);

  let supabaseResponse = NextResponse.next({ request });

  const supabase = _createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Update the request cookies so downstream server components see them
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        // Recreate the response with updated request, then set response cookies
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the session and validate it. `getClaims()` (not `getSession()`)
  // verifies the JWT signature locally against the project's JWKS — the project
  // signs with ES256 (asymmetric), so this costs no network round-trip to the
  // Auth server on the hot path. It still calls getSession() internally, which
  // refreshes an expired token and rotates the cookies via setAll(). If the key
  // were ever symmetric (HS256) supabase-js falls back to getUser() by itself.
  // Trade-off accepted 2026-09-07: a revoked/banned session stays valid until
  // its access token expires (~1 h) instead of being rejected immediately.
  // Timeout after 5s to avoid MIDDLEWARE_INVOCATION_TIMEOUT on Vercel.
  try {
    const { error } = await Promise.race([
      supabase.auth.getClaims(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Auth timeout (5s)')), 5000),
      ),
    ]);
    if (error) {
      console.warn(`${op} Session refresh failed:`, { code: error.status, message: error.message });
    }
  } catch (err) {
    console.warn(`${op} Auth check skipped:`, {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return supabaseResponse;
}
