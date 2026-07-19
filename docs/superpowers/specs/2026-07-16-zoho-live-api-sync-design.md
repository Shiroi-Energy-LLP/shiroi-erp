# Zoho Books Live API Sync — Design (2026-07-16)

> **Goal:** a live API connection with Zoho Books so that **all finance entries flow Zoho → ERP** on a schedule, plus a **write API used only for vouchers** (approved site-expense vouchers ERP → Zoho). Everything else is read-only from Zoho's perspective.
>
> Supersedes the live-sync layer (§9) of `2026-04-17-finance-module-v2-zoho-design.md`. The 2026-04 design was outbound-only (ERP → Zoho for 9 entity types via n8n workflow 62, which was scaffolded but never activated — `"active": false`, calls a nonexistent RPC, maps only 3 of 9 entity types). This design inverts the direction: **Zoho Books is the source of truth for finance entries; the ERP writes back only vouchers.**

---

## 1. What exists today (verified 2026-07-16)

| Piece | State |
|---|---|
| `zoho_*_id UNIQUE` columns on 10 tables + `source IN ('erp','zoho_import')` on 6 | Live (mig 067) |
| Zoho lookup tables (`zoho_account_codes`, `zoho_tax_codes`, `zoho_items`, `zoho_project_mapping`, `zoho_monthly_summary`) | Live (mig 068) |
| Outbound enqueue triggers on 9 tables → `zoho_sync_queue` | Live and producing rows (migs 069 + 105), **nothing drains the queue** |
| `claim_next_sync_batch` / `ack_sync_batch` RPCs (mig 072) | **Stale/broken** — reference columns and statuses (`operation/payload/retry_after`, `in_progress/done/dead`) that the live table doesn't have; nothing calls them |
| Queue claim columns `claimed_at/processed_at/retry_count` | Live (mig 126) |
| n8n workflow `62-zoho-live-sync.json` | Inactive scaffold — ERP→Zoho push for invoice/payment/contact; calls nonexistent `claim_zoho_sync_batch` RPC; superseded by this design and **deleted** |
| Historical backfill | Done via XLS import (`scripts/zoho-import/`, 13 phases, `source='zoho_import'`, idempotent on `zoho_*_id`) |
| Zoho API client / OAuth code | **None anywhere in the repo** |
| Inbound Zoho→ERP sync | **None** (2026-04 spec only planned a monthly summary puller; never built) |

"Voucher" = a row in `expenses` (site/project expense) with per-submitter `voucher_number` (mig 066 trigger) and approval workflow `submitted → verified → approved | rejected` (mig 066 CHECK; the `pending/auto_approved` set in `docs/modules/finance.md` is pre-066 and stale). `/vouchers` → `/expenses?status=submitted`. The BOM-sheet `voucher_no` on `project_boq_items` (mig 198) is a different, unrelated concept (GST-bill tracking) and is **out of scope**.

## 2. Architecture

```
                    ┌────────────────────────────────────────────┐
 n8n cron (15 min)  │  Supabase Edge Function: zoho-sync (Deno)  │
 63-zoho-sync-cron ─┤                                            │
 POST {mode:'both'} │  PUSH (vouchers only)      PULL (all)      │
                    │  claim_zoho_voucher_batch  per-entity      │
                    │  → POST/PUT /expenses      last_modified   │
                    │  → write zoho_expense_id   watermark pull  │
                    │    back to expenses row    → upsert on     │
                    │                              zoho_*_id     │
                    └────────────┬───────────────────┬───────────┘
                                 │                   │
                        zoho_sync_queue      invoices, customer_payments,
                        (expense rows only)  vendor_bills(+items), vendor_payments,
                                             expenses, invoice_credit_notes,
                                             purchase_orders, contacts, vendors,
                                             zoho_account_codes/tax_codes/items,
                                             zoho_invoice_line_items,
                                             zoho_sync_state / zoho_sync_runs
```

