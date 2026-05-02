# Finance Module

> Invoices, customer payments, vendor bills, vendor payments (MSME 45-day SLA), profitability, cash, voucher approvals, Zoho Books historical backfill.
> Related modules: [projects] (voucher origin), [purchase] (vendor payments), [sales] (proposal payment schedule).

## Finance V2 (April 18, 2026)

Finance Module V2 shipped overnight. Key additions on top of V1:

**Schema additions (migrations 067–072):**
- `vendor_bills` + `vendor_bill_items` — full bill tracking separate from POs
- `zoho_sync_queue` — outbound sync queue with SKIP LOCKED dequeue (`claim_next_sync_batch` RPC)
- `zoho_project_mapping`, `zoho_account_codes`, `zoho_tax_codes`, `zoho_items`, `zoho_monthly_summary`, `reconciliation_discrepancies` — Zoho Books lookup tables
- `zoho_*_id` columns on 8 tables + `source` column on 5 tables (guard against sync re-enqueue)
- `recalc_vendor_bill_totals()` cascade trigger on vendor_payments
- `get_project_profitability_v2()`, `get_company_cash_summary_v2()`, `get_msme_aging_summary()` RPCs

**Zoho Books historical backfill (2023–2026):**
- 13-phase import script at `scripts/zoho-import/`
- Reconcile report at `docs/zoho-import-report-2026-04-17.md`
- 76 projects need manual match: `docs/zoho-review-queue.csv` → insert rows into `zoho_project_mapping` with `match_method = 'manual'`, then re-run phases 07-13

**New Finance UI routes:**
- `/vendor-bills` — list with KPIs + MSME badge + Zoho-import badge
- `/vendor-bills/[id]` — detail with line items + payment history
- `/vendors/[id]` — vendor detail with bills/payments/MSME info
- `/vendor-payments` — upgraded with MSME aging strip (≥30d vendors) + bill linkage
- `/profitability` — rebuilt on `get_project_profitability_v2`
- `/cash` — Zoho V2 summary panel (AR/AP bills/AP POs/reconciliation flags)
- `/dashboard` (founder) — Zoho sync health card (pending/dead queue counts)

## Overview

The finance module owns every rupee in and out of Shiroi — customer invoicing with GST splits and FY-aware document numbering, Tier-3 immutable customer payment records that cascade consultant commission payouts, vendor payment tracking with MSME 45-day statutory SLA alerts, and a PM-facing site-expense voucher approval queue. Payment follow-up tasks are materialised automatically by DB triggers per proposal milestone SLA, escalated hourly via `pg_cron`, and surfaced as a dedicated tab in `/payments`. All dashboard aggregations run through SQL RPCs (never JS `.reduce()` over money rows) and are wrapped in `unstable_cache` for the founder dashboard hot path.

## Screens / Routes

- `/vendor-bills` — V2 vendor bill list (KPI cards, MSME badge, Zoho-import source badge, status filter). `getVendorBills()` in `vendor-bills-queries.ts`.
- `/vendor-bills/[id]` — Bill detail: vendor info card + amounts + line items + payment history.
- `/vendors/[id]` — Vendor detail: MSME/Udyam info, total billed/outstanding/paid, bills list, payment history.
- `/invoices` — invoice list + create. `CreateInvoiceDialog` handles GST split (CGST/SGST for intra-state, IGST inter-state) and auto-generates the SHIROI/INV/... number.
- `/payments` — tabbed (via `payments-nav.tsx`):
  - **Project Payments** — project-level payments tracker. P&L per project, payment stages, next milestone amounts, expected collections this week / this month, invested vs received, filter by active / outstanding.
  - **Tracker** — per-project follow-up view for marketing manager: order date, completion date, invoiced ₹, sent ₹, received ₹, remaining ₹, days-since-order, KPI strip + 6 filter badges. SQL RPC `get_payment_tracker_rows()`.
  - **Receipts** — customer payment log (Tier 3, immutable).
  - **Follow-ups** (filter param, not a tab) — `PaymentFollowupsTable` with 3 summary cards (open / overdue / escalated) and 7-column task table + `MarkFollowupCompleteButton`. Scoped to `tasks.category IN ('payment_followup','payment_escalation') AND is_completed = false`.
