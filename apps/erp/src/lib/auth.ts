import { createClient } from '@repo/supabase/server';
import { redirect } from 'next/navigation';
import type { Database } from '@repo/types/database';

type AppRole = Database['public']['Enums']['app_role'];

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

export async function getUser(): Promise<AuthUser | null> {
  const op = '[getUser]';
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error(`${op} Auth error:`, { message: error.message });
    return null;
  }
  return user;
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const op = '[getUserProfile]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, is_active')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error(`${op} Profile query failed:`, { code: error.code, message: error.message });
    return null;
  }
  return profile;
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(allowed: AppRole[]): Promise<UserProfile> {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (!allowed.includes(profile.role)) redirect('/dashboard');
  return profile;
}
