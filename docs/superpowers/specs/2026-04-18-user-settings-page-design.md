# User Settings Page — Design Spec

**Date:** 2026-04-18
**Author:** Vivek (via Claude)
**Status:** Approved for implementation planning

---

## Problem

Every employee using the ERP needs a place to:
1. Change their password without contacting an admin
2. Report bugs, request features, or ask questions

Additionally, the founder needs a lightweight admin UI to manage employee roles and offboard people (revoke access) without going into the Supabase dashboard.

Currently there is no settings page, and role/password changes require direct DB or Supabase dashboard access.

---

## Goals

- Self-serve password change for all employees
- In-app feedback channel (stored in DB + email notification via n8n)
- Founder-only user management: role changes + activate/deactivate
- Follow existing coding standards (ActionResult, queries/actions separation, decimal.js N/A here, RLS defense-in-depth)

## Non-Goals (explicitly out of scope)

- User creation / invite flow (use Supabase dashboard or Phase 2)
- Screenshot uploads on bug reports (Phase 2)
- Extra password strength rules beyond Supabase defaults
- A dedicated `/bug-reports` founder triage page (Phase 2 — founder sees their own submissions on the feedback tab like everyone else for now; a richer admin triage UI can come later)
- Real-time push / in-app notification for new bug reports (n8n handles external notification)

---

## Architecture

### Route

Single route: `/settings` inside the `(erp)` route group.

Tabs (shadcn `Tabs` component):
- **Account** (visible to all)
- **Feedback** (visible to all)
- **Users** (visible to founder only — tab rendered conditionally; route guards also enforced server-side)

### Entry Point

The existing topbar cluster (name + role Badge + Sign out icon button) is replaced with a `ProfileMenu` component — a shadcn `DropdownMenu` triggered by clicking the user's name.

Dropdown items:
1. `Settings` → `/settings`
2. `---` (divider)
3. `Sign out` → existing `supabase.auth.signOut()` flow

The founder role-switcher (`RoleSwitcher`) remains a separate adjacent control — not folded into the profile menu.

### File Layout

```
apps/erp/src/app/(erp)/settings/
  page.tsx                          Server component; fetches profile + tab data
  _client/
    account-tab.tsx                 Password change form
    feedback-tab.tsx                Bug report form + user's past submissions
    users-tab.tsx                   Founder-only: all users, role + active controls

apps/erp/src/lib/
  settings-queries.ts               listAllUsers(), listMyBugReports()
  settings-actions.ts               changePassword(), submitBugReport(),
                                    updateUserRole(), setUserActive()

apps/erp/src/components/
  profile-menu.tsx                  Topbar dropdown (replaces inline cluster)

supabase/migrations/
  073_bug_reports.sql               New table + RLS for bug_reports, AND the RLS
                                    amendment on profiles (founder UPDATE of
                                    role/is_active). Single migration file.
```

`apps/erp/src/components/topbar.tsx` is modified to render `ProfileMenu` in place of the existing name/badge/sign-out cluster.

---

## Data Model

### New table: `bug_reports`

```sql
CREATE TYPE bug_report_category AS ENUM ('bug', 'feature_request', 'question', 'other');
CREATE TYPE bug_report_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE bug_report_status AS ENUM ('open', 'in_progress', 'resolved');

CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  category bug_report_category NOT NULL,
  severity bug_report_severity NOT NULL,
  description TEXT NOT NULL,
  page_url TEXT,
  user_agent TEXT,
  status bug_report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_bug_reports_user_created ON bug_reports(user_id, created_at DESC);
CREATE INDEX idx_bug_reports_status_created ON bug_reports(status, created_at DESC);
```

### RLS — `bug_reports`

- `INSERT`: `user_id = auth.uid()` — users file their own reports only
- `SELECT`: own rows, OR caller's `profiles.role = 'founder'`
- `UPDATE`: caller's `profiles.role = 'founder'` only (status and `resolved_at`)
- `DELETE`: none (reports are append-only from the app)