- `/vendor-payments` — V2 upgraded: MSME aging strip (vendors ≥30d outstanding) + bill linkage column. Read-only. Writes go through the `recordVendorPayment` server action in `finance-actions.ts`.
- `/msme-compliance` — MSME 45-day alert list (Day 40+).
- `/profitability` — project-level P&L roll-up.
- `/cash` — company-level cash position with opening / closing balance.
- `/vouchers` — site expense voucher approval queue. KPI strip (pending count, pending total, projects with pending). Approve + Reject-with-reason dialog. Receipt file view-link.
- `/cash/orphan-invoices` — triage UI for parent-company Zoho invoices/payments left orphaned after mig 087. Three-pane layout (Zoho customer list / orphan invoices with line items + linked payments / candidate ERP projects). Outcomes: assign, exclude-from-cash (no ERP match), defer. Reassign + undo from Excluded/Deferred tabs. Append-only audit log built into the page. Founder + finance + marketing_manager roles. Powered by `orphan-triage-queries.ts` + `orphan-triage-actions.ts`. Banner on `/cash` shows live counts.

## Key Business Rules

- **Financial year boundary:** April 1. Document number sequences reset. `generate_doc_number()` DB function handles this. Format: `SHIROI/INV/2025-26/0042`.
- **GST:** intra-state Tamil Nadu = CGST 9% + SGST 9% = 18% (50/50 split). Inter-state = IGST 18%. POs follow the same split (see `/api/procurement/[poId]/pdf`).
- **MSME 45-day rule:** vendor payments to MSME suppliers legally due within 45 days of delivery (`vendor_payments` table). Alert on Day 40.
- **Consultant payout cascade:** every insert into `customer_payments` fires `fn_create_consultant_payout_on_customer_payment` (migration 052), creating a pending `consultant_commission_payouts` row with 5% TDS pre-applied.
- **Payment follow-ups auto-created:** `create_payment_followup_tasks` trigger materialises tasks per milestone SLA using `followup_sla_days` + `escalation_sla_days` on `proposal_payment_schedule`. Assigned to `marketing_manager` (migration 052 — previously `project_manager`).
- **Escalation job:** `enqueue_payment_escalations()` runs hourly via `pg_cron`, bumping overdue follow-ups to the `payment_escalation` category.
- **Three-tier immutability:** `customer_invoices` and `customer_payments` are Tier 3 — immutable forever, corrections only via counter-entries.
- **Voucher workflow:** `pending` → `approved` | `rejected` (with mandatory `rejected_reason`) | `auto_approved`. Pre-migration-033 rows were backfilled as `auto_approved` so only new submissions enter the queue.

## Key Tables

