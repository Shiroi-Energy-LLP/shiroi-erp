# User Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/settings` page with Account, Feedback, and (founder-only) Users tabs, and add a topbar profile dropdown as the entry point.

**Architecture:** Single route `/settings` in the `(erp)` group with a shadcn Tabs layout. New `bug_reports` table with RLS (users see their own, founder sees all). Password change via Supabase Auth re-auth flow. Role/active changes for founder via standard server actions. Optional `N8N_BUG_REPORT_WEBHOOK_URL` POST after bug report insert (fire-and-forget).

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + Auth + RLS), TypeScript, shadcn/ui primitives from `@repo/ui`, Playwright for smoke tests.

**Spec:** `docs/superpowers/specs/2026-04-18-user-settings-page-design.md`

**Canonical reference corrections (superseding the spec):**
- `ActionResult<T>` shape uses `success`, not `ok`. Import and use `ok()` / `err()` helpers from `@/lib/types/actions`. Call sites branch on `if (!result.success) { ... result.error }`.
- Toast is `useToast` from `@repo/ui` with `addToast({ variant, title, description })`. Variants: `'success' | 'destructive' | 'warning' | 'default'`.
- `@repo/ui` does NOT export `Textarea` or `Switch`. Use plain `<textarea>` with Tailwind classes; for the Active toggle, use two Button variants with a Dialog confirm for deactivation.

---

## File Inventory

**Create:**
- `supabase/migrations/073_bug_reports.sql`
- `apps/erp/src/lib/settings-queries.ts`
- `apps/erp/src/lib/settings-actions.ts`
- `apps/erp/src/lib/settings-helpers.ts` — pure validation helpers (unit tested)
- `apps/erp/src/lib/settings-helpers.test.ts`
- `apps/erp/src/components/profile-menu.tsx` — topbar dropdown
- `apps/erp/src/app/(erp)/settings/page.tsx`
- `apps/erp/src/app/(erp)/settings/_client/account-tab.tsx`
- `apps/erp/src/app/(erp)/settings/_client/feedback-tab.tsx`
- `apps/erp/src/app/(erp)/settings/_client/users-tab.tsx`

**Modify:**
- `apps/erp/src/components/topbar.tsx` — replace inline name/badge/sign-out cluster with `<ProfileMenu>`
- `apps/erp/e2e/smoke.spec.ts` — add 3 smoke checks for settings
- `packages/types/database.ts` — regenerated after migration (do not hand-edit)
- `CLAUDE.md` — add `N8N_BUG_REPORT_WEBHOOK_URL` to env var list
- `docs/CHANGELOG.md` — append one line
- `docs/CURRENT_STATUS.md` — update if in-flight entry exists

**Do not modify:**
- `apps/erp/src/lib/auth.ts` — existing `requireRole(['founder'])` is sufficient
- `apps/erp/src/components/sidebar.tsx` — no sidebar nav change

---

## Conventions used throughout this plan

- Server actions live in `*-actions.ts`, marked with `'use server'` at top of file.
- Reads live in `*-queries.ts`, no `'use server'` directive needed.
- Client components have `'use client'` at top.
- Every server action begins with `const op = '[functionName]';` and returns `ActionResult<T>` via `ok()` / `err()`.
- Every server action wraps the body in `try/catch`; on catch, log with `op` prefix and `{ ..., error, timestamp: new Date().toISOString() }` and return `err('Something went wrong. Please try again.')`.
- Use `createClient` from `@repo/supabase/server` inside server actions and queries.
- Use `revalidatePath('/settings')` after writes that change what the Settings page shows.
- Never log sensitive values (`currentPassword`, `newPassword`, `password`).

---

## Task 1: Database migration (bug_reports + profiles RLS amendment)

**Files:**
- Create: `supabase/migrations/073_bug_reports.sql`

**What this task produces:** A new `bug_reports` table with enum types, indexes, and RLS; plus an additive RLS policy on `profiles` allowing founders to UPDATE `role` and `is_active` on other rows. Existing `profiles` self-update policy MUST remain intact.

- [ ] **Step 1: Inspect existing `profiles` RLS to avoid regression**

Run:
```bash
grep -n "ON profiles\|ALTER TABLE profiles\|CREATE POLICY.*profiles" supabase/migrations/*.sql | head -30
```

Read the policies in `supabase/migrations/001_foundation.sql` and any later file that touches `profiles`. Write down the names of existing policies so the new policy does not conflict.

- [ ] **Step 2: Write the migration SQL**

Create `supabase/migrations/073_bug_reports.sql` with this content:

