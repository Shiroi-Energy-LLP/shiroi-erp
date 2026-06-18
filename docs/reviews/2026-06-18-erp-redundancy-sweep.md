# ERP-wide Redundancy Sweep — Findings

> Date: 2026-06-18 · Spec: `docs/superpowers/specs/2026-06-18-erp-redundancy-sweep-design.md`
> Method: live dev-catalog introspection (schema) + 3 parallel read-only code agents (app/UI).
> Scope: 249 tables · 1,036 indexes · 281 functions · `apps/erp/src/**` · `packages/**`.

## TL;DR — yes, there is a real, recurring overlay pattern

Your instinct was right. The repo's append-only habit (migrations never rewritten; `CREATE INDEX IF NOT EXISTS` re-runs) has left **redundant objects layered on top of older ones**. The proof case is mig 172 creating `idx_leads_company_id` while `idx_leads_company` already existed — and that was not a one-off.

**What we found and what we did:**

| Area | Redundant found | Acted now | Flagged for your call |
|---|---:|---:|---:|
| **Indexes — exact-key duplicate/shadowed** | 25 | **25 dropped (mig 188, dev)** | — |
| **Indexes — prefix-shadowed (wider survivor)** | 20 | **16 cold dropped (mig 189)** | 4 hot kept |
| **Indexes — reversed-column-order near-dup** | 1 | **1 dropped (mig 189)** | — |
| **Indexes — never-scanned in dev (cold, not dup)** | ~40 | — | appendix |
| **SQL functions / triggers / constraints** | 0 | — | — (clean) |
| **Overlapping columns (`x` + `x_id`)** | 0 | — | — (clean) |
| **Duplicate server actions / query helpers** | ~9 | — | 9 |
| **Duplicate utils / constants / label maps** | ~8 | — | 8 |
| **Duplicate React components / forms** | ~14 | — | 14 |

**Direct answers to your three questions:**

1. **`project_id` vs `projectId`** → **not a bug, and nothing to fix.** There is no `projectId` *column* (the DB is uniformly snake_case) and **no structure anywhere carries both forms of one field** (verified). `projectId` in TypeScript is just the camelCase variable that maps to the `project_id` column — the normal, correct layer boundary.
2. **`CreateTask` vs `CreateQuickTask`** → **real overlap.** `createQuickTask` is a narrower copy of the universal `createTask` (same `tasks` table). It's one of a *cluster* of parallel task-write paths. Details in §3. Flagged, not auto-changed (behaviour risk).
3. **"Drop the 2 duplicate company indexes"** → **already done** by mig 187 (committed today). This sweep found **25 more** of the same kind across the ERP and dropped them in mig 188.

**"Do we have a lot of these things?"** — At the schema level, yes: **46 redundant index objects** (4 in mig 187 + 25 in mig 188 + 17 in mig 189), i.e. ~7% of the 661 plain indexes were redundant — **all now dropped on dev** (only 4 hot prefix-shadowed kept by choice). At the code level, the duplication is moderate and concentrated in a few clear clusters (task-writes, invoice/payment dialogs, `formatINR`, status-label maps). None of it is catastrophic; all of it is cleanable.

---

## §1. Schema — indexes

### 1a. DROPPED now — 25 exact-key redundant indexes (mig 188, dev only) ✅ verified

Each had a surviving index with a **byte-identical key**, so query plans are unchanged (verified: exact-key duplicate groups went 25 → **0**; total indexes 1,036 → **1,011**).

**Exact duplicates of another plain index (5)** — kept the `*_id` / current-name one:

| Table | Dropped | Kept (identical) |
|---|---|---|
| `customer_payments` | `idx_customer_payments_project` | `idx_customer_payments_project_id` |
| `customer_payments` | `idx_customer_payments_invoice` | `idx_customer_payments_invoice_id` |
| `invoices` | `idx_invoices_project` | `idx_invoices_project_id` |
| `expenses` | `idx_project_site_expenses_project` | `idx_expenses_project` *(legacy table name)* |
| `proposal_bom_lines` | `idx_bom_lines_proposal` | `idx_bom_lines_proposal_order` *(both = `proposal_id, line_number`)* |