- `customer_invoices` — FY-aware numbering, GST split columns, status.
- `customer_payments` — Tier 3 immutable; triggers consultant payout.
- `vendor_bills` — V2: bill headers with `balance_due` generated column, cascaded by `recalc_vendor_bill_totals()` trigger.
- `vendor_bill_items` — line items per bill (taxable_amount, CGST/SGST/IGST per line).
- `vendor_payments` — per-bill or per-PO tracking, MSME 45-day SLA; `project_id` NOT NULL (derived from linked bill or PO).
- `zoho_sync_queue` — outbound sync queue; `status` enum: pending/in_progress/done/dead; claimed via `claim_next_sync_batch()` with SKIP LOCKED.
- `zoho_project_mapping` — 12 auto-matched + 76 pending manual review. `match_method`: auto/manual/fuzzy.
- `reconciliation_discrepancies` — ERP vs Zoho XLS delta rows per project/metric/date.
- `project_site_expenses` — voucher workflow (voucher_number, expense_category, status, submitted_by/at, approved_by/at, rejected_reason, receipt_file_path).
- `proposal_payment_schedule` — milestone percentages (must sum to 100%), `followup_sla_days`, `escalation_sla_days`.
- `consultant_commission_payouts` — per-tranche consultant disbursements, TDS-aware.
- `tasks` — rows with `category IN ('payment_followup','payment_escalation')`.
- `zoho_invoice_line_items` — line items extracted from Zoho's `Invoice.xls`, joined to `invoices` via `zoho_invoice_id`. Backfilled by `scripts/backfill-zoho-invoice-line-items.ts`. Compares line-item sums against `invoices.subtotal_supply` (pre-GST); skips invoices with deviation >5% AND >₹10K. ~923 rows.
- `zoho_attribution_audit` — append-only history of every triage decision (`assign`/`exclude`/`skip`/`reassign`/`undo_exclude`/`undo_skip`). RLS to founder + finance + marketing_manager only.
- `invoices.attribution_status` + `invoices.excluded_from_cash` — state-tracking columns for the orphan triage flow (mig 097). Same on `customer_payments`. Seeded `'assigned'` for rows mig 087 already attributed.

## Key Files

```
apps/erp/src/app/(erp)/
  invoices/page.tsx
  payments/page.tsx                       ← tabbed: Overview / Receipts / Follow-ups
  vendor-payments/page.tsx
  msme-compliance/page.tsx
  profitability/page.tsx
  cash/page.tsx
  vouchers/page.tsx

apps/erp/src/lib/
  finance-actions.ts                      ← createInvoice, recordPayment, recordVendorPayment
  finance-queries.ts
  payment-queries.ts
  payments-overview-queries.ts
  payment-followups-queries.ts
  site-expenses-actions.ts                ← voucher submit / approve / reject / getPending
  dashboard-queries.ts                    ← cash + P&L aggregations
  cached-dashboard-queries.ts             ← unstable_cache wrappers (getCachedCompanyCashSummary 600s)

apps/erp/src/components/
  finance/create-invoice-dialog.tsx
  finance/record-payment-dialog.tsx
  payments/payments-nav.tsx
  payments/payment-followups-table.tsx
  payments/mark-followup-complete-button.tsx
  vouchers/voucher-actions.tsx
```

Note: no `RecordVendorPaymentDialog` component yet — vendor payments are logged via the `recordVendorPayment` server action directly. `/vendor-payments` itself is a read-only list.

## RPCs (financial aggregation — SQL only, never JS `.reduce()`)

