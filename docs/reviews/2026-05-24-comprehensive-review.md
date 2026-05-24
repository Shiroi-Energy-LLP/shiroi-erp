# Comprehensive Code Review — 2026-05-24

> Triggered by Vivek's "complete review of recent code" ask. Covers all work shipped
> 2026-05-18 through 2026-05-24: Phase B (marketing), Phase C-purchase/finance/ops/HR,
> Phase E (intelligence/AI), Phase F (scale), Phase 7+8 (inverter integration).
>
> Reviewer: Claude (Opus 4.7), six parallel subagent passes + local CI gate run.
> Files in scope: ~9,000 net new lines across 76 files + 17 migrations (117–133).

## Executive summary

**🔴 The headline finding is that CI is not actually green.** `CURRENT_STATUS.md` line 60
claims "CI green (check-types / lint / forbidden-patterns baseline 62)" for the Phase E
commit, but a fresh local run of `pnpm check-types` fails with **50+ errors** —
overwhelmingly in the Phase E and Phase F files that were just merged. The lint and
forbidden-pattern gates do pass, but the type-check failure alone is a NEVER-DO #20
violation: schema changes shipped without regenerating types in the same commit, and
two npm packages (`sonner`, `openai`) are imported but never added to any `package.json`.

`pnpm test` (vitest) also fails — 4 stale assertions (2 in `budgetary-quote.test.ts`,
2 in `roles.test.ts`) that were never updated when the underlying code changed in
Phase B and the C1 purchase work.

Per the agent reviews, the most material correctness/security defects are:

| # | Severity | Where | What |
|---|----------|-------|------|
| 1 | 🔴 | `apps/erp/src/lib/ai/project-daily-report.ts` and `apps/erp/src/lib/customer-outreach-actions.ts` | Phase E references columns/tables that do not exist (`projects.commissioned_at`, `project_tasks`, `daily_site_reports.work_completed`, etc.). The features cannot ever run as-is. |
| 2 | 🔴 | `apps/erp/src/app/(public)/p/[token]/proposal-portal-client.tsx` | Customer portal "Accept proposal" only flips local state; no DB write, no event. Customer thinks they accepted; ERP has no record. |
| 3 | 🔴 | `apps/erp/src/app/(public)/p/[token]/proposal-portal-client.tsx` and `/api/proposals/[id]/generate-pdf` | "Download PDF" button calls a route that returns 405 (POST-only + auth-required). Customer cannot get the PDF. |
| 4 | 🔴 | `supabase/migrations/131_referral_payouts.sql:63` | Trigger filters on `partner_type = 'internal'` but no row has that value (the column for internal is `is_internal BOOLEAN` from mig 109). Vivek and Management Referral seeded partners will auto-create payouts on every won lead. |
| 5 | 🔴 | `apps/erp/src/lib/material-requisition-actions.ts:113,217,386` | Three `notifications.insert(...)` calls use `notification_type='material_requisition'/'po_pending_approval'` and `entity_type='material_requisition'` — none are allowed by the CHECK constraint (mig 014). Every insert fails silently; no one is ever notified about requisitions or auto-PO approval. |
| 6 | 🔴 | `apps/erp/src/lib/referral-actions.ts:113` | `.update({ lifetime_commission: supabase.rpc(...) as never })` does not execute the RPC — it serializes the builder object as JSON. Every "Mark paid" corrupts `channel_partners.lifetime_commission`. Plus the RPC itself (`increment_partner_commission`) doesn't exist. |
| 7 | 🔴 | `apps/erp/src/lib/customer-outreach-actions.ts:34` | `generateCustomerCheckinsForWeek` is a server action that uses the admin client with no role check. Any authenticated user can burn Anthropic quota and queue customer messages. |
| 8 | 🔴 | `supabase/migrations/129_customer_message_log.sql` | No RLS. Customer phone numbers + message contents readable by every authenticated user. |
| 9 | 🔴 | `supabase/migrations/133_proposal_share_tokens.sql` | No RLS. Comment says "use admin client" but nothing enforces it. |
| 10 | 🔴 | `supabase/migrations/120_hr_leave_attendance_profile.sql:82-87` | `attendance_update` policy lets an employee update their own attendance rows — flip `absent` → `present` after the fact, change `marked_by`, etc. Payroll/labor-law risk. |
| 11 | 🔴 | `apps/erp/src/lib/material-requisition-actions.ts:143-211` | A `project_manager` can submit a requisition AND review/approve it themselves — no requester-vs-reviewer check. |
| 12 | 🔴 | `apps/erp/src/lib/material-requisition-queries.ts:114-131` | `fn_get_po_bill_reconciliation` is SECURITY DEFINER without a project-access check — any authenticated user can read any project's PO/bill/payment totals by URL-guessing the project id. |
| 13 | 🔴 | `apps/erp/src/lib/documents-actions.ts:97-107` + `supabase/migrations/013_proposal_files_bucket.sql:43-52` | C10 document drop-zone uploads to `proposal-files` bucket, but bucket INSERT RLS only allows founder/sales_engineer/designer. `project_manager`, `site_supervisor`, `om_technician` (the actual users) get an opaque storage error on every upload. |
| 14 | 🔴 | `apps/erp/src/lib/hr-actions.ts:69-134` | `approveLeaveRequest` does three writes (update status, insert ledger, upsert balance) outside a transaction. A network drop between steps corrupts leave state. |
| 15 | 🔴 | `apps/erp/src/lib/dc-certificate-actions.ts:59-74` | `signDcCertificate` is upsert-on-conflict — a "digital signature" can be silently overwritten by anyone with the role. Defeats the audit-trail intent. |