- **Runtime:** one new Edge Function `supabase/functions/zoho-sync/` — self-contained Deno file(s), same convention as `inverter-poll` (deps inlined / `jsr:` imports; no workspace package imports). All Zoho API knowledge lives here.
- **Scheduling:** n8n `scheduleTrigger` every 15 min (new workflow `63-zoho-sync-cron.json`), POSTs the function with the service key — identical invocation pattern to `60-inverter-poll-cron.json`. No pg_cron (repo has none).
- **Auth to the function:** requires the service-role Bearer (like `process-document`). n8n already holds `SUPABASE_SERVICE_KEY`.
- **Modes:** request body `{ "mode": "pull" | "push" | "both", "entity"?: string }`. Cron sends `both` (push first, then pull). The admin UI's "Sync now" sends targeted requests. Long work runs via `EdgeRuntime.waitUntil` after an early `202` response.

## 3. Zoho auth (India DC)

Self-client OAuth 2.0, refresh-token grant. **Secrets live as Edge Function env vars** (Supabase secrets — same precedent as `FIMER_CRED_*` / `SUNGROW_APPKEY`; set programmatically via the Management API PAT, see `scripts/set-zoho-edge-secrets.ts`):

```
ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN
ZOHO_BOOKS_ORG_ID
ZOHO_DC                                (default 'in' → accounts.zoho.in + www.zohoapis.in)
ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID        (fallback Zoho expense account for voucher push)
ZOHO_PAID_THROUGH_ACCOUNT_ID           (Zoho paid-through account for voucher push)
ZOHO_PULL_SINCE                        (optional 'YYYY-MM-DD'; cold-scan guard — see §4 payments note)
```

Access token fetched once per invocation (`POST accounts.zoho.in/oauth/v2/token`, grant_type=refresh_token) and held in memory; never persisted. *Deviation from the 2026-04 spec (§12 "tokens live only in n8n"):* the intent there was "never in the ERP DB / source code", which still holds — Edge secrets are the established equivalent store, and moving Zoho calls out of n8n JSON into typed Deno code makes the mapping logic reviewable and testable.

Rate limits (Zoho Books: ~100 req/min, plan-dependent daily cap) are respected by a per-run **page budget** (max 20 pages × 200 records per entity per run) and a 250 ms inter-request delay. A cold start (no watermark) therefore converges over several 15-min cycles rather than one giant run.

## 4. Inbound pull (Zoho → ERP) — all entities

Per entity, in FK-safe order: `chartofaccounts → taxes → items → contacts(customers) → contacts(vendors) → purchaseorders → invoices → customerpayments → bills → vendorpayments → expenses → creditnotes`.

Incremental fetch: `GET /books/v3/<module>?organization_id=…&last_modified_time=<watermark>&page=N&per_page=200`, watermark = max `last_modified_time` seen, persisted per entity in `zoho_sync_state` together with a page cursor (crash-safe resume). Null watermark ⇒ full scan (bounded by the page budget; upserts are idempotent so re-pulls are safe).