- `get_company_cash_summary()` — company-wide cash position (migration 028). **Still active on /cash V1 cards.**
- `get_company_cash_summary_v2()` — V2: total_receivables, total_ap_bills, total_ap_pos, total_project_expenses_paid, open_reconciliation_count (migration 071).
- `get_project_profitability_v2()` — V2 P&L per project: contracted_value, total_invoiced, total_received, total_billed, total_cost, margin_amount, margin_pct (migration 071). Used by `/profitability`.
- `get_msme_aging_summary()` — days_outstanding + total_outstanding per MSME vendor (migration 071). Used by `/vendor-payments` aging strip.
- `claim_next_sync_batch(entity_type, batch_size)` — atomic SKIP LOCKED dequeue from zoho_sync_queue (migration 072).
- `ack_sync_batch(results JSONB)` — mark batch rows done/failed with exponential backoff (migration 072).
- `get_pipeline_summary()` — sales pipeline ₹ totals weighted by close_probability (migration 048).
- `get_msme_due_count()` — alert counter for Day 40+ vendors (migration 028).
- `get_amc_monthly_summary()` — AMC visits scheduled vs completed (migration 048).
- `get_projects_without_today_report()` — daily-report anti-join for site-ops alerts (migration 048).
- `get_payment_tracker_rows()` — per-project rollup of invoiced / sent / received / remaining + order/completion dates + days-since-order (migration 088). Used by `/payments/tracker`.
- `get_expected_orders(window_days INT)` — leads in `negotiation`/`closure_soon` with `expected_close_date` in the next N days. Returns customer name, kWp, ₹ value (`base_quote_price` or derived), expected date, probability, days-until (migration 094). Used by Expected Orders dashboard card.
- `get_expected_payments(window_days INT)` — payment milestones whose computed expected date (`due_trigger` + `due_days_after_trigger` against `projects.order_date` / `actual_start_date` / `commissioned_date`) falls in the next N days. Skips already-paid milestones via window-fn cumulative sum vs `customer_payments` total. Returns project + customer + milestone + ₹ + date + days-until (migration 094). Used by Expected Payments dashboard + cash-page cards.
- `assign_orphan_invoice(p_invoice_id, p_project_id, p_made_by, p_notes)` / `exclude_orphan_invoice(p_invoice_id, p_made_by, p_notes)` / `reassign_orphan_invoice(p_invoice_id, p_new_project_id, p_made_by, p_notes)` — atomic cascade helpers backing the orphan triage UI (mig 100). Each returns `(success BOOLEAN, code TEXT, cascaded_payment_count INT)`; the JS layer maps to `ActionResult<T>`. SECURITY INVOKER (caller's RLS still applies).
- `get_orphan_zoho_customer_summary()` / `get_candidate_projects_for_zoho_customer(p_zoho_name TEXT)` / `get_orphan_counts()` — read aggregations for the triage page (mig 101).

## Known Gotchas

- **Sum-to-100% trigger:** `proposal_payment_schedule` percentages must sum to exactly 100% before a proposal can leave `draft`. DB trigger enforces — don't hand-roll it in app code.
- **Voucher rejection requires a reason:** `rejected_reason` is required by `site-expenses-actions.ts` reject path, written to the column of the same name on `project_site_expenses`.
- **Voucher receipt files** are uploaded to the `project-files` bucket and the path stored in `receipt_file_path`.
- **Payment follow-up trigger** references `proposals.status = 'accepted'`. Migration 032 fixed a latent bug where the trigger was checking `IN ('approved','accepted')` — `'approved'` is not a valid `proposal_status` enum value, which silently blocked every status transition that touched the trigger. Don't reintroduce it.
- **All financial dashboards** must use the cached RPCs from `cached-dashboard-queries.ts`. Do NOT re-implement aggregation in JS (NEVER-DO rules #12, #13).
- **`decimal.js` on the client, `NUMERIC(14,2)` in SQL.** Never native JS floats for money (NEVER-DO rule #5).
- **FK trap on status-history tables:** `lead_status_history.changed_by` and `proposal_status_history.changed_by` are FKs to `employees.id`, not `profiles.id`. Migrations 055 + 056 fixed this for the lead and proposal loggers respectively.

## Past Decisions & Specs

- Migration 021 — initial payment follow-up trigger on project status transitions.
- Migrations 028, 048 — performance RPCs for cash / pipeline / MSME / AMC aggregations.
- Migration 032 — payment follow-up trigger FK fix (`'approved'` was not a valid enum value).
- Migration 033 — voucher workflow columns on `project_site_expenses` + pre-existing rows marked `auto_approved`.
- Migration 034 — `estimated_site_expenses_budget` on projects (feeds BOQ + Actuals margin).
- Migration 052 — consultant payout trigger + payment follow-up SLAs + reassignment to `marketing_manager`.
- Migration 055 — `create_payment_followup_tasks` fix for `employees.is_active` (was using non-existent `deleted_at`).

## Role Access Summary

- **finance** — full CRUD on invoices / payments / vendor_payments. Read on projects. Voucher approval.
- **founder** — full access everywhere. Voucher approval.
- **project_manager** — submits site-expense vouchers. Read-only on invoices.
- **marketing_manager** — payment follow-up tasks assigned to this role (migration 052 reassigned from `project_manager`).
- **sales_engineer / designer / om_technician / site_supervisor / hr_manager / customer** — read-only on invoices / cash (scoped by RLS).
