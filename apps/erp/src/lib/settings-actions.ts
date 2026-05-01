'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getUserProfile } from '@/lib/auth';
import {
  validateNewPassword,
  validateBugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from '@/lib/settings-helpers';
import { emitErpEvent } from '@/lib/n8n/emit';
import type { Database } from '@repo/types/database';

type AppRole = Database['public']['Enums']['app_role'];

// ───────────────────────────────────────────────────────────────────────────
// signOut — clears the Supabase session cookie and redirects to /login.
// Server-side so we don't import @repo/supabase/client from a component
// (CLAUDE.md rule #15). `redirect` throws a Next.js internal signal, so
// this function never returns normally.
// ───────────────────────────────────────────────────────────────────────────
export async function signOut(): Promise<never> {
  const op = '[signOut]';
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error(`${op} signOut failed`, {
      errorCode: error.code ?? error.status,
      timestamp: new Date().toISOString(),
    });
    // Still redirect — stuck-session is worse than a noisy log.
  }
  redirect('/login');
}

// ───────────────────────────────────────────────────────────────────────────
// changePassword — re-auth with current password, then update.
// ───────────────────────────────────────────────────────────────────────────
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<ActionResult<void>> {
  const op = '[changePassword]';
  try {
    const validation = validateNewPassword(newPassword, confirmPassword);
    if (!validation.ok) return err(validation.error);

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.email) {
      console.error(`${op} no authenticated user`, {
        error: userError,
        timestamp: new Date().toISOString(),
      });
      return err('You must be signed in to change your password');
    }

    // Verify the current password by re-authenticating. This MUST NOT be
    // skipped — it is the only check that the person at the keyboard
    // actually knows the existing password (vs an unattended session).
    //
    // NOTE: signInWithPassword issues a fresh session token and writes
    // new auth cookies on the response. This is equivalent to an
    // implicit re-login; acceptable for this app because we do not
    // rely on session-ID-based revocation. If that changes, switch to
    // supabase.auth.reauthenticate() + verifyOtp instead.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthError) {
      // Do NOT log the password. Do log the error code so we can distinguish
      // rate-limit errors from plain wrong-password errors if needed.
      console.error(`${op} reauth failed`, {
        userId: user.id,
        errorCode: reauthError.code ?? reauthError.status,
        timestamp: new Date().toISOString(),
      });
      return err('Current password is incorrect');
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      console.error(`${op} updateUser failed`, {
        userId: user.id,
        errorCode: updateError.code ?? updateError.status,
        timestamp: new Date().toISOString(),
      });
      return err(updateError.message || 'Could not update password');
    }

    // No revalidatePath — password change doesn't invalidate any cached page data.
    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// submitBugReport — insert + fire-and-forget n8n webhook.
// ───────────────────────────────────────────────────────────────────────────
export async function submitBugReport(input: {
  category: BugReportCategory;
  severity: BugReportSeverity;
  description: string;
  pageUrl: string;
  userAgent: string;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[submitBugReport]';
  try {
    const validation = validateBugReport({
      category: input.category,
      severity: input.severity,
      description: input.description,
    });
    if (!validation.ok) return err(validation.error);

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error(`${op} no authenticated user`, {
        error: userError,
        timestamp: new Date().toISOString(),
      });
      return err('You must be signed in to submit a report');
    }

    const { data, error } = await supabase
      .from('bug_reports')
      .insert({
        user_id: user.id,
        category: input.category,
        severity: input.severity,
        description: input.description.trim(),
        page_url: input.pageUrl || null,
        user_agent: input.userAgent || null,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error(`${op} insert failed`, {
        userId: user.id,
        error,
        timestamp: new Date().toISOString(),
      });
      return err(error?.message ?? 'Could not save the report');
    }

    // Resolve submitter display name for the notification. Profile read may
    // miss (RLS, fresh auth user without a row yet) — fall back to auth email.
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    // Best-effort notification to n8n. Blocks up to 3 s (AbortSignal timeout
    // inside notifyBugReport), but NEVER fails the submit — helper swallows
    // all errors.
    await notifyBugReport({
      id: data.id,
      userId: user.id,
      userFullName: profile?.full_name ?? null,
      userEmail: user.email ?? '',
      category: input.category,
      severity: input.severity,
      description: input.description.trim(),
      pageUrl: input.pageUrl,
    });

    revalidatePath('/settings');
    return ok({ id: data.id });
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}

/**
 * Notify n8n about a submitted bug report. Never throws.
 *
 * Primary path: single-ingress event bus router via `emitErpEvent`. The
 * router's `bug_report.submitted` route dispatches to workflow "01 — Bug
 * report".
 *
 * Legacy path: if `N8N_EVENT_BUS_URL` is unset, fall back to the standalone
 * `N8N_BUG_REPORT_WEBHOOK_URL` workflow that predates the event bus. Either
 * unset → silent no-op (expected for local dev).
 */
async function notifyBugReport(payload: {
  id: string;
  userId: string;
  userFullName: string | null;
  userEmail: string;
  category: BugReportCategory;
  severity: BugReportSeverity;
  description: string;
  pageUrl: string;
}): Promise<void> {
  const op = '[notifyBugReport]';

  if (process.env.N8N_EVENT_BUS_URL) {
    await emitErpEvent('bug_report.submitted', {
      bug_report_id: payload.id,
      category: payload.category,
      severity: payload.severity,
      description: payload.description,
      page_url: payload.pageUrl || null,
      submitter_user_id: payload.userId,
      submitter_full_name: payload.userFullName,
      submitter_email: payload.userEmail,
      erp_url: `https://erp.shiroienergy.com/settings?tab=feedback&id=${payload.id}`,
    });
    return;
  }

  const legacyUrl = process.env.N8N_BUG_REPORT_WEBHOOK_URL;
  if (!legacyUrl) return;

  try {
    const resp = await fetch(legacyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': process.env.N8N_WEBHOOK_SECRET ?? '',
      },
      body: JSON.stringify({
        id: payload.id,
        user_id: payload.userId,
        user_email: payload.userEmail,
        category: payload.category,
        severity: payload.severity,
        description: payload.description,
        page_url: payload.pageUrl,
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      console.error(`${op} legacy webhook non-2xx`, {
        status: resp.status,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error(`${op} legacy webhook failure (non-blocking)`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// updateUserRole — founder-only, cannot change own role.
// ───────────────────────────────────────────────────────────────────────────
export async function updateUserRole(
  userId: string,
  newRole: AppRole,
): Promise<ActionResult<void>> {
  const op = '[updateUserRole]';
  try {
    const caller = await getUserProfile();
    if (!caller || caller.role !== 'founder') return err('Not authorized');
    if (userId === caller.id) return err('You cannot change your own role');

    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) {
      console.error(`${op} update failed`, {
        targetUserId: userId,
        newRole,
        error,
        timestamp: new Date().toISOString(),
      });
      return err(error.message || 'Could not update role');
    }
    revalidatePath('/settings');
    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// setUserActive — founder-only, cannot deactivate self.
// ───────────────────────────────────────────────────────────────────────────
export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<ActionResult<void>> {
  const op = '[setUserActive]';
  try {
    const caller = await getUserProfile();
    if (!caller || caller.role !== 'founder') return err('Not authorized');
    if (userId === caller.id && !active) {
      return err('You cannot deactivate yourself');
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: active })
      .eq('id', userId);
    if (error) {
      console.error(`${op} update failed`, {
        targetUserId: userId,
        active,
        error,
        timestamp: new Date().toISOString(),
      });
      return err(error.message || 'Could not update user status');
    }
    revalidatePath('/settings');
    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}
