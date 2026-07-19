import { cache } from 'react';
import { createClient } from '@repo/supabase/server';
import { redirect } from 'next/navigation';
import type { Database } from '@repo/types/database';
import { err, type ActionResult } from '@/lib/types/actions';

type AppRole = Database['public']['Enums']['app_role'];
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Minimal user shape returned by Supabase auth.getUser() */
interface AuthUser {
  id: string;
  email?: string;
}

export interface UserProfile {
  id: string;
  role: AppRole;
  full_name: string;
  email: string;
  is_active: boolean;
}

export interface SessionContext {
  userId: string | null;
  email: string | null;
  role: AppRole | null;
  profile: UserProfile | null;
}

/**
 * The ONE validated `auth.getUser()` per request — a network round-trip to the
 * GoTrue auth server that validates the token (NOT `getSession()`, which only
 * decodes the cookie). Wrapped in React `cache()` so every caller in a render
 * pass shares the single call. **User-only**: does NOT fetch the profile, so
 * server actions that just need to validate a user (requireAuthUser) don't pay
 * for a profiles read. Callers needing role/profile use getSessionContext().
 *
 * SECURITY (NEVER-DO #22): `cache` MUST be React's request-scoped `cache` — it
 * is discarded after each request. NEVER memoize identity in `unstable_cache`,
 * module scope, or any cross-request store: that bleeds one user's session into
 * the next.
 */
const getAuthUser = cache(async (): Promise<{ id: string; email: string | null } | null> => {
  const op = '[getAuthUser]';
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    if (error) console.error(`${op} Auth error:`, { message: error.message });
    return null;
  }
  return { id: user.id, email: user.email ?? null };
});

/**
 * Full identity context (user + profile + role), cached once per request.
 * Use for any role/profile-gated path. Builds on getAuthUser() so the validated
 * `auth.getUser()` network call is shared with the user-only callers.
 *
 * Server actions re-resolve identity via this helper (now cheap) — they must
 * never trust a `role`/`userId` passed in from the client.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const op = '[getSessionContext]';
  const user = await getAuthUser();
  if (!user) return { userId: null, email: null, role: null, profile: null };

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error(`${op} Profile query failed:`, { code: error.code, message: error.message });
    return { userId: user.id, email: user.email, role: null, profile: null };
  }

  return {
    userId: user.id,
    email: user.email,
    role: profile?.role ?? null,
    profile: profile ?? null,
  };
});

export async function getUser(): Promise<AuthUser | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? undefined };
}

export async function getUserProfile(): Promise<UserProfile | null> {
  return (await getSessionContext()).profile;
}

/**
 * Resolves the employees.id for the currently authenticated user.
 * Returns null if unauthenticated or the profile has no linked employee row.
 * Wrapped in `cache()` so the employees lookup runs once per request; uses the
 * user-only getAuthUser (no profile read needed to map auth uid → employee).
 *
 * IMPORTANT: ownership/attribution columns key off employees(id), NOT the
 * profiles/auth uid — e.g. daily_site_reports.submitted_by,
 * site_photos.uploaded_by, site_report_corrections.requested_by. Never write
 * profile.id / auth.uid() into those FK columns; resolve the employee id here.
 */
export const getCurrentEmployeeId = cache(async (): Promise<string | null> => {
  const op = '[getCurrentEmployeeId]';
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return null;
  }
  return data?.id ?? null;
});

export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  return { id: user.id, email: user.email ?? undefined };
}

/**
 * Server-action variant of requireAuth() — returns an ActionResult-shaped
 * error instead of redirecting. Use in 'use server' files where redirect()
 * would break the typed action contract. User-only (no profile read).
 *
 * Usage:
 *   const authed = await requireAuthUser();
 *   if (!authed.success) return authed; // typed ActionResult<never> propagation
 *   const { user, supabase } = authed.data;
 */
export async function requireAuthUser(): Promise<
  ActionResult<{ user: AuthUser; supabase: SupabaseServerClient }>
> {
  const user = await getAuthUser();
  if (!user) return err('Not authenticated', 'UNAUTHENTICATED');
  const supabase = await createClient();
  return { success: true, data: { user: { id: user.id, email: user.email ?? undefined }, supabase } };
}

export async function requireRole(allowed: AppRole[]): Promise<UserProfile> {
  const { profile } = await getSessionContext();
  if (!profile) redirect('/login');
  if (!allowed.includes(profile.role)) redirect('/dashboard');
  return profile;
}