Targets and keys (mirrors the XLS import's column semantics — `scripts/zoho-import/phase-*.ts` are the mapping reference):

| Zoho module | ERP target | Conflict key | Notes |
|---|---|---|---|
| Chart of Accounts | `zoho_account_codes` | `account_id` (PK) | |
| Taxes | `zoho_tax_codes` | `tax_id` (PK) | |
| Items | `zoho_items` | `zoho_item_id` (PK) | |
| Contacts (customer) | `contacts` | `zoho_contact_id` | |
| Contacts (vendor) | `vendors` | `zoho_vendor_id` | incl. MSME/GST fields |
| Purchase Orders | `purchase_orders` | `zoho_po_id` | |
| Invoices | `invoices` (+ line items → `zoho_invoice_line_items`) | `zoho_invoice_id` | |
| Customer Payments | `customer_payments` | `zoho_customer_payment_id` | **insert-only** (Tier-3 immutable; ON CONFLICT DO NOTHING). Consultant-payout trigger firing on insert is correct business behaviour. |
| Bills | `vendor_bills` + `vendor_bill_items` | `zoho_bill_id` | `recalc_vendor_bill_totals` cascade still applies |
| Vendor Payments | `vendor_payments` | `zoho_vendor_payment_id` | |
| Expenses | `expenses` | `zoho_expense_id` | see echo guard below |
| Credit Notes | `invoice_credit_notes` | `zoho_credit_note_id` | |

**Hard rules for the upsert layer:**

1. **Only Zoho-owned columns are updated.** ERP-owned columns are never clobbered on conflict: `project_id`, `attribution_status`, `excluded_from_cash`, approval/status workflow columns, `erp_created`, `erp_recorded`, and any `*_by/*_at` audit columns. Attribution stays with the orphan-triage flow; unmatched new rows land with `project_id NULL` (allowed since mig 084) and show up in `/cash/orphan-invoices`.
2. **Rows are stamped `source='zoho_import'`** on insert (existing CHECK allows only `erp|zoho_import`; no constraint churn). This also keeps the mig-069 enqueue guard working — Zoho-sourced rows never echo back into the outbound queue.
3. **Echo guard on expenses:** a voucher we pushed comes back on the next pull with its `zoho_expense_id` already stamped on the ERP row → the upsert matches it and, because the row has `source='erp'`, updates **nothing** (ON CONFLICT … DO UPDATE … WHERE `expenses.source='zoho_import'`). ERP-created vouchers stay ERP-owned.
4. Project attribution for inbound rows reuses `zoho_project_mapping` where a `zoho_project_id` is present; otherwise NULL → triage.

Every run writes one row per entity to `zoho_sync_runs` and updates `zoho_sync_state`.

**As-built notes (v1 scope):**
- **Line items are not pulled.** Zoho list endpoints carry no lines; per-record detail calls would blow the rate budget. `zoho_invoice_line_items` / `vendor_bill_items` are not populated by the live sync (the XLS backfill's rows remain). Invoice/bill list rows carry no tax split either → inserts land `total_amount` exact, GST columns 0.
- **Credit notes are the one detail-call exception** (invoice linkage exists only in the detail response; trivially few records). Insert-only, like the backfill.
- **Payments grain caveat:** the XLS backfill keyed customer/vendor payments per *allocation*; the API lists per *parent payment*, so the zoho-id conflict key alone cannot dedupe a cold scan against backfilled history. Guards: customer payments also skip parent payment numbers already present in backfill receipts, and `ZOHO_PULL_SINCE` skips cold-scan rows older than the given date for customerpayments / vendorpayments / expenses. **Set `ZOHO_PULL_SINCE` to the XLS export date (2026-04-17) before first activation** — vendor payments have no other cold-scan guard.
- Contacts are link-only (never inserted/edited by the pull); vendors link by GSTIN/fuzzy match, else are created.

## 5. Outbound push (ERP → Zoho) — vouchers ONLY

- **The only write surface is the voucher push.** The 8 non-expense enqueue triggers (invoices, customer_payments, contacts, vendors, projects, purchase_orders, vendor_bills, vendor_payments) are **dropped** in mig 199 — with Zoho as inbound source of truth, echoing ERP copies back would create duplicates. Existing pending non-expense queue rows are marked `skipped`. The expense trigger (`expenses_sync_enqueue`) stays as-is.
- **Claim:** new RPC `claim_zoho_voucher_batch(p_limit INT)` — `FOR UPDATE SKIP LOCKED` over `zoho_sync_queue` rows `WHERE entity_type='expense' AND status='pending' AND claimed_at IS NULL AND retry_count < 5`, **joined to `expenses` with `status = 'approved'`** — so a voucher enqueued at submission simply waits in the queue until it's approved. Sets `claimed_at`, `status='syncing'`, returns queue row + denormalised expense fields (voucher_number, amount, expense_date, description, category code, project's zoho mapping). Replaces the stale mig-072 RPCs (`claim_next_sync_batch` / `ack_sync_batch` are dropped — broken against the live table, zero callers).
- **Push:** `action='create'` → `POST /books/v3/expenses`; `action='update'` (voucher edited after a successful push) → `PUT /books/v3/expenses/{zoho_expense_id}`. Payload: amount, date, `reference_number = voucher_number`, description, project (via `zoho_project_mapping`), expense account resolved `zoho_account_codes.erp_expense_category = expense_categories.code` (of the voucher's `category_id`) → else `ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID`; paid-through = `ZOHO_PAID_THROUGH_ACCOUNT_ID`. (Expenses carry no vendor link — no vendor field is sent.)
- **Ack:** success → queue row `status='synced'`, `processed_at`, `zoho_response`; write `zoho_expense_id` back onto the `expenses` row (service-role update; the mig-069 UPDATE guard tolerates it). Failure → release claim, `retry_count+1`, `last_error`; at 5 attempts → `status='failed'` (surfaced in admin UI + founder dashboard sync-health card).

## 6. Schema — migration `204_2026-07-16-zoho-live-api-sync.sql` (dev-applied, additive + cleanup)

1. `zoho_sync_state` — `entity TEXT PK`, `watermark TIMESTAMPTZ`, `page_cursor INT NOT NULL DEFAULT 1`, `last_run_at TIMESTAMPTZ`, `last_run_status TEXT CHECK (IN ('ok','error','partial'))`, `last_error TEXT`, `total_rows_synced BIGINT NOT NULL DEFAULT 0`. Seeded with the 12 entities.
2. `zoho_sync_runs` — `id UUID PK DEFAULT gen_random_uuid()`, `mode TEXT CHECK (IN ('pull','push'))`, `entity TEXT`, `started_at/finished_at TIMESTAMPTZ`, `status TEXT CHECK (IN ('ok','error','partial'))`, `rows_fetched INT`, `rows_upserted INT`, `error TEXT`. Index `(started_at DESC)`.
3. RLS on both: SELECT for founder/finance; writes via service role only.
4. `zoho_account_codes.erp_expense_category TEXT` (nullable) + index — maps ERP voucher categories → Zoho expense accounts.
5. `claim_zoho_voucher_batch(p_limit INT)` RPC (SECURITY DEFINER, service-callable) as in §5.
6. DROP the 8 non-expense enqueue triggers + their functions; `UPDATE zoho_sync_queue SET status='skipped' WHERE entity_type <> 'expense' AND status='pending'`.
7. DROP FUNCTION `claim_next_sync_batch`, `ack_sync_batch` (stale mig-072 pair).

Types regenerated in the same commit (NEVER-DO #20) via Management API + `scripts/strip-view-fk-entries.mjs`.

## 7. Admin UI — `/settings/zoho-sync` (founder + finance)

- Per-entity table from `zoho_sync_state` (watermark, last run, status, total rows).
- Recent `zoho_sync_runs` list (last 20, `count:'estimated'` + range).
- Voucher-push health: pending / syncing / failed counts scoped to `entity_type='expense'`; failed rows with `last_error`.
- "Sync now" button → server action (`ActionResult<T>`) that fire-and-forgets a POST to the edge function (3 s `AbortSignal.timeout`, same pattern as `emitErpEvent`) — no background work inside the action (NEVER-DO #18).
- Files: `zoho-sync-queries.ts` (reads) / `zoho-sync-actions.ts` (`'use server'` trigger) / page + small client components. Founder-dashboard sync-health card keeps working (queue semantics unchanged for expenses).

## 8. n8n

- **New** `infrastructure/n8n/workflows/63-zoho-sync-cron.json`: scheduleTrigger 15 min → POST `{{SUPABASE_URL}}/functions/v1/zoho-sync` body `{"mode":"both"}`, service-key Bearer — clone of the inverter-poll cron shape. Error path posts `zoho_sync.error` to the event bus (existing convention from workflow 62).
- **Deleted** `62-zoho-live-sync.json` (inactive scaffold, wrong direction, nonexistent RPC). Its error-bus convention carries over to 63.

## 9. Manual steps for Vivek (blocking go-live, not blocking merge)

1. Create a Zoho **self client** at `api-console.zoho.in` → client id + secret; generate a grant code for scope `ZohoBooks.fullaccess.all` (or granular read scopes + `ZohoBooks.expenses.CREATE/UPDATE`); exchange for a **refresh token**.
2. Pick the Zoho expense account + paid-through account ids for voucher push.
3. Run `npx tsx scripts/set-zoho-edge-secrets.ts` (reads `.env.local`, sets the §3 secrets via the Management API PAT — dry-run by default, `--apply` to write) and deploy the function. **Include `ZOHO_PULL_SINCE=2026-04-17`** (XLS backfill export date) to prevent cold-scan duplicates on payments/expenses.
4. Import workflow 63 into n8n and activate.
5. First cold pull runs over a few cycles; then check `/settings/zoho-sync`.

## 10. Out of scope

- Journals / manual GL entries (Zoho journals API) — not pulled; `zoho_monthly_summary` stays a future monthly puller.
- Auto-creating ERP `projects` from Zoho projects — attribution stays with orphan triage + `zoho_project_mapping`.
- BOM-sheet `voucher_no` (mig 198) — unrelated concept.
- Webhooks from Zoho (push-based sync) — polling is sufficient at Shiroi volume; revisit if 15 min staleness ever bites.
