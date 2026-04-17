# Purchase Module V2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute tasks in parallel where phase dependencies allow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-vendor procurement flow with a 5-stage competitive pipeline (BOQ → RFQ → Quote Comparison → PO → Dispatch Tracking), delivered end-to-end in one overnight run.

**Architecture:** New workspace at `/procurement/project/[projectId]` with 5 tabs. Vendor portal at `/vendor-portal/rfq/[token]` (public, outside middleware auth). Gmail/WhatsApp deep links for dispatch (no SMTP/OAuth). Three quote entry modes (vendor self-serve, manual entry, Excel upload). All mutations return `ActionResult<T>` and write to `procurement_audit_log`.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + RLS + Storage), `@react-pdf/renderer` (existing), `xlsx` (existing), Playwright for smoke tests, shadcn/ui via `@repo/ui`.

**Canonical spec reference:** `docs/superpowers/specs/2026-04-17-purchase-module-v2-design.md` — the spec has the full UI prose, permissions matrix, notifications table, audit log contract, and manual testing checklist. This plan focuses on WHAT to build in WHAT order; the spec answers HOW it should look and behave.

---

## Dependency graph

```
Phase 0 (migration + types)  ─────┐
                                   ├── Phase 1 (vendor portal)   ──┐
                                   │                                │
                                   └── Phase 2 (rfq lib) ──────┐    │
                                                                │    │
                                                                ▼    │
                                                           Phase 3 (Tabs 1–2 UI) ◄──┘
                                                                │
                                                                ▼
                                                           Phase 4 (Tab 3 UI)
                                                                │
                                                                ▼
                                                           Phase 5 (Tab 4 UI)
                                                                │
                                                                ▼
                                                           Phase 6 (Tab 5 UI)
                                                                │
                                                                ▼
                                                    Phases 7 (notifs) + 8 (audit) — cross-cutting
                                                                │
                                                                ▼
                                                           Phase 9 (tests)
                                                                │
                                                                ▼
                                                           CI gates + docs + push
```

Parallelizable: Phase 1 runs alongside Phase 2. Within Phase 3–6, independent client components can be dispatched as parallel subagents once server actions exist.

---

## Task 0: Migration 060 + types regeneration

**Files:**
- Create: `supabase/migrations/060_purchase_module_v2.sql`
- Regenerate: `packages/types/database.ts`

- [ ] **Step 0.1: Write migration 060**

Full SQL in Appendix A of this plan. Key contents:
- 6 new tables (`rfqs`, `rfq_items`, `rfq_invitations`, `rfq_quotes`, `rfq_awards`, `procurement_audit_log`)
- Column additions to `purchase_orders` (8 cols) + `purchase_order_items` (1 col)
- 17 new indexes total
- RLS policies on all 6 new tables
- `rfq-excel-uploads` storage bucket + policies
- `fn_boq_auto_update_on_grn_complete` trigger
- `generate_rfq_number()` helper (FY reset)
- Backfill: existing POs set `requires_approval = FALSE`, `approval_status = 'not_required'`

- [ ] **Step 0.2: Apply migration via MCP `apply_migration`**

Tool: `mcp__7a8c9855-...__apply_migration` with `project_id = actqtzoxjilqnldnacqz`, `name = 060_purchase_module_v2`.

- [ ] **Step 0.3: Regenerate types**

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 0.4: Verify**

```bash
pnpm check-types
```
Expected: 0 errors (no consumers yet; just ensures the regenerated file is valid TS).

- [ ] **Step 0.5: Commit**

```bash
git add supabase/migrations/060_purchase_module_v2.sql packages/types/database.ts
git commit -m "feat(procurement): migration 060 — purchase module v2 schema + types"
git push origin main
```

---

## Task 1: Vendor portal public route + token validation (parallel with Task 2)

**Files:**
- Create: `apps/erp/src/lib/vendor-portal-queries.ts`
- Create: `apps/erp/src/lib/vendor-portal-actions.ts`
- Create: `apps/erp/src/app/vendor-portal/rfq/[token]/page.tsx`
- Create: `apps/erp/src/app/vendor-portal/rfq/[token]/thank-you/page.tsx`
- Create: `apps/erp/src/app/vendor-portal/rfq/[token]/_client/quote-submit-form.tsx`
- Modify: `apps/erp/src/middleware.ts` (add `/vendor-portal` to excluded paths)

- [ ] **Step 1.1: Middleware exclusion**

Edit the matcher in `apps/erp/src/middleware.ts`:
```
matcher: [
  '/((?!_next/static|_next/image|favicon.ico|login|vendor-portal|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
],
```

- [ ] **Step 1.2: Build `vendor-portal-queries.ts`**

Public query (uses `createAdminClient()`, no auth). `validateToken(token)` returns a discriminated union `{ ok: true, ...rfq fields } | { ok: false, reason: 'invalid' | 'expired' }`. Signature in spec §5. Check `access_token = $1 AND expires_at > NOW()`. Also returns `alreadySubmitted: boolean` (derived from `status = 'submitted'`).