Beyond these, the six agent reports contain ~70 important/minor findings (RLS gaps,
schema column mismatches, hand-rolled modals, missing rate-limits, raw `select`
elements, hardcoded brand colours, inconsistent badge variants, etc.) — full detail
in the per-section appendices below.

**Migration numbering issues:** Mig 124 is missing entirely. Commit `0cdafb2`'s message
references "migrations 129-134" but only 129–133 actually exist; mig 134 was never
written. `CURRENT_STATUS.md` says migration state is "128" but is actually at 133.

**Documentation gaps:** `docs/modules/sales.md`, `finance.md`, `hr.md`, `projects.md`,
`inventory.md` are all missing recent feature additions despite the changelog
entries existing. Phase F was claimed done but the customer drip workflows reference
five events that the event-bus router doesn't recognize and that ERP code never emits.

## Recommended ordering for fixes

| Order | Group | Effort | Why this order |
|-------|-------|--------|----------------|
| 1 | Fix check-types errors | Half day | The CI gate is meant to catch exactly this — get it green before anything else lands |
| 2 | Fix 4 vitest assertions | 15 min | Trivial; restores test discipline |
| 3 | Critical SQL bugs (#4, #8, #9, #10) | Half day | Single migration with RLS + the `is_internal` trigger fix; ratchets safety |
| 4 | Critical app-layer bugs (#2, #3, #5, #6, #7, #11, #12, #13, #14, #15) | 1–2 days | Each is a small targeted patch but they touch many files |
| 5 | Phase E schema rewrite (#1) | 1 day | Either rewrite to match actual schema or scope down to what's implementable today |
| 6 | UI/UX critical (customer portal, money rules) | Half day | Customer-facing first; internal screens can wait |
| 7 | Documentation refresh | Half day | Module docs + CURRENT_STATUS migration state |
| 8 | Important findings (across all six reviews) | 2–3 days | Triage; some can be deferred |

## Process learnings (the meta-finding)

The work-product issues above are symptoms. The root cause is that the CLAUDE.md
end-of-task workflow ("CI test locally first … never push a red branch") was not
actually followed for Phase E or Phase F. Both commits passed `lint` and the
forbidden-pattern check but skipped `pnpm check-types`, which would have caught
the dependency drift and most of the schema mismatches before push.

Two reinforcements would close this:

1. **Make the CI gate non-optional locally.** A `pre-push` git hook that runs
   `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh`
   (and rejects push on failure) would have caught everything in this list. The
   `--no-verify` escape hatch is already discouraged by CLAUDE.md.
2. **Wire e2e/Playwright + vitest into CI.** Today the GitHub Actions workflow
   runs only check-types / lint / forbidden-patterns. Vitest failures (4 today)
   and the broken `project-daily-report` action would have been caught earlier.

A secondary learning: the system-notification "exit code 0" reported for the
background `pnpm check-types` was misleading — actual exit was 2. **Always read
the actual stdout/stderr** before trusting a "completed" notification.

A third learning, surfaced by the schema-mismatch findings: code was written
that referenced *desired* columns (`projects.commissioned_at`,
`daily_site_reports.work_completed`, etc.) without first checking the migration
files. The fix is to read the migration that defines the table before writing
queries against it — or to write the migration first and let `database.ts`
regeneration drive the type.

## Detailed per-area findings

For full per-area detail (every finding by severity with file:line refs), see the
six agent reports captured in this review:

- **Phase E (intelligence/AI):** 4 🔴, 6 🟠, 6 🟡 — schema mismatches dominate
- **Phase F (scale):** 6 🔴, 9 🟠, 5 🟡 — missing deps + missing RPCs dominate
- **Phase C-ops + C-HR:** 5 🔴, 8 🟠, 7 🟡 — RLS + atomicity gaps
- **Phase C-purchase + Inverter (Phase 7/8):** 4 🔴, 7 🟠, 8 🟡 — notification CHECK + atomicity
- **SQL migrations 117–134 + docs coverage:** 4 🔴, 10 🟠, 5 🟡 — RLS + naming
- **UI/UX of new pages:** 5 🔴, 17 🟠, 8 🟡 — design-system drift + customer portal

Strengths called out across all six reviews (not exhaustive):

- All new tables have indexes on filterable columns (NEVER-DO #17 respected almost universally).
- All new server actions return `ActionResult<T>` (NEVER-DO #19 respected).
- All new action files are under 500 LOC except `finance-actions.ts` (656) and `hr-actions.ts` (569).
- Money fields are uniformly `NUMERIC(14,2)` in SQL; `decimal.js` on the client where calculations exist.
- `SensitiveField` component is a textbook implementation of masked-with-reveal.
- `gst/einvoice-builder.ts` is a clean, well-tested pure function (15 vitest cases).
- Growatt MD5 self-test implementation in `inverter-poll/index.ts` is solid and testable.
- `proposal-share-actions.ts` uses 256-bit `crypto.getRandomValues` tokens — not brute-forceable.

---

*Review compiled 2026-05-24 by Claude Opus 4.7 from six parallel agent reviews
plus local CI / vitest runs. Raw agent reports preserved in the session
transcript.*