### RLS — `profiles` (amendment)

Add a policy allowing `UPDATE` on `profiles.role` and `profiles.is_active` when the caller's own `profiles.role = 'founder'`. Existing self-update policies remain for other fields (e.g., `full_name`). Exact policy expression is confirmed against the current `profiles` RLS during implementation — we do not regress existing self-update access.

### No schema changes to

- `profiles` columns (role/is_active already exist)
- `auth.users` (password change flows through Supabase Auth APIs, not direct writes)

---

## Server Actions

All in `apps/erp/src/lib/settings-actions.ts`. All return `ActionResult<T>` from `apps/erp/src/lib/types/actions`. All use the `const op = '[functionName]';` pattern and never throw across the RSC boundary.

### `changePassword(currentPassword, newPassword)`

Flow:
1. Get current session user (email from auth).
2. Call `supabase.auth.signInWithPassword({ email, password: currentPassword })` to verify the current password. If that fails, return `{ ok: false, error: 'Current password is incorrect' }`.
3. Call `supabase.auth.updateUser({ password: newPassword })`. If Supabase rejects (e.g., too short per Supabase dashboard config), return `{ ok: false, error: <supabase message> }`.
4. On success, return `{ ok: true }`.

Rationale for step 2: the current session is already authenticated, so `updateUser` alone would allow a password change from an unattended logged-in session. Re-authenticating forces proof of knowledge.

### `submitBugReport(category, severity, description, pageUrl)`

Flow:
1. Validate inputs: description length ≥ 10, category and severity in enum.
2. `user_agent` and `page_url` are captured on the client and passed in as form fields (consistent source, no server/client split).
3. Insert into `bug_reports` with `user_id = auth.uid()`.
4. If `process.env.N8N_BUG_REPORT_WEBHOOK_URL` is set, POST a JSON payload in a try/catch. Webhook failures are logged but MUST NOT fail the submit — user experience takes priority over the notification.
5. `revalidatePath('/settings')` so the user's history list refreshes.
6. Return `{ ok: true }` with the created id.