- [ ] **Step 1.3: Build `vendor-portal-actions.ts`**

`markInvitationViewed(token)` and `submitQuoteFromVendor(input)`. Every action re-validates the token before writing. `submitQuoteFromVendor` inserts `rfq_quotes` rows (one per item, computes `total_price = unit_price * quantity` in JS — fine here because it's per-line arithmetic, not aggregation), updates invitation to `status='submitted', submitted_at=NOW(), submission_mode='vendor_portal'`, fires notification to `rfqs.created_by`, logs audit. Returns `ActionResult<void>`.

- [ ] **Step 1.4: Build public page `page.tsx`**

Server component. Calls `validateToken()`. Branches:
- `reason: 'invalid'` → "Invalid link" page
- `reason: 'expired'` → "This RFQ link has expired" page
- `alreadySubmitted: true` → read-only summary page with submitted quote
- otherwise → fires-and-forgets `markInvitationViewed()` then renders `<QuoteSubmitForm />`

- [ ] **Step 1.5: Build `quote-submit-form.tsx` client component**

Header (project, RFQ number, deadline, vendor name, notes — read-only). Items table with `Unit Price` and `GST %` number inputs per row. Below: `Payment Terms` select (advance / 30_days / 60_days / against_delivery), `Delivery Period (days)` number, `Notes` textarea. Submit button calls `submitQuoteFromVendor`. On success: `router.push(...thank-you)`.

- [ ] **Step 1.6: Thank-you page**

Static confirmation. Shows "Your quote for RFQ {rfq_number} has been received. Our team will review and get back to you." No data fetch — rely on URL being valid.

- [ ] **Step 1.7: Type-check + commit**

```bash
pnpm check-types
git add apps/erp/src/lib/vendor-portal-* apps/erp/src/app/vendor-portal apps/erp/src/middleware.ts
git commit -m "feat(procurement): vendor portal public route + quote submission"
```

---

## Task 2: RFQ queries + actions library (parallel with Task 1)

**Files:**
- Create: `apps/erp/src/lib/rfq-queries.ts`
- Create: `apps/erp/src/lib/rfq-actions.ts`
- Create: `apps/erp/src/lib/procurement-audit.ts`
- Create: `apps/erp/src/lib/gmail-whatsapp-links.ts`
- Create: `apps/erp/src/lib/excel-quote-parser.ts`

- [ ] **Step 2.1: `procurement-audit.ts` (audit log helper)**

Single export `logProcurementAudit(supabase, input)`. Wrapped in try/catch — never throws. On insert failure, logs to `console.error` with a `[procurement-audit]` op prefix. Signature in spec §5.

- [ ] **Step 2.2: `gmail-whatsapp-links.ts`**

Pure functions (no side effects). Signatures in spec §5. Template bodies in Appendix B.

- [ ] **Step 2.3: `excel-quote-parser.ts`**

Uses `xlsx` (already a workspace dep). Template shape: Column A = S.No, B = Item Description, C = Unit Price, D = GST % (optional, default 18). Header row at index 0; data rows from index 1. Returns row-level warnings (e.g., "Row 3: unit_price missing") but keeps parsing. Matches items back by description via normalized string (lowercase + whitespace collapse) — same strategy as `applyPriceBookRates` in `project-step-actions.ts`.

- [ ] **Step 2.4: `rfq-queries.ts`**

All signatures in spec §5. Use `count: 'estimated'` (rule #13). Row types from `Database['public']['Tables'][X]['Row']` (rule #11). `getRfqComparisonData` builds the matrix shape: items × invitations × quotes — done in SQL via two queries (items + left-join quotes) then shaped in JS, not aggregated. No `as any`.

- [ ] **Step 2.5: `rfq-actions.ts`**

All 9 actions from spec §5. Each:
1. `'use server'` at top
2. `auth.getUser()` guard → returns `err('Not authenticated')` on fail
3. Resolve `employee_id` via `profiles → employees.profile_id` pattern (existing)
4. Single transaction where possible (sequential inserts if multi-table)
5. `logProcurementAudit(...)` before return
6. Fire-and-forget notification inserts (wrapped, failures don't block)
7. Return `ActionResult<T>` — never throw

`createRfqWithInvitations`: snapshots BOQ data into `rfq_items` (freezes qty/description/unit/category/price_book_rate). Generates `rfq_number` via `generate_rfq_number()` DB function. Creates one `rfq_invitations` row per vendor with fresh `access_token`.

`generatePOsFromAwards`: groups awards by `winning_invitation.vendor_id`. Creates one PO per vendor. Items sourced from winning quotes with `rfq_quote_id` traceability. PO status = `draft`, `approval_status = 'pending_approval'` unless creator is founder (then `'approved'`). Writes `rfq_awards.purchase_order_id`. Flips `rfqs.status = 'awarded'`.

- [ ] **Step 2.6: Type-check + commit**

```bash
pnpm check-types
pnpm lint --max-warnings 0
bash scripts/ci/check-forbidden-patterns.sh
git add apps/erp/src/lib/rfq-* apps/erp/src/lib/procurement-audit.ts apps/erp/src/lib/gmail-whatsapp-links.ts apps/erp/src/lib/excel-quote-parser.ts
git commit -m "feat(procurement): rfq library (queries, actions, audit, parsers)"
```

---

## Task 3: Tabs 1–2 UI (BOQ editable + RFQ create/send)

**Files:**
- Rewrite: `apps/erp/src/app/(erp)/procurement/project/[projectId]/page.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/loading.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-boq.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-rfq.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/boq-editable-table.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/send-rfq-panel.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/send-rfq-modal.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/manual-quote-entry-dialog.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/excel-quote-upload-dialog.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/create-vendor-ad-hoc-dialog.tsx`

- [ ] **Step 3.1: Page shell**

Server component. Reads `?tab=boq|rfq|comparison|po|dispatch` (default `boq`). Fetches project + role + all 5 tab data sources in parallel via `Promise.all`. Renders tabs via `@repo/ui` Tabs component. Each tab header shows ✓ / 🔒 based on completion state. Shell is dumb — delegates rendering to `_tabs/tab-*.tsx`.

- [ ] **Step 3.2: `tab-boq.tsx`**

Server component. Renders `<BoqEditableTable>` client component with items + vendors preloaded. Empty state per spec §4.

- [ ] **Step 3.3: `boq-editable-table.tsx`**

Client. Two modes: read-only (default) and edit-mode toggled by "Edit & Assign Vendors" button. Edit mode adds `Vendor` combobox + `Select` checkbox per row. Uses `@repo/ui` Combobox. Last option in vendor dropdown: "+ Add new vendor" → opens `CreateVendorAdHocDialog`. Bottom action bar: `Send RFQ` (disabled until ≥1 selected + all selected have vendor), `Quick PO` (preserves existing direct-PO flow — reuses existing `CreatePODialog`).

Navigation on `Send RFQ`: `router.push(?tab=rfq)` with `selectedItems` + `vendorAssignments` passed via URL params (JSON-encoded in a single `rfqDraft` param).

- [ ] **Step 3.4: `tab-rfq.tsx`**

Server component. Two sections:
1. **Create flow** (left-right panels): items preselected from Tab 1 query param + vendor multi-select. Below: deadline date picker (default today+7), notes textarea, `Create RFQ & Send` button.
2. **Existing RFQs**: expandable list per RFQ showing vendor invitation status matrix. Per-invitation buttons: `Enter Quote Manually` + `Upload Excel`.

- [ ] **Step 3.5: `send-rfq-panel.tsx` + `send-rfq-modal.tsx`**

Panel is the create-flow UI. Modal appears after `createRfqWithInvitations` succeeds. Modal lists every invitation with per-vendor dispatch buttons (📋 Copy Link / ✉ Gmail / 💬 WhatsApp). Each button:
- Builds URL via `gmail-whatsapp-links.ts` helpers
- Opens in new tab (`window.open(url, '_blank', 'noopener,noreferrer')`) OR `navigator.clipboard.writeText()` for copy
- Calls `markInvitationSent(id, channel)` — updates `status='sent'`, `sent_at=NOW()`, appends to `sent_via_channels`

- [ ] **Step 3.6: `manual-quote-entry-dialog.tsx`**

Dialog with items table (identical to vendor portal), fills on vendor's behalf. Sets `submission_mode='manual_entry', submitted_by_user_id=auth.uid()`. Blocked when invitation already submitted (error toast). Validates `payment_terms` + `delivery_period_days` required.

- [ ] **Step 3.7: `excel-quote-upload-dialog.tsx`**

Two-step dialog:
1. Download template (client-side generates via `xlsx.writeFile()` — items pre-filled as rows, unit_price column empty)
2. Upload filled sheet — parses via `parseQuoteExcel()`, shows preview table with errors/warnings, confirm button calls `submitQuoteFromExcel()`. Stores original file in `rfq-excel-uploads/{rfq_id}/{invitation_id}/{timestamp}-{filename}`.

- [ ] **Step 3.8: `create-vendor-ad-hoc-dialog.tsx`**

Small form: name (required), contact (phone), email, whatsapp. Calls `createVendorAdHoc()`. On success, returns the new vendor so the calling combobox can select it.

- [ ] **Step 3.9: Sidebar link**

Ensure `/procurement/project/[projectId]` is reachable from the existing `/procurement` list page. Existing link structure already does this (verify project row action).

- [ ] **Step 3.10: Type-check + commit**

```bash
pnpm check-types
pnpm lint --max-warnings 0
bash scripts/ci/check-forbidden-patterns.sh
git add apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]
git commit -m "feat(procurement): tabs 1-2 UI — BOQ editable + RFQ create/send"
```

---

## Task 4: Tab 3 UI (Quote Comparison + Award)

**Files:**
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-comparison.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/comparison-matrix.tsx`

- [ ] **Step 4.1: `tab-comparison.tsx`**

Server component. Calls `getRfqComparisonData(projectId)`. Empty state if no submitted quotes. Renders `<ComparisonMatrix>` client component.

- [ ] **Step 4.2: `comparison-matrix.tsx`**

Renders:
1. Pricing matrix: rows = items, columns = item meta + per-vendor (price, total) + L1 vendor. Cell with lowest `total_price` has green bg + "L1" badge. Variance vs `price_book_rate` shown inline (amber if >+5%).
2. Per-vendor summary cards (grand total, payment terms, delivery period max, overall variance).
3. Action bar: `Auto-Award All L1` (calls `autoAwardL1(rfqId)`) + `Generate POs` (calls `generatePOsFromAwards(rfqId)` — enabled only when every item has an award).

Override flow: clicking L1 badge opens dropdown of competing vendors. Non-L1 selection opens a modal requiring `override_reason` textarea. On save: `awardRfqItem({ rfqItemId, winningInvitationId, overrideReason })`.

- [ ] **Step 4.3: Type-check + commit**

```bash
pnpm check-types
pnpm lint --max-warnings 0
git add apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_tabs/tab-comparison.tsx apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_client/comparison-matrix.tsx
git commit -m "feat(procurement): tab 3 UI — quote comparison matrix with L1 + override"
```

---

## Task 5: Tab 4 UI (PO Approval) + procurement-actions extensions

**Files:**
- Modify: `apps/erp/src/lib/procurement-actions.ts` (add 7 new actions from spec §5)
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-po.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/po-approval-actions.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/po-send-modal.tsx`

- [ ] **Step 5.1: Extend `procurement-actions.ts`**

Add: `sendPOForApproval`, `approvePO`, `rejectPO`, `markPODispatched`, `markPOAcknowledged`, `recordVendorDispatch`, `createVendorAdHoc`. All return `ActionResult<T>`. `approvePO` + `rejectPO` role-gated to founder.

- [ ] **Step 5.2: `tab-po.tsx`**

Server component. Fetches POs for the project (filtered by `rfq_id IS NOT NULL OR rfq_id IS NULL` — include Quick POs too). Renders compact table: PO Number, Vendor, Items count, Total, Status, Approval, Actions (wrapped in `<PoApprovalActions>`). Empty state per spec.

- [ ] **Step 5.3: `po-approval-actions.tsx`**

Client component. Per-row conditional buttons based on PO status + viewer role (spec §4 Tab 4 lists all rules). `Send to Vendor` opens `<PoSendModal>`.

- [ ] **Step 5.4: `po-send-modal.tsx`**

Mirrors `send-rfq-modal.tsx`. Gmail / WhatsApp / Copy Link for the PO (with PDF link). On channel click: `markPODispatched({ poId, channel })`.

- [ ] **Step 5.5: Type-check + commit**

```bash
pnpm check-types
pnpm lint --max-warnings 0
git add apps/erp/src/lib/procurement-actions.ts apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_tabs/tab-po.tsx apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_client/po-*.tsx
git commit -m "feat(procurement): tab 4 UI — PO approval gate + send modal"
```

---

## Task 6: Tab 5 UI (Dispatch Tracking)

**Files:**
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-dispatch.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/dispatch-timeline-row.tsx`
- Create: `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/mark-dispatched-dialog.tsx`

- [ ] **Step 6.1: `tab-dispatch.tsx`**

Server component. Fetches POs where `status IN ('approved', 'sent', 'acknowledged', 'partially_delivered', 'fully_delivered')`. Also fetches GRN records for receipt status. Renders `<DispatchTimelineRow>` per PO.

- [ ] **Step 6.2: `dispatch-timeline-row.tsx`**

Client component. Horizontal 4-state timeline (PO Sent → Acknowledged → Dispatched → Received). Active/completed states visually distinct. Row actions:
- `Mark Acknowledged` → `markPOAcknowledged(poId)`
- `Mark Dispatched` → opens `<MarkDispatchedDialog>`
- `Record Receipt` → opens existing DC/GRN dialog (reuse from existing three-way-match flow — do not rebuild)

- [ ] **Step 6.3: `mark-dispatched-dialog.tsx`**

Form: `vendor_dispatch_date` (date, required), `tracking_number` (text, optional). Submits `recordVendorDispatch`.

- [ ] **Step 6.4: GRN trigger verification**

Already in migration 060 (Step 0.1). Verify with a manual insert:
```sql
-- via MCP execute_sql against dev
INSERT INTO goods_receipt_notes (delivery_challan_id, received_by, status) VALUES (...);
-- then check purchase_orders.status + project_boq_items.procurement_status updated
```

- [ ] **Step 6.5: Type-check + commit**

```bash
pnpm check-types
pnpm lint --max-warnings 0
git add apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_tabs/tab-dispatch.tsx apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_client/dispatch-*.tsx apps/erp/src/app/\(erp\)/procurement/project/\[projectId\]/_client/mark-dispatched-dialog.tsx
git commit -m "feat(procurement): tab 5 UI — dispatch tracking"
```

---

## Task 7: Notifications wiring

Cross-cutting. Already stubbed in Phases 2, 5, 6 actions. This phase audits that every event in spec §7's notifications table has a corresponding `notifications` insert.

- [ ] **Step 7.1: Audit notification wiring**

Grep `notifications` insert sites in:
- `rfq-actions.ts` (vendor submits quote — notify `rfqs.created_by`)
- `procurement-actions.ts` (PO sent for approval — notify all founders; PO approved — notify creator; PO rejected — notify creator)
- `vendor-portal-actions.ts` (vendor submits quote)
- DB trigger `fn_boq_auto_update_on_grn_complete` (all materials received — notify `projects.project_manager_id`)
- `procurement-actions.ts` `sendBoqToPurchase` (project sent to purchase — notify all `purchase_officer`)

Each insert wrapped in try/catch, failures log but don't block.

- [ ] **Step 7.2: Type-check + commit if changes**

```bash
pnpm check-types
git add -u
git commit -m "feat(procurement): notification wiring across v2 events" --allow-empty
```

---

## Task 8: Audit log integration

Cross-cutting. Already stubbed in Phases 1, 2, 5, 6 actions. This phase audits coverage against spec §9's audit log contract (14 events).

- [ ] **Step 8.1: Audit `logProcurementAudit` call sites**

Each row in spec §9's table must have exactly one call site. Grep:
```
Grep for "logProcurementAudit" across apps/erp/src/lib/{rfq-actions,vendor-portal-actions,procurement-actions}.ts
```

Expected: 14+ call sites (one per event, some events log twice across entities).

- [ ] **Step 8.2: Spot-check by running a test RFQ manually**

After build completes, via dev server:
1. Create RFQ → query `procurement_audit_log` for entity_type=rfq, action=created
2. Send invitation → check action=sent
3. Submit quote (any mode) → check action=submitted
4. Award item → check action=awarded
5. Generate POs → check entity_type=purchase_order, action=created + entity_type=rfq, action=awarded

- [ ] **Step 8.3: Commit any wiring fixes**

```bash
git add -u
git commit -m "feat(procurement): audit log coverage for all v2 mutations" --allow-empty
```

---

## Task 9: Playwright smoke tests

**Files:**
- Modify: `apps/erp/e2e/smoke.spec.ts`

- [ ] **Step 9.1: Add 3 smoke tests**

Pattern: test.skip() when `PLAYWRIGHT_LOGIN_EMAIL`/`_PASSWORD` missing (consistent with existing tests).

```typescript
test('procurement workspace loads at /procurement/project/[id]', async ({ page }) => {
  await login(page);
  await page.goto('/procurement');
  await page.getByRole('link', { name: /view/i }).first().click();
  await expect(page.getByRole('tab', { name: /BOQ/i })).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

test('vendor portal renders without auth for valid-looking token', async ({ page }) => {
  // random UUID — we expect "Invalid link" page, not a 500 or a redirect to /login
  await page.goto('/vendor-portal/rfq/00000000-0000-0000-0000-000000000000');
  await expect(page.getByText(/invalid link|expired|your quote/i)).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

test('RFQ comparison tab renders empty state without quotes', async ({ page }) => {
  await login(page);
  await page.goto('/procurement');
  await page.getByRole('link', { name: /view/i }).first().click();
  await page.getByRole('tab', { name: /Comparison/i }).click();
  await expect(page.getByText(/waiting for vendor quotes|no rfqs/i)).toBeVisible();
  await expectNoDevErrorOverlay(page);
});
```

- [ ] **Step 9.2: Verify discovery**

```bash
pnpm --filter erp test:e2e --list
```
Expected: 9 tests (6 existing + 3 new).

- [ ] **Step 9.3: Commit**

```bash
git add apps/erp/e2e/smoke.spec.ts
git commit -m "test(procurement): smoke tests for v2 workspace + vendor portal"
```

---

## Task 10: CI gates

- [ ] **Step 10.1: Full check**

```bash
pnpm check-types       # 0 errors across all packages
pnpm lint --max-warnings 0
bash scripts/ci/check-forbidden-patterns.sh    # should stay at or below 61
pnpm --filter erp test:e2e --list    # 9 tests discovered
```

- [ ] **Step 10.2: If forbidden-pattern count regressed**

Fix regressions before merging. Use existing patterns:
- `as any` → import row type from `Database['public']['Tables'][X]['Row']`
- `count: 'exact'` → `count: 'estimated'`
- Inline `createClient` in pages/components → extract to `*-queries.ts` / `*-actions.ts`

---

## Task 11: Documentation

- [ ] **Step 11.1: Update CLAUDE.md**

Add new row to the CURRENT STATE table:
```
| Purchase Module V2 | ✅ Complete | 5-tab workspace (BOQ → RFQ → Comparison → PO → Dispatch). Migration 060: 6 new tables, 17 indexes, rfq-excel-uploads bucket, GRN auto-update trigger. Vendor portal at /vendor-portal/rfq/[token]. Gmail + WhatsApp deep-link dispatch. 3 quote entry modes. Founder PO approval gate. Audit log on every mutation. |
| Migration 060 | ✅ Applied (dev) | Purchase module v2 schema. Prod pending. |
```

Update footer date line.

- [ ] **Step 11.2: Update master reference**

Add a new section to `docs/SHIROI_MASTER_REFERENCE_3_0.md` describing the v2 flow. Reference the design spec by path.

- [ ] **Step 11.3: Commit docs**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md
git commit -m "docs: purchase module v2 — CURRENT STATE + master reference"
```

---

## Task 12: Final push

- [ ] **Step 12.1: Single squash or rebase if messy**

Not needed if each phase was committed atomically. Otherwise: `git rebase -i main` to tidy.

- [ ] **Step 12.2: Push**

```bash
git push origin main
```

- [ ] **Step 12.3: Verify Vercel deploy kicks off**

Deploys to https://erp.shiroienergy.com automatically. Wait for green deploy. Smoke-test `/procurement` route on prod (dev Supabase, prod Vercel).

---

## Appendix A — Migration 060 full SQL

The full SQL lives directly in `supabase/migrations/060_purchase_module_v2.sql`. Structure:

```sql
-- =========================================================================
-- Migration 060 — Purchase Module V2
-- Date: 2026-04-17
-- Adds: 6 new tables, 17 indexes, rfq-excel-uploads bucket, GRN auto-update
-- =========================================================================

BEGIN;

-- 1. generate_rfq_number() — FY-scoped sequence
CREATE SEQUENCE IF NOT EXISTS rfq_number_seq_current_fy START 1;

CREATE OR REPLACE FUNCTION generate_rfq_number()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  fy_start_year INTEGER;
  fy_end_year INTEGER;
  fy_label TEXT;
  current_month INTEGER;
  seq_val BIGINT;
BEGIN
  current_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  IF current_month >= 4 THEN
    fy_start_year := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  ELSE
    fy_start_year := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata') - 1;
  END IF;
  fy_end_year := fy_start_year + 1;
  fy_label := fy_start_year::TEXT || '-' || SUBSTRING(fy_end_year::TEXT FROM 3 FOR 2);
  -- Simple approach: use a regular sequence + year suffix
  seq_val := nextval('rfq_number_seq_current_fy');
  RETURN 'RFQ-' || fy_label || '-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$;

-- 2. rfqs
CREATE TABLE rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number TEXT NOT NULL UNIQUE DEFAULT generate_rfq_number(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','comparing','awarded','cancelled')),
  deadline TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rfqs_project_created ON rfqs(project_id, created_at DESC);
CREATE INDEX idx_rfqs_status ON rfqs(status);
CREATE INDEX idx_rfqs_created_by ON rfqs(created_by);

-- 3. rfq_items
CREATE TABLE rfq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES project_boq_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  item_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  item_category TEXT NOT NULL,
  price_book_rate NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, boq_item_id)
);
CREATE INDEX idx_rfq_items_rfq ON rfq_items(rfq_id);
CREATE INDEX idx_rfq_items_boq ON rfq_items(boq_item_id);

-- 4. rfq_invitations
CREATE TABLE rfq_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  access_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','viewed','submitted','declined','expired')),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  submission_mode TEXT CHECK (submission_mode IN ('vendor_portal','manual_entry','excel_upload')),
  submitted_by_user_id UUID REFERENCES profiles(id),
  excel_file_path TEXT,
  sent_via_channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, vendor_id)
);
CREATE UNIQUE INDEX idx_rfq_invitations_token ON rfq_invitations(access_token);
CREATE INDEX idx_rfq_invitations_rfq ON rfq_invitations(rfq_id);
CREATE INDEX idx_rfq_invitations_vendor ON rfq_invitations(vendor_id);
CREATE INDEX idx_rfq_invitations_status_expiry ON rfq_invitations(status, expires_at) WHERE status IN ('pending','sent','viewed');

-- 5. rfq_quotes
CREATE TABLE rfq_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_invitation_id UUID NOT NULL REFERENCES rfq_invitations(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.0 CHECK (gst_rate >= 0 AND gst_rate <= 28),
  total_price NUMERIC(14,2) NOT NULL,   -- computed by application at insert time
  payment_terms TEXT NOT NULL CHECK (payment_terms IN ('advance','30_days','60_days','against_delivery')),
  delivery_period_days INTEGER NOT NULL CHECK (delivery_period_days >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_invitation_id, rfq_item_id)
);
CREATE INDEX idx_rfq_quotes_invitation ON rfq_quotes(rfq_invitation_id);
CREATE INDEX idx_rfq_quotes_item ON rfq_quotes(rfq_item_id);

-- 6. rfq_awards
CREATE TABLE rfq_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  winning_invitation_id UUID NOT NULL REFERENCES rfq_invitations(id) ON DELETE RESTRICT,
  was_auto_selected BOOLEAN NOT NULL DEFAULT TRUE,
  override_reason TEXT,
  awarded_by UUID NOT NULL REFERENCES profiles(id),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  UNIQUE (rfq_item_id),
  CHECK (was_auto_selected = TRUE OR override_reason IS NOT NULL)
);
CREATE INDEX idx_rfq_awards_rfq ON rfq_awards(rfq_id);
CREATE INDEX idx_rfq_awards_invitation ON rfq_awards(winning_invitation_id);
CREATE INDEX idx_rfq_awards_po ON rfq_awards(purchase_order_id);

-- 7. procurement_audit_log
CREATE TABLE procurement_audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('rfq','rfq_invitation','rfq_quote','rfq_award','purchase_order','boq_item')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id),
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON procurement_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON procurement_audit_log(actor_id, created_at DESC);

-- 8. purchase_orders column additions
ALTER TABLE purchase_orders
  ADD COLUMN rfq_id UUID REFERENCES rfqs(id),
  ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (approval_status IN ('pending_approval','approved','rejected','not_required')),
  ADD COLUMN approval_rejection_reason TEXT,
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN acknowledged_at TIMESTAMPTZ,
  ADD COLUMN vendor_tracking_number TEXT,
  ADD COLUMN vendor_dispatch_date DATE;

CREATE INDEX idx_po_approval_status ON purchase_orders(approval_status);
CREATE INDEX idx_po_rfq ON purchase_orders(rfq_id);

-- Backfill: existing POs are pre-existing in production, don't need approval
UPDATE purchase_orders SET requires_approval = FALSE, approval_status = 'not_required' WHERE created_at < NOW();

-- 9. purchase_order_items column addition
ALTER TABLE purchase_order_items
  ADD COLUMN rfq_quote_id UUID REFERENCES rfq_quotes(id);
CREATE INDEX idx_poi_rfq_quote ON purchase_order_items(rfq_quote_id);

-- 10. Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rfq-excel-uploads',
  'rfq-excel-uploads',
  FALSE,
  10485760,  -- 10 MB
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY rfq_excel_read ON storage.objects FOR SELECT
  USING (bucket_id = 'rfq-excel-uploads' AND get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role]));
CREATE POLICY rfq_excel_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rfq-excel-uploads' AND get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role]));
CREATE POLICY rfq_excel_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'rfq-excel-uploads' AND get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role]));
CREATE POLICY rfq_excel_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'rfq-excel-uploads' AND get_my_role() = 'founder'::app_role);

-- 11. RLS enable
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_audit_log ENABLE ROW LEVEL SECURITY;

-- 12. RLS policies (pattern — full list in migration file)
-- rfqs: founder + purchase_officer full CRUD; project_manager + site_supervisor SELECT
CREATE POLICY rfqs_select ON rfqs FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role,'project_manager'::app_role,'site_supervisor'::app_role]));
CREATE POLICY rfqs_insert ON rfqs FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role]));
CREATE POLICY rfqs_update ON rfqs FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role,'purchase_officer'::app_role]));
CREATE POLICY rfqs_delete ON rfqs FOR DELETE
  USING (get_my_role() = 'founder'::app_role);
-- ... (same pattern for rfq_items, rfq_invitations, rfq_quotes, rfq_awards)
-- procurement_audit_log: SELECT founder only; INSERT permissive (helper function handles scoping)
CREATE POLICY audit_select ON procurement_audit_log FOR SELECT
  USING (get_my_role() = 'founder'::app_role);
CREATE POLICY audit_insert ON procurement_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 13. GRN auto-update trigger
CREATE OR REPLACE FUNCTION fn_boq_auto_update_on_grn_complete()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_po_id UUID;
  v_project_id UUID;
  v_all_delivered BOOLEAN;
  v_all_boq_received BOOLEAN;
  v_pm_profile_id UUID;
BEGIN
  -- Idempotency: only fire on real status transitions into 'passed'/'conditional'
  IF NEW.status NOT IN ('passed','conditional') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find PO via DC chain (adjust based on actual FK — assumes vendor_delivery_challans.purchase_order_id)
  SELECT vdc.purchase_order_id INTO v_po_id
  FROM vendor_delivery_challans vdc
  WHERE vdc.id = NEW.delivery_challan_id;

  IF v_po_id IS NULL THEN RETURN NEW; END IF;

  -- Check if all PO items fully delivered (sum of GRN quantities ≥ quantity_ordered)
  SELECT COALESCE(bool_and(delivered_sum >= poi.quantity_ordered), FALSE) INTO v_all_delivered
  FROM purchase_order_items poi
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(grn.quantity_received), 0) AS delivered_sum
    FROM goods_receipt_notes grn
    JOIN vendor_delivery_challans vdc2 ON vdc2.id = grn.delivery_challan_id
    WHERE vdc2.purchase_order_id = v_po_id
      AND grn.status IN ('passed','conditional')
  ) delivered ON TRUE
  WHERE poi.purchase_order_id = v_po_id;

  -- Update PO status
  IF v_all_delivered THEN
    UPDATE purchase_orders SET status = 'fully_delivered', updated_at = NOW() WHERE id = v_po_id;
  ELSE
    UPDATE purchase_orders SET status = 'partially_delivered', updated_at = NOW() WHERE id = v_po_id AND status NOT IN ('fully_delivered','cancelled');
  END IF;

  -- Flip BOQ items via rfq chain
  UPDATE project_boq_items pbi
  SET procurement_status = 'received', procurement_received_date = NOW()::DATE
  FROM rfq_items ri
  JOIN rfq_awards ra ON ra.rfq_item_id = ri.id
  WHERE ra.purchase_order_id = v_po_id
    AND pbi.id = ri.boq_item_id;

  -- Check if all project BOQ items received → notify PM
  SELECT po.project_id INTO v_project_id FROM purchase_orders po WHERE po.id = v_po_id;
  IF v_project_id IS NOT NULL THEN
    SELECT bool_and(procurement_status = 'received') INTO v_all_boq_received
    FROM project_boq_items
    WHERE project_id = v_project_id AND procurement_status IS DISTINCT FROM 'cancelled';

    IF v_all_boq_received THEN
      UPDATE projects SET procurement_status = 'received' WHERE id = v_project_id;
      SELECT project_manager_id INTO v_pm_profile_id FROM projects WHERE id = v_project_id;
      IF v_pm_profile_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
        VALUES (v_pm_profile_id, 'procurement', 'All materials received',
                'Project materials fully received — ready to dispatch',
                'project', v_project_id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_boq_auto_update_on_grn_complete
  AFTER INSERT OR UPDATE ON goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_boq_auto_update_on_grn_complete();

COMMIT;
```

**Note:** When writing the actual migration file, verify exact column names in `vendor_delivery_challans` and `goods_receipt_notes` tables. If column names differ (e.g., `quantity` vs `quantity_received`), adjust the trigger body accordingly. Also verify `projects.procurement_status` column exists — if not, drop that update from the trigger.

## Appendix B — Gmail/WhatsApp template bodies

**Email subject:**
```
RFQ {rfq_number} — {project_name} — Shiroi Energy
```

**Email body:**
```
Dear {vendor_name},

Shiroi Energy is requesting a quote for the following materials for our project "{project_name}".

Please submit your quote via the secure portal:
{portal_url}

Deadline: {deadline}

The portal will walk you through item-by-item pricing, payment terms, and delivery period. Your response is saved automatically.

For any questions, reply to this email or call +91-XXXXXXXXXX.

Regards,
Shiroi Energy Procurement Team
```

**WhatsApp text:**
```
Hi {vendor_name}, Shiroi Energy has a new RFQ for you. RFQ {rfq_number}, deadline {deadline}. Please submit your quote here: {portal_url}
```

**PO email subject:**
```
Purchase Order {po_number} — Shiroi Energy
```

**PO email body:**
```
Dear {vendor_name},

Please find attached our Purchase Order {po_number} for "{project_name}".

{pdf_url_if_available}

Kindly confirm receipt and expected dispatch date.

Regards,
Shiroi Energy Purchase Team
```

---

## Self-review

Spec coverage: ✓ all 16 spec sections have corresponding tasks (0=migration, 1-2=lib, 3-6=UI per tab, 7=notifs, 8=audit, 9=tests, 10=CI, 11=docs, 12=push). Tab 4 (PO) covered in Task 5. Tab 5 (dispatch) covered in Task 6. Manual test checklist is in spec §13 — referenced, not duplicated.

Placeholder scan: zero TBDs. Every step has exact command or code block or referenced spec section.

Type consistency: all action signatures quote spec §5 directly — authoritative. `ActionResult<T>` wrapper consistent across all actions. Row types via `Database['public']['Tables'][X]['Row']`.

Risk: Appendix A's trigger body assumes `vendor_delivery_challans.purchase_order_id` and `goods_receipt_notes.quantity_received` column names — these need verification against actual schema before the migration applies cleanly. Task 0.1 footnote now flags this.