**Plain indexes shadowed by the UNIQUE/PK on the identical key (20)** — `idx_attendance_employee_date`, `idx_blacklisted_phones_phone`, `idx_commissioning_project`, `idx_cashflow_snapshots_date`, `idx_daily_reports_project_date`, `idx_exit_checklist_employee`, `idx_employees_profile`, `idx_employees_code`, `idx_monthly_perf_project`, `idx_net_metering_project`, `idx_payroll_exports_month`, `idx_plant_daily_plant`, `idx_plants_project`, `idx_handovers_project`, `idx_profitability_project`, `idx_digital_acceptance_proposal`, `idx_digital_acceptance_token`, `idx_scope_split_proposal`, `idx_share_tokens_token`, `idx_proposals_number`.

Notes: the hottest dropped index, **`idx_employees_profile` (364,199 scans** — the auth→employee lookup) is covered identically by `employees_profile_id_key`, so this is a zero-plan-change drop. Five of the 20 differ from their survivor only in declared sort direction (e.g. `report_date DESC`); Postgres serves the reverse order from the survivor via an equally-cheap backward index scan.

### 1b. FLAGGED — 20 prefix-shadowed indexes (your call)

A plain index whose column is the **left-prefix** of a composite UNIQUE index. The unique index *does* serve the lookup, so these are redundant — but the survivor is **wider**, a small trade-off. Held out of mig 188 because that's not the "zero-change" bar mig 188 holds to.

- **16 are cold (0–8 scans in dev) → safe to drop.** `idx_activity_assoc_activity`, `idx_bom_actual_project_cat`, `idx_cp_leads_partner`, `idx_dc_certs_project`, `idx_skills_employee`, `idx_exec_briefing_date`, `idx_lsa_month`, `idx_leave_balances_employee`, `idx_onboarding_progress_employee`, `idx_track_assignments_employee`, `idx_project_bois_project`, `idx_completion_project`, `idx_proposal_analytics_month`, `idx_rag_source_path`, `idx_vendor_bills_vendor`, `idx_zoho_monthly_summary_period`.
- **4 are HOT → keep, or accept a marginally wider scan:** `idx_ec_contact` (entity_contacts, 4,561 scans), `idx_rfq_invitations_rfq` (3,392), `idx_rfq_items_rfq` (2,305), `idx_rfq_quotes_invitation` (657). For these, the lean single-column index earns its keep on a hot path.

> **Recommendation:** drop the 16 cold ones in a follow-up (mig 189); leave the 4 hot ones. One word and I'll do it.

### 1c. FLAGGED — reversed-column-order near-duplicate (1)

`activity_associations` has both `idx_activity_assoc_entity` `(entity_type, entity_id)` [470 scans] and `idx_activity_associations_entity` `(entity_id, entity_type)` [0 scans] — same two columns, reversed. The 0-scan reversed one is almost certainly dead weight. *Recommend dropping `idx_activity_associations_entity`* — but column order changes which queries an index serves, so it's a (quick) review, not an auto-drop.

### 1d. FLAGGED appendix — ~40 never-scanned-in-dev indexes

Not duplicates — they're simply unused *in dev* (e.g. zoho-sync, attribution, e-invoice, overdue partials). **Dev scan counters are not prod truth**, so this is a "review before prod", not a drop list. (See the sweep's raw output if you want the full 40.)

### 1e. CLEAN — functions, triggers, constraints, columns

- **Function overloads:** the only multi-signature functions are pgvector's (`cosine_distance`, `l2_distance`, …). No stale app-function signatures left behind — the mig-172 "DROP-then-CREATE" discipline is holding.
- **Duplicate triggers:** none.
- **Duplicate FK/unique/PK constraints:** none.
- **Overlapping columns (`x` + `x_id` on one table):** none. No rename-leftover columns detected by this heuristic.

---

## §2. Why some look-alikes are KEPT on purpose (the "be clear why" list)