Webhook payload shape (for the n8n flow you'll build later):

```json
{
  "id": "uuid",
  "user_name": "string",
  "user_email": "string",
  "category": "bug|feature_request|question|other",
  "severity": "low|medium|high",
  "description": "string",
  "page_url": "string",
  "created_at": "ISO8601"
}
```

### `updateUserRole(userId, newRole)` — founder-only

Flow:
1. Server-side role guard: `requireRole(['founder'])`.
2. Prevent self-change: if `userId === caller.id`, return `{ ok: false, error: 'You cannot change your own role' }`.
3. Update `profiles.role = newRole` where `id = userId`.
4. `revalidatePath('/settings')`.

### `setUserActive(userId, active)` — founder-only

Flow:
1. Server-side role guard: `requireRole(['founder'])`.
2. Prevent self-deactivation: if `userId === caller.id && active === false`, return `{ ok: false, error: 'You cannot deactivate yourself' }`.
3. Update `profiles.is_active = active`.
4. `revalidatePath('/settings')`.

Note: `is_active = false` does not sign the user out of existing sessions automatically. Existing middleware or query guards that check `is_active` will bounce them on their next action. A separate forced-logout mechanism is out of scope for this spec.

---

## Queries

All in `apps/erp/src/lib/settings-queries.ts`. Reads only, used by the server component page.

### `listMyBugReports()`

Returns the current user's bug reports ordered by `created_at DESC`. Used by the Feedback tab's history section. RLS handles scoping — no explicit filter needed, but we include `order by` and `limit 50` for safety.

### `listAllUsers()`

Founder-only. Returns all profiles: `id, full_name, email, role, is_active`, ordered by `full_name`. Caller-side guard also enforced (`requireRole`).

---

## UI

### Account tab

Top block (read-only display):
- Full name
- Email
- Role (Badge)

Password change form (shadcn `Form` + `Input` + `Button`):
- `current_password` (Input type password)
- `new_password` (Input type password)
- `confirm_password` (Input type password)
- Client-side validation: `new === confirm`. Submit disabled otherwise.
- Submit → server action → toast success/failure → clear fields on success.

### Feedback tab

Submit form:
- `category` — Select with 4 options
- `severity` — Select with 3 options, default `medium`
- `description` — Textarea, min 10 chars, counter shown
- Auto-captured (hidden):
  - `page_url` — from `document.referrer` if present, else `/settings`
  - `user_agent` — from `navigator.userAgent` (sent server-side to insert)

Below the form:
- "Your past reports" — table with columns: category, severity, status (Badge: open/in_progress/resolved), submitted (relative time).
- Empty state: "You haven't submitted any reports yet."

### Users tab (founder only)

Server component fetches all profiles. Table with columns:
- Name
- Email
- Role — Select dropdown; change triggers `updateUserRole`; toast on success
- Active — Switch; toggle triggers `setUserActive`; deactivation shows a confirm dialog first ("They will lose access on their next page load")

Guards on the logged-in founder's own row:
- Role select is disabled
- Active switch is disabled
- Hover tooltip: "You cannot change your own role or active status"

### Profile menu (topbar)

Replaces the current `<span>{full_name}</span><Badge>{role}</Badge><button>SignOut</button>` cluster with a single `DropdownMenu`:

- Trigger: name + role badge + subtle chevron
- Items: `Settings` (navigates to `/settings`), divider, `Sign out` (same signOut handler as today)

The founder `RoleSwitcher` (view-as control) remains a separate adjacent control to its left.

---

## Environment Variables

Add to the list in `CLAUDE.md`:

- `N8N_BUG_REPORT_WEBHOOK_URL` — optional. If unset, bug reports are stored but no external notification is sent. The ERP continues to work; this is purely for push notifications to the founder.

---

## Error Handling

Every server action follows the project convention from `SHIROI_MASTER_REFERENCE.md` §4:

```ts
export async function changePassword(...): Promise<ActionResult<void>> {
  const op = '[changePassword]';
  try {
    // ...
  } catch (error) {
    console.error(`${op} Unexpected failure:`, {
      userId: user?.id,
      error,
      timestamp: new Date().toISOString(),
    });
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
```

Sensitive values (`currentPassword`, `newPassword`) are never logged.

---

## Testing Strategy

- **Unit / integration (vitest):** server actions — success paths, wrong-current-password, self-change guards, RLS enforcement (via service-role vs anon clients on a test DB)
- **Playwright smoke tests:**
  - A non-founder user: sees Account + Feedback tabs only; submits a bug report; sees it in history
  - A founder user: sees all three tabs; changes another user's role; deactivates + reactivates another user; cannot change own role
  - Password change happy path on a throwaway test account

---

## Rollout

1. Write migration `073_bug_reports.sql` (and the profiles RLS amendment, either inline or as `073b_...`). Apply to dev first, verify, then prod. Regenerate `packages/types/database.ts` in the same commit as the migration.
2. Land queries, actions, pages, and the profile menu in one PR — this is a self-contained feature and keeps the topbar swap atomic with the `/settings` route going live.
3. Add `N8N_BUG_REPORT_WEBHOOK_URL` to `.env.local` (empty for now); document in `CLAUDE.md`. The n8n flow itself is configured by Vivek separately whenever convenient.
4. Update `docs/CHANGELOG.md` and `docs/CURRENT_STATUS.md`.

---

## Open Questions (nothing blocking)

- Should we eventually add a founder-only triage UI for bug reports (filtering, status transitions with notes)? Yes, but Phase 2. For now the founder uses their own Feedback tab history list — they see every report there because of the RLS SELECT rule.
- Should deactivation force-log-out existing sessions? Out of scope; revisit if someone complains about the delay.