```sql
-- Migration 073: bug_reports table + profiles founder-admin RLS policy
-- Part of the User Settings Page feature.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Enum types
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE bug_report_category AS ENUM ('bug', 'feature_request', 'question', 'other');
CREATE TYPE bug_report_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE bug_report_status   AS ENUM ('open', 'in_progress', 'resolved');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. bug_reports table
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE bug_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  category    bug_report_category NOT NULL,
  severity    bug_report_severity NOT NULL,
  description TEXT NOT NULL,
  page_url    TEXT,
  user_agent  TEXT,
  status      bug_report_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_bug_reports_user_created    ON bug_reports (user_id, created_at DESC);
CREATE INDEX idx_bug_reports_status_created  ON bug_reports (status,  created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. bug_reports RLS
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Users insert their own reports.
CREATE POLICY "bug_reports_insert_own"
  ON bug_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users see their own; founders see everyone's.
CREATE POLICY "bug_reports_select_own_or_founder"
  ON bug_reports FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- Only founders can update (status transitions + resolved_at).
CREATE POLICY "bug_reports_update_founder_only"
  ON bug_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- (No DELETE policy — reports are append-only from the app.)

-- ─────────────────────────────────────────────────────────────────────────
-- 4. profiles — additive policy so founders can UPDATE role + is_active
--    on any profile row. Existing self-update policies remain untouched.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY "profiles_update_any_by_founder"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grants (keep consistent with existing tables)
-- ─────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT         ON bug_reports TO authenticated;
GRANT UPDATE                 ON bug_reports TO authenticated;
```

- [ ] **Step 3: Apply migration to dev Supabase**

Open the Supabase dashboard for the dev project (`actqtzoxjilqnldnacqz`), paste the SQL from `073_bug_reports.sql` into the SQL Editor, and run it. Expected: success, no errors. Verify `bug_reports` appears under Tables.

- [ ] **Step 4: Smoke-test the RLS in the dev project**

In the SQL Editor (logged in as a non-founder test user via `set_config('request.jwt.claims', ...)`, or by using Supabase Studio impersonate):

```sql
-- as a non-founder: insert own row succeeds
INSERT INTO bug_reports (user_id, category, severity, description)
VALUES (auth.uid(), 'bug', 'low', 'rls smoke test');

-- as a non-founder: select returns only own rows
SELECT id, user_id FROM bug_reports;

-- as a non-founder: update fails with 0 rows affected
UPDATE bug_reports SET status = 'resolved' WHERE user_id = auth.uid();
```

Expected: INSERT returns 1 row, SELECT shows only this user's rows, UPDATE reports 0 rows changed (RLS filters it out). Delete the test row after.

- [ ] **Step 5: Regenerate TypeScript types**

Run:
```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz > packages/types/database.ts
```

(If a different command is used in this repo, substitute it. Check root `package.json` or `supabase/README.md` for the canonical generate command.)

Expected: `packages/types/database.ts` updates to include `bug_reports`, the three new enums, and (depending on generator version) the new policy does not produce a type diff on `profiles`.

- [ ] **Step 6: Verify types compile and contain the new entities**

Run:
```bash
grep -n "bug_reports\|bug_report_category\|bug_report_severity\|bug_report_status" packages/types/database.ts | head
pnpm --filter @repo/types build 2>&1 | tail -20 || pnpm -w typecheck 2>&1 | tail -20
```

Expected: grep shows matches; typecheck passes with no errors. If the types file did not regenerate cleanly, fix before proceeding (do NOT hand-edit).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/073_bug_reports.sql packages/types/database.ts
git commit -m "feat(db): migration 073 — bug_reports + founder profiles UPDATE policy"
```

---

## Task 2: Pure validation helpers + unit tests

**Files:**
- Create: `apps/erp/src/lib/settings-helpers.ts`
- Create: `apps/erp/src/lib/settings-helpers.test.ts`

**What this task produces:** Two exported pure functions — `validateNewPassword` and `validateBugReport` — and their unit tests. These have no Supabase dependency and follow the existing helper/test pattern (`cash-helpers.ts` + `cash-queries.test.ts`).

- [ ] **Step 1: Write the failing tests**

Create `apps/erp/src/lib/settings-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateNewPassword, validateBugReport } from './settings-helpers';

describe('validateNewPassword', () => {
  it('rejects empty', () => {
    expect(validateNewPassword('', '')).toEqual({ ok: false, error: 'New password is required' });
  });
  it('rejects mismatched confirmation', () => {
    expect(validateNewPassword('abcdef', 'abcxyz')).toEqual({
      ok: false,
      error: 'Passwords do not match',
    });
  });
  it('rejects too short (< 6 chars — matches Supabase minimum)', () => {
    expect(validateNewPassword('abc', 'abc')).toEqual({
      ok: false,
      error: 'Password must be at least 6 characters',
    });
  });
  it('accepts matching password >= 6 chars', () => {
    expect(validateNewPassword('abcdef', 'abcdef')).toEqual({ ok: true });
  });
});