| Looks redundant | Why it stays |
|---|---|
| `leads.company_id`, `projects.company_id` + their indexes | **Customer-organisation FK** (e.g. Lancor → many projects), *not* multi-tenancy. The "no `company_id` ever" rule is about tenant isolation — different concept, same word. Do **not** "clean up". |
| Partial indexes that share a column with a full one (e.g. `idx_invoices_overdue`, `idx_customer_payments_attribution_status`) | Different `WHERE` predicate → serves a different query slice. Kept. |
| `cached-dashboard-queries.ts` wrapping `dashboard-queries.ts` | Deliberate `unstable_cache` layer, not a copy. |
| `type X = Database['public']['…']` aliases repeated per file | The *correct* pattern (derive from generated types, never hand-roll). Low-value to centralise; harmless. |
| `crypto.randomUUID()` in 36 files | Mandated UUID pattern (offline-create), not a duplicated helper. |
| Sort-direction-only index variants kept elsewhere | Where a `DESC` index backs a real ORDER BY that the survivor can't serve cheaply, it stays. |

---

## §3. Application code — duplicate server actions & query helpers

**The task-write cluster (your `CreateTask`/`CreateQuickTask` flag — confirmed real):** all of these `.insert` into the **same `tasks` table** as the universal `createTask` (`tasks-actions.ts:21`):
- `createQuickTask` — `project-milestone-actions.ts:217` (entity hardcoded to `'project'`; ad-hoc return shape).
- `createLeadTask` — `leads-task-actions.ts:24` (entity `'lead'`).
- `toggleTaskCompletion` — `project-milestone-actions.ts:269` duplicates `toggleTaskStatus` (`tasks-actions.ts:145`), **and drops the `completed_by` write** → a behavioural drift bug, not a feature.

> `createTask` already parameterises `entityType`/`entityId`/`milestoneId`, so the specialised copies can become thin wrappers (or be deleted). Doing so also closes the `completed_by` bug. **Highest-value code fix.**

