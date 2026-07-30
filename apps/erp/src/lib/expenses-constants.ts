/**
 * Expense constants shared between server queries/actions and `'use client'`
 * components. No server imports here — NEVER-DO #21 (a client component that
 * transitively imports `-queries.ts` pulls the server Supabase client into the
 * browser bundle and only `pnpm build` catches it).
 */
import type { Database } from '@repo/types/database';

type AppRole = Database['public']['Enums']['app_role'];

export const EXPENSE_STATUSES = ['submitted', 'verified', 'approved', 'rejected'] as const;
export type ExpenseStatusValue = typeof EXPENSE_STATUSES[number];

export const EXPENSE_SCOPES = ['all', 'project', 'general'] as const;
export type ExpenseScopeValue = typeof EXPENSE_SCOPES[number];

/**
 * Roles allowed to submit an expense on behalf of another employee — Founder,
 * every *_manager role, and Finance (Vivek's ruling, 2026-07-30).
 *
 * Kept in sync with the `expenses_insert_self` RLS policy in migration 215.
 * The server action re-checks this against the session role; the client flag is
 * only a UI hint (NEVER-DO #22 — never trust a client-passed role).
 */
export const DELEGATED_ENTRY_ROLES: readonly AppRole[] = [
  'founder',
  'project_manager',
  'hr_manager',
  'marketing_manager',
  'finance',
];

/**
 * Accepts a plain string so callers holding an unvalidated `profiles.role`
 * don't need a cast; the list itself is typed `AppRole[]`, so a typo in
 * DELEGATED_ENTRY_ROLES still fails type-check.
 */
export function canSubmitOnBehalf(role: string | null | undefined): boolean {
  return role != null && (DELEGATED_ENTRY_ROLES as readonly string[]).includes(role);
}