describe('validateBugReport', () => {
  it('rejects missing description', () => {
    expect(validateBugReport({ category: 'bug', severity: 'low', description: '' })).toEqual({
      ok: false,
      error: 'Description is required',
    });
  });
  it('rejects description under 10 characters', () => {
    expect(validateBugReport({ category: 'bug', severity: 'low', description: 'too short' })).toEqual({
      ok: false,
      error: 'Description must be at least 10 characters',
    });
  });
  it('rejects invalid category', () => {
    expect(
      validateBugReport({ category: 'not_a_category' as never, severity: 'low', description: 'a valid description' }),
    ).toEqual({ ok: false, error: 'Invalid category' });
  });
  it('rejects invalid severity', () => {
    expect(
      validateBugReport({ category: 'bug', severity: 'urgent' as never, description: 'a valid description' }),
    ).toEqual({ ok: false, error: 'Invalid severity' });
  });
  it('accepts a valid payload', () => {
    expect(
      validateBugReport({ category: 'bug', severity: 'medium', description: 'Something is off here.' }),
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
pnpm --filter erp test -- settings-helpers
```

Expected: FAIL — module `./settings-helpers` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `apps/erp/src/lib/settings-helpers.ts`:

```ts
/**
 * Pure validation helpers for the Settings page.
 *
 * These run on the client for fast feedback and are ALSO called from the
 * server actions as defence-in-depth. Keep them free of Supabase / framework
 * imports so they stay unit-testable.
 */

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Supabase Auth's default minimum is 6 characters. Raise via the Supabase
// dashboard if tighter rules are ever desired — do not reimplement here.
const MIN_PASSWORD_LENGTH = 6;

export function validateNewPassword(newPassword: string, confirmPassword: string): ValidationResult {
  if (!newPassword) return { ok: false, error: 'New password is required' };
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (newPassword !== confirmPassword) return { ok: false, error: 'Passwords do not match' };
  return { ok: true };
}

export const BUG_REPORT_CATEGORIES = ['bug', 'feature_request', 'question', 'other'] as const;
export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export const BUG_REPORT_SEVERITIES = ['low', 'medium', 'high'] as const;
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];

export const BUG_REPORT_CATEGORY_LABEL: Record<BugReportCategory, string> = {
  bug: 'Bug',
  feature_request: 'Feature request',
  question: 'Question',
  other: 'Other',
};

export const BUG_REPORT_SEVERITY_LABEL: Record<BugReportSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface BugReportDraft {
  category: BugReportCategory;
  severity: BugReportSeverity;
  description: string;
}

export function validateBugReport(draft: BugReportDraft): ValidationResult {
  if (!draft.description) return { ok: false, error: 'Description is required' };
  if (draft.description.trim().length < 10) {
    return { ok: false, error: 'Description must be at least 10 characters' };
  }
  if (!BUG_REPORT_CATEGORIES.includes(draft.category)) {
    return { ok: false, error: 'Invalid category' };
  }
  if (!BUG_REPORT_SEVERITIES.includes(draft.severity)) {
    return { ok: false, error: 'Invalid severity' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pnpm --filter erp test -- settings-helpers
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/lib/settings-helpers.ts apps/erp/src/lib/settings-helpers.test.ts
git commit -m "feat(settings): add validation helpers for password + bug report"
```

---

## Task 3: Server queries (`settings-queries.ts`)

**Files:**
- Create: `apps/erp/src/lib/settings-queries.ts`

**What this task produces:** Two read-only queries — `listMyBugReports()` (scoped by RLS) and `listAllUsers()` (founder-only, enforces role guard).

- [ ] **Step 1: Create the file**

Create `apps/erp/src/lib/settings-queries.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors mentioning `settings-queries.ts`. If `Database['public']['Tables']['bug_reports']` is missing, re-run the type generation from Task 1 Step 5.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/settings-queries.ts
git commit -m "feat(settings): server queries for bug reports + users list"
```

---

## Task 4: Server actions (`settings-actions.ts`)

**Files:**
- Create: `apps/erp/src/lib/settings-actions.ts`

**What this task produces:** Four server actions — `changePassword`, `submitBugReport`, `updateUserRole`, `setUserActive`. Each returns `ActionResult<T>`, never throws.

- [ ] **Step 1: Create the file with imports and the password action**

Create `apps/erp/src/lib/settings-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getUserProfile } from '@/lib/auth';
import {
  validateNewPassword,
  validateBugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from '@/lib/settings-helpers';
import type { Database } from '@repo/types/database';

type AppRole = Database['public']['Enums']['app_role'];

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

    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}
```

- [ ] **Step 2: Append the bug report action**

Append to `apps/erp/src/lib/settings-actions.ts`:

```ts
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err('You must be signed in to submit a report');

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

    // Fire-and-forget n8n webhook. NEVER let webhook failures fail the submit.
    await notifyBugReport({
      id: data.id,
      userId: user.id,
      userEmail: user.email ?? '',
      category: input.category,
      severity: input.severity,
      description: input.description,
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
 * POST the bug report summary to the n8n webhook if configured. Never throws.
 * Best-effort: we accept missed notifications rather than missed submissions.
 */
async function notifyBugReport(payload: {
  id: string;
  userId: string;
  userEmail: string;
  category: BugReportCategory;
  severity: BugReportSeverity;
  description: string;
  pageUrl: string;
}): Promise<void> {
  const op = '[notifyBugReport]';
  const webhookUrl = process.env.N8N_BUG_REPORT_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — silent skip is expected.

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      // Short timeout — don't hold the server action thread.
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      console.error(`${op} webhook non-2xx`, {
        status: resp.status,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error(`${op} webhook failure (non-blocking)`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 3: Append the user management actions**

Append to `apps/erp/src/lib/settings-actions.ts`:

```ts
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
      return err(error.message);
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
      return err(error.message);
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
```

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in `settings-actions.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/lib/settings-actions.ts
git commit -m "feat(settings): server actions for password, bug reports, user mgmt"
```

---

## Task 5: Profile dropdown component

**Files:**
- Create: `apps/erp/src/components/profile-menu.tsx`

**What this task produces:** A client component that renders the user's name + role badge as a dropdown trigger. Dropdown items: Settings, divider, Sign out. This replaces the inline cluster in the topbar in Task 6.

- [ ] **Step 1: Verify shadcn `DropdownMenu` exports**

Run:
```bash
grep -n "^export" packages/ui/src/components/dropdown-menu.tsx | head
```

Expected: exports include `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`. If any are missing, import directly from `@radix-ui/react-dropdown-menu` as fallback.

- [ ] **Step 2: Write the component**

Create `apps/erp/src/components/profile-menu.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui';
import { ChevronDown, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { getRoleLabel, type AppRole } from '@/lib/roles';

interface ProfileMenuProps {
  fullName: string;
  role: AppRole;
}

export function ProfileMenu({ fullName, role }: ProfileMenuProps) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-n-100 transition-colors"
          aria-label="Open profile menu"
        >
          <span className="text-sm text-n-600">{fullName}</span>
          <Badge variant="success">{getRoleLabel(role)}</Badge>
          <ChevronDown className="h-3.5 w-3.5 text-n-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
            <SettingsIcon className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="flex items-center gap-2 cursor-pointer text-status-error-text"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in `profile-menu.tsx`. If any `DropdownMenu*` export is missing from `@repo/ui`, add the missing re-export to `packages/ui/src/index.ts` before proceeding — e.g.:

```ts
// packages/ui/src/index.ts  (only if missing)
export * from './components/dropdown-menu';
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/profile-menu.tsx packages/ui/src/index.ts
git commit -m "feat(settings): add ProfileMenu dropdown component"
```

(Drop `packages/ui/src/index.ts` from the `git add` if it wasn't modified.)

---

## Task 6: Wire ProfileMenu into topbar

**Files:**
- Modify: `apps/erp/src/components/topbar.tsx`

**What this task produces:** The topbar renders `<ProfileMenu>` in place of the inline name/badge/sign-out cluster. The `RoleSwitcher` (founder only) stays as a separate sibling control.

- [ ] **Step 1: Replace the cluster**

Open `apps/erp/src/components/topbar.tsx`. Replace the block from `<span className="text-sm text-n-600">{profile.full_name}</span>` through the closing `</button>` of the sign-out button (currently lines 41–50 in the file) with a single `<ProfileMenu>`. Also remove the now-unused `LogOut` import and the `handleSignOut` function.

The edited file should look like this:

```tsx
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { getRoleLabel } from '@/lib/roles';
import type { AppRole } from '@/lib/roles';
import { ArrowLeft } from 'lucide-react';
import { RoleSwitcher } from './role-switcher';
import { ProfileMenu } from './profile-menu';

interface TopbarProps {
  profile: {
    full_name: string;
    role: AppRole;
  };
}

export function Topbar({ profile }: TopbarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const pageTitle = getPageTitle(pathname);
  const isFounder = profile.role === 'founder';
  const viewAs = searchParams.get('view_as') ?? undefined;
  const isViewingAsOtherRole = isFounder && viewAs && viewAs !== 'founder';

  return (
    <>
      <header className="h-14 bg-white border-b border-n-200 shadow-xs flex items-center justify-between px-6">
        <h1 className="text-base font-heading font-bold text-n-900">{pageTitle}</h1>
        <div className="flex items-center gap-3">
          {isFounder && <RoleSwitcher currentViewAs={viewAs} />}
          <ProfileMenu fullName={profile.full_name} role={profile.role} />
        </div>
      </header>
      {isViewingAsOtherRole && (
        <div className="bg-status-warning-bg border-b border-[#FACB01] px-6 py-1.5 flex items-center gap-2 text-sm">
          <span className="font-medium text-status-warning-text">
            Viewing as: {getRoleLabel(viewAs as AppRole)}
          </span>
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-1 text-xs font-medium text-status-warning-text hover:text-[#78350F] underline underline-offset-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Founder View
          </button>
        </div>
      )}
    </>
  );
}

function getPageTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const page = segments[0] ?? 'dashboard';
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    leads: 'Leads',
    proposals: 'Proposals',
    projects: 'Projects',
    procurement: 'Procurement',
    cash: 'Cash Flow',
    om: 'O&M',
    hr: 'HR',
    inventory: 'Inventory',
    settings: 'Settings',
  };
  return titles[page] ?? page.charAt(0).toUpperCase() + page.slice(1);
}
```

Note: `createClient` import and the `supabase` const are also removed since `handleSignOut` now lives in `ProfileMenu`. The `settings: 'Settings'` key is added to `titles`.

- [ ] **Step 2: Start the dev server and visually confirm**

Run:
```bash
pnpm --filter erp dev
```

Open the app, confirm the topbar still renders, the name + role badge now show a small chevron, clicking opens a menu with "Settings" and "Sign out". Sign out still works. No console errors.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -10
pnpm --filter erp lint 2>&1 | tail -20
```

Expected: no new errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/topbar.tsx
git commit -m "feat(settings): wire ProfileMenu into topbar"
```

---

## Task 7: Settings page shell with tabs

**Files:**
- Create: `apps/erp/src/app/(erp)/settings/page.tsx`

**What this task produces:** The server component that loads profile + per-tab data and renders the Tabs container. The tab contents are added in subsequent tasks; placeholders are used here so routing and role-gating can be verified first.

- [ ] **Step 1: Create the page**

Create `apps/erp/src/app/(erp)/settings/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { listMyBugReports, listAllUsers } from '@/lib/settings-queries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui';
import { AccountTab } from './_client/account-tab';
import { FeedbackTab } from './_client/feedback-tab';
import { UsersTab } from './_client/users-tab';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const [myReports, users] = await Promise.all([
    listMyBugReports(),
    profile.role === 'founder' ? listAllUsers() : Promise.resolve([]),
  ]);

  const isFounder = profile.role === 'founder';

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-heading font-bold text-n-900 mb-4">Settings</h1>
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          {isFounder && <TabsTrigger value="users">Users</TabsTrigger>}
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <AccountTab
            fullName={profile.full_name}
            email={profile.email}
            role={profile.role}
          />
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <FeedbackTab myReports={myReports} />
        </TabsContent>

        {isFounder && (
          <TabsContent value="users" className="mt-4">
            <UsersTab users={users} currentUserId={profile.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Create placeholder tab files so the page compiles**

Create `apps/erp/src/app/(erp)/settings/_client/account-tab.tsx`:

```tsx
'use client';
import type { AppRole } from '@/lib/roles';

interface Props {
  fullName: string;
  email: string;
  role: AppRole;
}

export function AccountTab({ fullName, email, role }: Props) {
  return <div className="text-sm text-n-600">Account tab — {fullName} · {email} · {role}</div>;
}
```

Create `apps/erp/src/app/(erp)/settings/_client/feedback-tab.tsx`:

```tsx
'use client';
import type { Database } from '@repo/types/database';

type BugReportRow = Database['public']['Tables']['bug_reports']['Row'];

interface Props {
  myReports: BugReportRow[];
}

export function FeedbackTab({ myReports }: Props) {
  return <div className="text-sm text-n-600">Feedback tab — {myReports.length} past reports</div>;
}
```

Create `apps/erp/src/app/(erp)/settings/_client/users-tab.tsx`:

```tsx
'use client';
import type { Database } from '@repo/types/database';

type User = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'email' | 'role' | 'is_active'
>;

interface Props {
  users: User[];
  currentUserId: string;
}

export function UsersTab({ users, currentUserId }: Props) {
  return (
    <div className="text-sm text-n-600">
      Users tab — {users.length} users (current: {currentUserId})
    </div>
  );
}
```

- [ ] **Step 3: Manually verify routing + role gating**

With dev server running, sign in as a **non-founder** test user and navigate to `/settings`. Expected: Account + Feedback tabs visible; no Users tab. No console errors.

Sign in as the **founder** and navigate to `/settings`. Expected: all three tabs visible.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/app/\(erp\)/settings
git commit -m "feat(settings): route shell with tabs + role gate"
```

---

## Task 8: Account tab — change password form

**Files:**
- Modify: `apps/erp/src/app/(erp)/settings/_client/account-tab.tsx`

**What this task produces:** A working "Change password" form alongside read-only profile info.

- [ ] **Step 1: Replace the placeholder with the real component**

Replace the contents of `apps/erp/src/app/(erp)/settings/_client/account-tab.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Input, Label, useToast } from '@repo/ui';
import { changePassword } from '@/lib/settings-actions';
import { validateNewPassword } from '@/lib/settings-helpers';
import { getRoleLabel, type AppRole } from '@/lib/roles';

interface AccountTabProps {
  fullName: string;
  email: string;
  role: AppRole;
}

export function AccountTab({ fullName, email, role }: AccountTabProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();

  const clientValidation = validateNewPassword(newPassword, confirmPassword);
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    clientValidation.ok &&
    !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await changePassword(currentPassword, newPassword, confirmPassword);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not change password',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Password changed',
        description: 'Your password has been updated.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    });
  }

  return (
    <div className="space-y-6">
      {/* Profile display */}
      <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Profile</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-n-500">Name</dt>
          <dd className="text-n-900">{fullName}</dd>
          <dt className="text-n-500">Email</dt>
          <dd className="text-n-900">{email}</dd>
          <dt className="text-n-500">Role</dt>
          <dd>
            <Badge variant="success">{getRoleLabel(role)}</Badge>
          </dd>
        </dl>
      </section>

      {/* Change password */}
      <section className="space-y-4 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Change password</h2>
        <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
          <div className="space-y-1">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={pending}
              required
            />
            {!clientValidation.ok && confirmPassword.length > 0 && (
              <p className="text-xs text-status-error-text">{clientValidation.error}</p>
            )}
          </div>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? 'Updating…' : 'Change password'}
          </Button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify in dev**

On `/settings` Account tab, confirm:
1. The form shows name, email, role badge.
2. Typing mismatched passwords shows "Passwords do not match" under the confirm field.
3. Submitting with the wrong current password shows a destructive toast "Current password is incorrect".
4. Submitting with the right current password and a new password ≥ 6 chars shows a success toast and clears the form.
5. After a successful change, sign out and sign back in with the new password.

(Use a throwaway test account for this — do not change your own founder password until you've verified the flow.)

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -10
pnpm --filter erp lint 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/settings/_client/account-tab.tsx
git commit -m "feat(settings): account tab — change password form"
```

---

## Task 9: Feedback tab — submit form + history

**Files:**
- Modify: `apps/erp/src/app/(erp)/settings/_client/feedback-tab.tsx`

**What this task produces:** A bug report submission form and a "Your past reports" table.

- [ ] **Step 1: Replace the placeholder with the real component**

Replace the contents of `apps/erp/src/app/(erp)/settings/_client/feedback-tab.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  Badge,
  Button,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui';
import type { Database } from '@repo/types/database';
import { submitBugReport } from '@/lib/settings-actions';
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_CATEGORY_LABEL,
  BUG_REPORT_SEVERITIES,
  BUG_REPORT_SEVERITY_LABEL,
  validateBugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from '@/lib/settings-helpers';

type BugReportRow = Database['public']['Tables']['bug_reports']['Row'];

interface FeedbackTabProps {
  myReports: BugReportRow[];
}

export function FeedbackTab({ myReports }: FeedbackTabProps) {
  const [category, setCategory] = useState<BugReportCategory>('bug');
  const [severity, setSeverity] = useState<BugReportSeverity>('medium');
  const [description, setDescription] = useState('');
  const [pageUrl, setPageUrl] = useState<string>('/settings');
  const [userAgent, setUserAgent] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();

  useEffect(() => {
    // Capture referrer + UA once on mount (client-only).
    if (typeof window !== 'undefined') {
      setPageUrl(document.referrer || window.location.pathname);
      setUserAgent(navigator.userAgent);
    }
  }, []);

  const validation = useMemo(
    () => validateBugReport({ category, severity, description }),
    [category, severity, description],
  );
  const canSubmit = validation.ok && !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await submitBugReport({
        category,
        severity,
        description: description.trim(),
        pageUrl,
        userAgent,
      });
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not submit report',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Report submitted',
        description: "Thanks — we've got it.",
      });
      setDescription('');
    });
  }

  return (
    <div className="space-y-6">
      {/* Submit form */}
      <section className="space-y-4 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Report a bug or request a feature</h2>
        <form onSubmit={handleSubmit} className="space-y-3 max-w-lg">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="category">Category</Label>
              <Select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BugReportCategory)}
                disabled={pending}
              >
                {BUG_REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUG_REPORT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="severity">Severity</Label>
              <Select
                id="severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}
                disabled={pending}
              >
                {BUG_REPORT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {BUG_REPORT_SEVERITY_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              rows={5}
              className="w-full rounded-md border border-n-300 bg-white px-3 py-2 text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-shiroi-green focus:border-transparent"
              placeholder="What happened? What did you expect to happen?"
            />
            <p className="text-xs text-n-500">
              {description.trim().length} / 10 characters minimum
            </p>
          </div>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? 'Submitting…' : 'Submit report'}
          </Button>
        </form>
      </section>

      {/* History */}
      <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Your past reports</h2>
        {myReports.length === 0 ? (
          <p className="text-sm text-n-500">You haven&apos;t submitted any reports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myReports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-n-600">
                    {new Date(r.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </TableCell>
                  <TableCell>{BUG_REPORT_CATEGORY_LABEL[r.category]}</TableCell>
                  <TableCell>
                    <SeverityBadge severity={r.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-[360px] truncate text-sm text-n-700">
                    {r.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: BugReportRow['severity'] }) {
  const variant =
    severity === 'high' ? 'destructive' : severity === 'medium' ? 'warning' : 'default';
  return <Badge variant={variant as never}>{BUG_REPORT_SEVERITY_LABEL[severity]}</Badge>;
}

function StatusBadge({ status }: { status: BugReportRow['status'] }) {
  const label = status === 'in_progress' ? 'In progress' : status === 'resolved' ? 'Resolved' : 'Open';
  const variant = status === 'resolved' ? 'success' : status === 'in_progress' ? 'warning' : 'default';
  return <Badge variant={variant as never}>{label}</Badge>;
}
```

Note on `Badge variant`: if `@repo/ui` Badge does not support `warning` / `destructive` / `default` variants, read `packages/ui/src/components/badge.tsx` and adjust to whichever variants do exist — common options are `success`, `warning`, `destructive`, `default`, `secondary`. Do NOT cast `as never` if the types match without it.

Note on `Select`: if the shadcn `Select` in `@repo/ui` is the Radix composed variant (requires `SelectTrigger` / `SelectContent` / `SelectItem`), switch to native `<select>` styled with Tailwind. Check `packages/ui/src/components/select.tsx` before writing and match the pattern used in `apps/erp/src/components/contacts/contact-form.tsx`.

- [ ] **Step 2: Manually verify in dev**

On `/settings` Feedback tab, confirm:
1. Submitting with < 10 char description keeps the button disabled.
2. Submitting a valid report shows a success toast.
3. The new report appears in the history table on the next navigation / refresh.
4. Switching tabs back and forth does not lose the form state unexpectedly.

- [ ] **Step 3: Verify n8n webhook graceful skip**

With `N8N_BUG_REPORT_WEBHOOK_URL` unset in `.env.local`, submit a report. Expected: insert succeeds, no console errors about missing webhook.

Then set `N8N_BUG_REPORT_WEBHOOK_URL=https://httpbin.org/status/500` and submit another. Expected: insert still succeeds, a non-blocking warning is logged by `[notifyBugReport]`, and the user sees the normal success toast.

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -10
pnpm --filter erp lint 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/app/\(erp\)/settings/_client/feedback-tab.tsx
git commit -m "feat(settings): feedback tab — submit form + history table"
```

---

## Task 10: Users tab (founder only) — role + active controls

**Files:**
- Modify: `apps/erp/src/app/(erp)/settings/_client/users-tab.tsx`

**What this task produces:** A table of all employees with an editable role dropdown and an active toggle. Self-edit is disabled. Deactivation shows a confirm dialog first.

- [ ] **Step 1: Replace the placeholder with the real component**

Replace the contents of `apps/erp/src/app/(erp)/settings/_client/users-tab.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui';
import type { Database } from '@repo/types/database';
import { updateUserRole, setUserActive } from '@/lib/settings-actions';
import { ROLE_LABELS, type AppRole } from '@/lib/roles';

type User = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'email' | 'role' | 'is_active'
>;

interface UsersTabProps {
  users: User[];
  currentUserId: string;
}

export function UsersTab({ users, currentUserId }: UsersTabProps) {
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);

  function onRoleChange(user: User, newRole: AppRole) {
    if (newRole === user.role) return;
    startTransition(async () => {
      const result = await updateUserRole(user.id, newRole);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not update role',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Role updated',
        description: `${user.full_name} is now ${ROLE_LABELS[newRole]}`,
      });
    });
  }

  function onActivate(user: User) {
    startTransition(async () => {
      const result = await setUserActive(user.id, true);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not activate user',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'User activated',
        description: `${user.full_name} can sign in again.`,
      });
    });
  }

  function onConfirmDeactivate() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    startTransition(async () => {
      const result = await setUserActive(target.id, false);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not deactivate user',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'User deactivated',
        description: `${target.full_name} will lose access on their next page load.`,
      });
    });
  }

  return (
    <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-n-900">Users</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell className="text-sm text-n-600">{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onChange={(e) => onRoleChange(u, e.target.value as AppRole)}
                    disabled={isSelf || pending}
                    title={isSelf ? 'You cannot change your own role' : undefined}
                  >
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  {u.is_active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant={'destructive' as never}>Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {u.is_active ? (
                    <Button
                      variant={'destructive' as never}
                      size={'sm' as never}
                      disabled={isSelf || pending}
                      onClick={() => setConfirmTarget(u)}
                      title={isSelf ? 'You cannot deactivate yourself' : undefined}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      size={'sm' as never}
                      disabled={pending}
                      onClick={() => onActivate(u)}
                    >
                      Activate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate user?</DialogTitle>
            <DialogDescription>
              {confirmTarget
                ? `${confirmTarget.full_name} will lose access to the ERP on their next page load. You can reactivate them later.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant={'secondary' as never} onClick={() => setConfirmTarget(null)}>
              Cancel
            </Button>
            <Button variant={'destructive' as never} onClick={onConfirmDeactivate}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

Note on variant / size casts: `as never` is a quiet cast to bypass unknown prop-type variants while still compiling. Before committing, read `packages/ui/src/components/button.tsx` and `packages/ui/src/components/badge.tsx`, then replace `as never` with the correct variant union literal (e.g., `'destructive'`, `'sm'`). Do not leave `as never` in merged code — that violates rule #3 (no `any`/`never` casts in production code). If a variant doesn't exist, either add it to the component cva or choose the closest existing one.

- [ ] **Step 2: Manually verify in dev (as founder)**

On `/settings` Users tab, confirm:
1. All employees listed.
2. Your own row has a disabled Role select and disabled Deactivate button; hover tooltip explains why.
3. Changing another user's role shows a success toast immediately; refresh confirms it persisted.
4. Clicking Deactivate on another user opens a confirm dialog. Cancel closes without effect. Confirming flips them to Inactive with a success toast.
5. Re-activating an inactive user works without a confirm dialog (no risk to confirm).

- [ ] **Step 3: Verify as non-founder**

Sign in as a non-founder (e.g., `designer`) and navigate to `/settings`. Expected: no Users tab visible. Direct navigation to `?tab=users` or typing `/settings` and clicking Users is not possible since the tab is not rendered. The page itself is accessible to everyone — only the tab visibility + server-side action guards enforce founder-only writes.

Attempt to directly call `updateUserRole` via devtools / network replay. Expected: server action returns `{ success: false, error: 'Not authorized' }`.

- [ ] **Step 4: Replace `as never` casts**

Read `packages/ui/src/components/button.tsx` and `badge.tsx` for valid variant / size literals. Replace every `as never` in `users-tab.tsx` and `feedback-tab.tsx` (from Task 9) with the real string literal. Re-run typecheck.

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
pnpm --filter erp exec tsc --noEmit 2>&1 | tail -10
pnpm --filter erp lint 2>&1 | tail -10
```

Expected: no new errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/app/\(erp\)/settings/_client/users-tab.tsx apps/erp/src/app/\(erp\)/settings/_client/feedback-tab.tsx
git commit -m "feat(settings): users tab — role + active controls with self-guard"
```

---

## Task 11: Playwright smoke tests

**Files:**
- Modify: `apps/erp/e2e/smoke.spec.ts`

**What this task produces:** Three additional smoke tests that assert `/settings` renders, the ProfileMenu exists in the topbar, and Account + Feedback tabs are present.

- [ ] **Step 1: Append three tests to `smoke.spec.ts`**

Add these tests at the end of `apps/erp/e2e/smoke.spec.ts` (before the last `});` if wrapped in a describe, otherwise at file end):

```ts
// ═══════════════════════════════════════════════════════════════════════
// Test: /settings page renders (auth required)
// ═══════════════════════════════════════════════════════════════════════
test('settings page renders after login', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('tab', { name: /account/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /feedback/i })).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test: profile menu opens from topbar and exposes Settings + Sign out
// ═══════════════════════════════════════════════════════════════════════
test('profile menu dropdown reaches settings', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/');
  await page.getByRole('button', { name: /open profile menu/i }).click();
  await expect(page.getByRole('menuitem', { name: /settings/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test: feedback tab form validation — submit disabled under 10 chars
// ═══════════════════════════════════════════════════════════════════════
test('feedback form blocks submit under 10 characters', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/settings');
  await page.getByRole('tab', { name: /feedback/i }).click();
  await page.getByLabel(/description/i).fill('short');
  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeDisabled();
  await page.getByLabel(/description/i).fill('This is a long enough description.');
  await expect(submit).toBeEnabled();
  await expectNoDevErrorOverlay(page);
});
```

- [ ] **Step 2: Run the smoke tests locally**

Ensure dev Supabase is reachable and `PLAYWRIGHT_LOGIN_EMAIL` / `_PASSWORD` are set in `.env.playwright`. Start the ERP (`pnpm --filter erp dev`), then in a separate terminal:

```bash
pnpm --filter erp exec playwright test e2e/smoke.spec.ts --grep "settings|profile menu|feedback form"
```

Expected: all three new tests pass. If the dev server runs on a non-default port, pass `--base-url` or set it in the Playwright config.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/e2e/smoke.spec.ts
git commit -m "test(settings): Playwright smoke tests for /settings"
```

---

## Task 12: Docs + env var

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/CURRENT_STATUS.md` (if there's an in-flight section touching this)

**What this task produces:** The new optional env var is documented, and the CHANGELOG has a one-line entry.

- [ ] **Step 1: Add env var to `CLAUDE.md`**

In `CLAUDE.md`, find the `ENVIRONMENT VARIABLES (names only — values in `.env.local`)` section. Add `N8N_BUG_REPORT_WEBHOOK_URL` at the end of that block, e.g.:

```
N8N_BUG_REPORT_WEBHOOK_URL            (optional — n8n webhook that receives a JSON payload when a bug report is submitted; if unset, reports are still stored in DB)
```

- [ ] **Step 2: Add one line to `docs/CHANGELOG.md`**

Prepend (or append to today's section, matching existing style) a single line. Check the file's current header style first; a safe line to add is:

```
2026-04-18 — feat(settings): user settings page (Account / Feedback / Users) + migration 073 bug_reports
```

- [ ] **Step 3: Update `docs/CURRENT_STATUS.md` if applicable**

If there's an "in-flight" section for this week, add a bullet acknowledging the settings page has landed. If not, skip.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/CHANGELOG.md docs/CURRENT_STATUS.md
git commit -m "docs(settings): env var + changelog for user settings page"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: all commits pushed cleanly. No force push; no rebase needed.

---

## Post-implementation checklist

Before declaring done, verify:

- [ ] `/settings` renders for a non-founder role (only Account + Feedback tabs visible).
- [ ] `/settings` renders for a founder (all three tabs visible, Users tab populated).
- [ ] Password change requires current password; wrong current password shows toast.
- [ ] Password change with correct current password succeeds; can sign in with new password.
- [ ] Bug report under 10 chars can't be submitted; full report persists + appears in history.
- [ ] With `N8N_BUG_REPORT_WEBHOOK_URL` unset: no errors. With a 500-returning URL set: insert still succeeds.
- [ ] Founder can change another user's role; cannot change own. Tooltip explains why.
- [ ] Founder can deactivate another user via confirm dialog; cannot deactivate own account.
- [ ] RLS: attempted direct `updateUserRole` call from a non-founder session returns `Not authorized`.
- [ ] All Playwright smoke tests pass locally.
- [ ] `pnpm --filter erp lint` and `tsc --noEmit` are clean.
- [ ] `packages/types/database.ts` includes `bug_reports` + enums.
- [ ] No sensitive values logged in any server action.

---

## Out of scope (do not implement)

- Dedicated founder bug-report triage UI with status transitions — Phase 2. Founder sees reports on their own Feedback tab today via RLS.
- Screenshot uploads on bug reports.
- Password strength beyond Supabase defaults.
- Forced-logout of existing sessions after deactivation.
- User creation / invite flow.