**TRUE-DUPLICATE — active-employees dropdown helper, 5 identical copies** of `.from('employees').select('id, full_name').eq('is_active', true).order('full_name')`:
`getActiveEmployees` (`tasks-actions.ts:291`), `getActiveEmployeesForProject` (`project-milestone-actions.ts:310`), `getActiveEmployeesLite` (`project-detail-actions.ts:369`), `getSalesEngineers` (`leads-queries.ts:303`), `listEmployeesForSelect` (`sales-territories-queries.ts:116`) — plus a 6th inline copy in `expenses/page.tsx:56` (also a NEVER-DO #15 inline-Supabase-in-page violation). → collapse to one shared helper.

**OVERLAPPING** — `getCurrentUserRole` exists twice with divergent return contracts: `inverters-queries.ts:10` vs `om-profitability-queries.ts:57`. Should be one canonical `lib/auth.ts` helper.

**DEAD CODE** — `getProjectMilestones` in `project-qc-actions.ts:138` has **zero import sites** (the live one is `projects-queries.ts:179`), yet is re-exported through the `project-step-actions.ts` barrel — a latent `export *` name-shadow hazard. Safe to delete.

---

## §4. Utils, constants, label maps, types

**`formatINR` re-implemented ~13×** instead of importing `@repo/ui/formatters` — across PDF files (partial excuse: `@react-pdf` server bundle), but also plain components/pages: `consultant-picker.tsx:26`, `closure-approvals-panel.tsx:18`, `bom-picker.tsx:56`, `bom-review-table.tsx:88`, `partners/[id]/page.tsx:48`, `partners/page.tsx:52`, `procurement/[poId]/page.tsx:24`, `om/tickets/page.tsx:60`, `import-row-card.tsx:18`, the two vendor-portal RFQ files. → import the shared one.

**Duplicate label/colour maps (5 true-duplicate):**
- **Project-status labels** — identical 8-key map in `project-status-helpers.ts:16` *and* `project-status-badge.tsx:17` (+ an abbreviated 3rd copy in `payments/reconciliation/page.tsx:21`).
- **BOQ-status labels & colours** — `step-boq.tsx:42/33` vs `boq-variance-form.tsx:52/61`.
- **Milestone labels** — `task-constants.ts:5` vs `step-execution.tsx:25`.
- **System-type labels** — 3 copies with wording drift (`"On Grid"` vs `"On-Grid"`): `proposal-wizard/shared.tsx:69`, `system-config-box.tsx:4`, `step-qc.tsx:172` → also a label-consistency bug.
- *Model to copy:* lead-stage `STAGE_LABELS` (`leads-helpers.ts`) is correctly centralised and imported everywhere — do the same for the above via a `project-constants.ts` (respecting NEVER-DO #21).

**Duplicate type** — `ProjectLite` declared identically in `inverters-queries.ts:36` and `plant-monitoring-queries.ts:11` (and a near-twin in `amc-actions.ts:22`).

**snake/camel dual-field check → CLEAN.** No interface/type/object carries both `x_y` and `xY` for one concept. (`ProcurementFilters` etc. mix `projectId` with `per_page`, but those are *different* fields — a naming-convention smell, not the bug you suspected.)

---

## §5. UI — components & forms

**TRUE-DUPLICATE (3) — these duplicate down to the DB-write action:**
1. **Invoice dialogs** — `create-invoice-dialog.tsx:15` vs `raise-invoice-dialog.tsx:21`; backing actions `createInvoice` (`finance-actions.ts:17`) and `raiseProjectInvoice` (`finance-actions.ts:326`) **both insert into `invoices`**. ~120-line form copy-pasted. → shared `<InvoiceForm>` + one action.
2. **Payment dialogs** — `record-payment-dialog.tsx:15` vs `record-project-payment-dialog.tsx:26`; `recordPayment` (`finance-actions.ts:86`) and `recordProjectPayment` (`finance-actions.ts:398`) **both insert into `customer_payments`**. → shared `<PaymentForm>`.
3. **Signature pads** — two near-identical `SignaturePad` components (`components/signature-pad.tsx:15` vs `projects/forms/signature-pad.tsx:15`); accidental drift (callback vs hidden-input, undo vs DPR). → one parameterised pad in `packages/ui`.

**OVERLAPPING (highlights, full list in agent notes):** 8 components hand-roll their own `<table>` instead of the shared `data-table.tsx` (`leads-table`, `tasks-table`, `payment-followups-table`, `payments-tracker-table`, `expense-table`, `category-admin-table`, `catalog-admin`, `bulk-action-table`); vendor add/edit forms duplicate ~180 lines (vs `contact-form.tsx`'s correct `isEdit` unification); 6 confirm-delete buttons share one `confirm()→action→refresh` shape; 5 hand-rolled tab-strips; 4 KPI cards bypass `kpi-card.tsx`; 4 banner strips; ~40 files hand-roll an empty-state instead of `EmptyState`; 3 task-creation *forms* mirror the §3 action cluster.

---

## §6. Prioritised next steps

1. **(done)** mig 188 — 25 exact-key index drops, dev. ✅
2. **(1-word go)** mig 189 — drop the 16 cold prefix-shadowed + the reversed-order index (§1b/§1c).
3. **Code, high value & low risk:** ~~make `createQuickTask`/`createLeadTask`/`toggleTaskCompletion` thin wrappers over `tasks-actions.ts` (fixes the `completed_by` bug)~~ **✅ DONE 2026-06-18** — all three now delegate to the universal `createTask`/`toggleTaskStatus`; `completed_by` restored; `createTask` returns `taskId`; regression-locked by `__tests__/task-write-wrappers.test.ts`. Still open: collapse the 5-way employee-dropdown helper; delete the dead `getProjectMilestones`.
4. **Consistency:** centralise project-status / BOQ / milestone / system-type label maps into `*-constants.ts`; import `formatINR` from `@repo/ui` everywhere.
5. **Structural (larger):** shared `<InvoiceForm>`/`<PaymentForm>` + single actions; migrate hand-rolled tables to `data-table`; add `<ConfirmDeleteButton>` / `<Banner>` / `<TabNav>` primitives to `packages/ui`.

Items 3–5 are reported only — none were auto-applied (behaviour risk; founder-review-before-commit).
