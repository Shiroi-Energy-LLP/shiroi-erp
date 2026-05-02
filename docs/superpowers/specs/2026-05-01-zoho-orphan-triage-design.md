# Zoho Orphan Triage — Design

**Date:** 2026-05-01
**Status:** Approved (Vivek), pending implementation plan
**Follows:** Migration 087 (`zoho_customer_attribution_columns`), commit `daeda23`

---

## Problem

After mig 087's conservative 1:1 attribution backfill recovered 21 invoices + 50 cascaded payments + 6 advances (~₹1.51 Cr), **303 `zoho_import` invoices (~₹63 Cr) and 659 customer_payments still have NULL `project_id`**. These are parent-company invoices issued in Zoho where one Zoho customer maps to many ERP sub-projects:

- "RAMANIYAM REAL ESTATES PRIVATE LIMITED" — 12 invoices / ₹0.30 Cr → 8+ ERP "M/s Ramaniyam X" projects
- "LANCOR HOLDINGS LIMITED" — 5 invoices / ₹0.24 Cr → 12+ ERP Lancor projects
- "NAVIN HOUSING AND PROPERTIES P LTD" — 9 invoices / ₹0.33 Cr → 8+ ERP Navin projects
- "MEGAGRID VOLTARES BHARAT PVT LTD" — 4 invoices / ₹55.71 Cr → no obvious ERP match (likely industrial deal not in ERP yet)

Conservative algorithmic attribution can't disambiguate these. The cash positions on completed projects look wrong (artificial negatives) because vendor payments are attributed but the matching customer money isn't. The fix needs human eyes on each row.

## Goal

Build a triage UI at `/cash/orphan-invoices` where **founder + finance + marketing_manager** can chew through the orphan queue together and clear it within a few days. Each decision either assigns the invoice/payment to a project, marks it as "no ERP match — exclude from cash", or defers it for later research. Every decision is logged with `made_by` for accountability across the team.

## Out of scope

- Splitting one invoice across multiple projects. <5% of orphans need this; manual DB edit if absolutely necessary.
- Creating placeholder ERP projects from this page. Use `/sales/new` instead.
- Mobile-responsive layout. Three-pane is desktop-only; mobile users get a "use desktop" notice.
- Automatic ML-style suggestion of the most likely project based on line-item keywords. Right pane uses customer-name token overlap only; "search all projects" fallback covers the rest.
- Bulk-assign-multiple-invoices in one click. Each invoice is one decision.
- Slack / email digest of triage activity. Could be added later via the n8n event bus.

---

## UX

### Route & access

- **Route:** `/cash/orphan-invoices` — sub-route under existing cash flow section.
- **Access:** page-level guard on `profile.role IN ('founder','finance','marketing_manager')`. Other roles redirect to `/cash` with a 403 notice. Existing RLS on `invoices` and `customer_payments` already lets these three roles read+update.
- **Discoverability:** banner card on `/cash` page header showing live counts (*"303 orphan invoices · ₹63 Cr · 659 payments → triage"*). Yellow/amber styling, auto-hides when count = 0. Counts cached 60s via `unstable_cache`.

### Page structure

**Header:** Breadcrumb back to `/cash`. Page title "Zoho Orphan Triage".

**KPI strip:** 4 cards across the top.
1. Pending invoices count + ₹ total
2. Pending payments count + ₹ total
3. Excluded count + ₹ total ("no ERP match" decisions)
4. Deferred count ("set aside, needs research")

**Tab strip:** *Active* (default) · *Deferred* · *Excluded* · *Audit log*.

### Three-pane body (Active tab)

**Left pane (260px) — Zoho customers list**
- Sortable list, default sort by orphan ₹ desc (biggest gaps first).
- Each row: Zoho customer name · invoice count · ₹ orphan total · candidate ERP project count.
- Search input filters by Zoho customer name.
- Selected customer highlights; clicking switches the middle + right panes.
- Customer disappears from list when its orphan count hits 0.

**Middle pane (flex-1) — orphan invoices for the selected customer**
- Header strip: customer name + invoice count + ₹ total + linked-payment count + linked-payment ₹.
- Sub-tab toggle: *Invoices* · *Orphan payments (no invoice link)* — separate views for the two row types.
- Each invoice rendered as a card:
  - Top row: `ZHI/INV-2145 · 23 Sep 2024 · ₹2,52,000 · GST: intra-state 18% · Status: Paid`
  - **Line items table** (always visible — primary disambiguation signal): item name · qty · rate · amount.
  - **Notes** (Zoho memo) if present.
  - **Linked customer payments** (if any): inline mini-table — date · amount · mode · reference · description.
  - Action row: `[Assign to project ▾]` `[No ERP match]` `[Defer]`
- Cards are filterable by date range, amount range, line-item keyword.

**Right pane (320px) — candidate ERP projects** (sticky)
- Default toggle: **Likely matches** — projects whose `customer_name` token-overlaps the selected Zoho customer name (server-side normalize + token overlap RPC).
- Alternative toggle: **Search all projects** — typeahead fallback for cases like MEGAGRID with no obvious match.
- Each project card:
  - Project number · sub-project customer name · status badge.
  - System size (kWp) · system type.
  - Contracted · Invoiced · Received (with %).
  - Net cash position (color-coded: red if negative, green if positive).
  - Project dates: started · completed (if applicable).
  - `[Assign this invoice →]` button.
- Two ways to assign: click `[Assign →]` on a project card (assigns the focused middle-pane invoice), or click `[Assign to project ▾]` on an invoice (dropdown sourced from this same list).

### Action modals

- **Assign confirmation** — *"Assign ZHI/INV-2145 (₹2,52,000) to M/s Ramaniyam Adhri?"* + lists linked payments that will cascade. Optional notes textbox. Cancel / Confirm.
- **Exclude** — *"Mark as 'No ERP match — exclude from cash'? This invoice (₹X) and its N linked payments (₹Y) will not affect any project's cash position. You can undo from Excluded tab."* **Required** notes textbox. Cancel / Confirm.
- **Defer** — Notes textbox + Confirm. *"Move to Deferred — won't affect cash until you come back."*
- **Reassign / undo** (from Excluded or Deferred tab) — *"Move back to active triage?"* Cancel / Confirm.

### Audit log tab

- Reverse-chronological table of `zoho_attribution_audit` rows.
- Columns: when · who · entity (link to invoice/payment) · decision · from → to · notes.
- Filterable by decision type and by user. CSV export.
- Append-only — undo decisions log new rows, never delete.

### Empty state

When all triage queues are empty: full-page green checkmark + *"All Zoho imports attributed. Last decision: [date] by [name]."* with link to audit log.

---

## Data model

Five migrations, applied in order, each one verified on dev before applying to prod.

### Mig 088 — `zoho_invoice_line_items` table

```sql
CREATE TABLE zoho_invoice_line_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  zoho_invoice_id  TEXT NOT NULL,
  line_number      INT NOT NULL,
  item_name        TEXT,
  item_description TEXT,
  quantity         NUMERIC,
  rate             NUMERIC(14,2),
  amount           NUMERIC(14,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_zoho_invoice_line_items_invoice_id ON zoho_invoice_line_items(invoice_id);
CREATE INDEX idx_zoho_invoice_line_items_zoho_invoice_id ON zoho_invoice_line_items(zoho_invoice_id);
```

Backfilled one-shot from `Invoice.xls` via `scripts/backfill-zoho-invoice-line-items.ts`. Estimated ~5K rows.

**Mismatch handling:** for each Zoho invoice, sum the line-item amounts and compare to `invoices.total_amount`. If the absolute deviation > 5% AND > ₹10,000, skip backfilling that invoice's line items entirely and log a warning. The invoice header data stays — only its line items are skipped. Smaller mismatches (rounding) are accepted as-is.

### Mig 089 — `excluded_from_cash` + `attribution_status` columns

```sql
ALTER TABLE invoices
  ADD COLUMN excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

ALTER TABLE customer_payments
  ADD COLUMN excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

CREATE INDEX idx_invoices_attribution_status
  ON invoices(attribution_status) WHERE source = 'zoho_import';
CREATE INDEX idx_customer_payments_attribution_status
  ON customer_payments(attribution_status) WHERE source = 'zoho_import';

-- Seed prior triage state from mig 087's results:
UPDATE invoices
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;

UPDATE customer_payments
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;
```

The seed treats already-attributed mig 087 rows as triaged so they don't show up in the queue.

### Mig 090 — Cash-position trigger update + bulk refresh

Updates the `recompute_project_cash_position` trigger function (defined in mig 080) to filter on `excluded_from_cash`:

```sql
-- Old subquery (within the trigger):
SELECT SUM(amount) FROM customer_payments WHERE project_id = p.id

-- New:
SELECT SUM(amount) FROM customer_payments
WHERE project_id = p.id AND excluded_from_cash IS NOT TRUE
```

Same change for invoice subqueries (`total_invoiced`, `amount_outstanding`, `amount_paid`).

After the trigger function is updated, the migration also re-runs the bulk INSERT...ON CONFLICT from mig 087 §2 to refresh every project's row in `project_cash_positions`. Behavior should be identical to pre-migration since no rows are excluded yet.

### Mig 091 — `zoho_attribution_audit` table

```sql
CREATE TABLE zoho_attribution_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('invoice','payment')),
  entity_id       UUID NOT NULL,
  from_project_id UUID REFERENCES projects(id),
  to_project_id   UUID REFERENCES projects(id),
  decision        TEXT NOT NULL CHECK (decision IN
                    ('assign','exclude','skip','reassign','undo_exclude','undo_skip')),
  made_by         UUID NOT NULL REFERENCES employees(id),
  made_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX idx_zoho_attribution_audit_entity ON zoho_attribution_audit(entity_id);
CREATE INDEX idx_zoho_attribution_audit_made_by_date
  ON zoho_attribution_audit(made_by, made_at DESC);
```

### Mig 092 — SQL helper functions

Three plpgsql functions wrap the multi-row updates so the cascade (invoice → linked payments) is atomic:

- `assign_orphan_invoice(p_invoice_id, p_project_id, p_made_by, p_notes)` — sets `project_id` + `attribution_status = 'assigned'` on invoice. Cascades to linked payments only where `project_id IS NULL` (preserves any payments already attributed by mig 087's direct-customer-name path). Inserts audit row, returns cascade count.
- `exclude_orphan_invoice(p_invoice_id, p_made_by, p_notes)` — sets `excluded_from_cash = TRUE` + `attribution_status = 'excluded'` on invoice. Cascades the same two flags to all linked payments regardless of their current `project_id` (a payment for an excluded invoice should always be excluded too). Inserts audit row.
- `reassign_orphan_invoice(p_invoice_id, p_new_project_id, p_made_by, p_notes)` — captures `old_project_id` from the invoice, updates the invoice's `project_id` to new. Cascades to linked payments where `project_id = old_project_id` (moves only the payments that were cascaded by the original assign — leaves alone any payments separately attributed elsewhere). Inserts audit row with `from_project_id` + `to_project_id` set, decision = `'reassign'`.

All three: `SECURITY INVOKER` (caller's RLS applies), defensive entry checks (e.g., assign requires `attribution_status = 'pending'`), return error code if state is unexpected so the JS layer can show "already triaged by [name]" toast.

The simpler operations (defer, advance-payment assign, undo) stay JS-only since they touch one row.

### Type regeneration

`packages/types/database.ts` is regenerated after mig 097 (new columns), mig 099 (new audit table), and mig 096 (new line-items table). Per NEVER-DO #20 (never ship schema changes without regenerating types), each migration is committed alongside its type regen.

---

## Server-side architecture

### File layout

```
apps/erp/src/app/(erp)/cash/orphan-invoices/
  page.tsx                          ← role guard, data load
  loading.tsx
  _components/
    triage-shell.tsx                ← KPIs + tabs + 3-pane container
    customer-list-pane.tsx          ← LEFT (client component)
    invoices-pane.tsx               ← MIDDLE
    invoice-card.tsx
    line-items-table.tsx
    candidates-pane.tsx             ← RIGHT
    candidate-card.tsx
    assign-modal.tsx
    exclude-modal.tsx
    defer-modal.tsx
    audit-log-table.tsx

apps/erp/src/lib/
  orphan-triage-queries.ts          ← reads only
  orphan-triage-actions.ts          ← mutations ('use server')
```

### Reads — `orphan-triage-queries.ts`

| Function | Returns | Backed by |
|---|---|---|
| `getOrphanCustomerSummary()` | left pane: Zoho customer aggregates | New RPC `get_orphan_zoho_customer_summary()` (SQL aggregation per NEVER-DO #12) |
| `getOrphansForCustomer(name)` | middle pane: invoices + line items + linked payments + orphan-payments-no-invoice | Plain Supabase select with joins |
| `getCandidateProjectsForCustomer(name)` | right pane: candidate ERP projects with cash position | New RPC `get_candidate_projects_for_zoho_customer(zoho_name TEXT)` — server-side normalize + token overlap |
| `searchAllProjects(query)` | typeahead fallback | Reuse existing project search; else `ilike` on customer_name + project_number |
| `getOrphanCounts()` | banner counts on `/cash`, KPI cards on triage page | Tiny RPC `get_orphan_counts()` |
| `getAttributionAudit({filters, page})` | audit log rows | Plain select, paginated, `count: 'estimated'` |

### Mutations — `orphan-triage-actions.ts`

All `'use server'`, all return `ActionResult<T>` (NEVER throw across RSC boundary, NEVER-DO #19).

| Action | Wraps | Notes |
|---|---|---|
| `assignOrphanInvoice(invoiceId, projectId, notes)` | RPC `assign_orphan_invoice` | Returns `{cascadedPaymentCount}` |
| `assignOrphanPayment(paymentId, projectId, notes)` | Direct UPDATE + audit insert (one row) | For advances |
| `excludeInvoice(invoiceId, notes)` | RPC `exclude_orphan_invoice` | Notes required (validated client + server) |
| `excludePayment(paymentId, notes)` | Direct UPDATE + audit insert | Notes required |
| `deferInvoice(invoiceId, notes)` / `deferPayment(paymentId, notes)` | Direct UPDATE + audit insert | One row each |
| `reassignInvoice(invoiceId, newProjectId, notes)` | RPC `reassign_orphan_invoice` | Captures from→to in audit |
| `undoExclude(entityType, entityId)` / `undoDefer(entityType, entityId)` | Direct UPDATE + audit insert | Audit row decision = `undo_exclude` / `undo_skip` |

Each action runs in this order:
1. Auth check — `profile.role IN ('founder','finance','marketing_manager')` else `{error: 'forbidden'}`.
2. State precondition check (e.g., assign requires `attribution_status = 'pending'`).
3. Call the RPC or direct UPDATE.
4. `revalidatePath('/cash/orphan-invoices')` and `revalidatePath('/cash')`.
5. Return `ActionResult<T>`. Errors logged with `op = 'assignOrphanInvoice'` etc. per CLAUDE.md error-handling standard.

### Auth + RLS

- Page-level role check in `page.tsx` (Next.js server component).
- RLS on `invoices` / `customer_payments` already permits the three roles.
- The SQL helper functions run as `SECURITY INVOKER`, so the caller's RLS still applies — no privilege escalation.

---

## Edge cases & risks

- **Concurrent edits.** Two team members triaging at once could race for the same invoice. The SQL helpers defensively check `attribution_status = 'pending'` on entry and return an error if not. UI shows toast: *"This invoice was just triaged by [name]. Refreshing…"* + reloads.
- **Line-item amount mismatches.** Zoho line items occasionally have rounding differences. Backfill skips line items for any invoice where the deviation is large (>5% AND >₹10,000). Smaller mismatches are accepted. The invoice itself is unaffected — `invoices.total_amount` remains authoritative for cash math.
- **MEGAGRID-style customers with no candidate ERP project.** Right pane shows *"No likely matches. Search all projects, or mark these invoices as 'No ERP match'."* The exclude action handles this cleanly.
- **Linked-payment race with mig 087.** Some payments got `project_id` set via mig 087's direct customer-name path while their parent invoice stayed NULL. When that invoice gets assigned, the cascade UPDATE filters `WHERE invoice_id = p_invoice_id AND project_id IS NULL` so prior decisions are preserved.
- **Customer-name token overlap is approximate.** A Zoho parent name with no token overlap to any ERP customer (MEGAGRID) returns 0 candidates. UI directs the user to "Search all projects" or "No ERP match".
- **Banner stale-count.** `getOrphanCounts()` is cached 60s via `unstable_cache` so a noisy `/cash` doesn't hit the count RPC every render. Banner refreshes when user clicks through.
- **Append-only audit.** Undo decisions log new audit rows (`undo_exclude`, `undo_skip`) — never delete. The audit log is a true history.

---

## Implementation sequencing

1. **Mig 088 + line-items backfill script** → dry-run, verify counts, apply, regen types.
2. **Mig 089** → apply (seeds `attribution_status` for mig 087 successes), regen types.
3. **Mig 090** → trigger update + bulk refresh (verify post-state matches mig 087 baseline, since no excluded rows yet).
4. **Mig 091** → audit table, regen types.
5. **Mig 092** → SQL helper functions, smoke-test from SQL Editor on a known invoice.
6. **Code: queries → actions → page → components → modals.** Each layer tested before the next.
7. **Banner on `/cash`** — last UI piece.
8. **Manual UAT pass** — three roles each, 5–10 real assignments, exclude, defer, reassign. Confirm audit log + cash-position math.
9. **Prod deploy** — migrations applied via Supabase SQL Editor in order, line-items backfill run with `PROD_*` env vars, code pushed, banner verified.

Each migration is dev-first, prod-second per CLAUDE.md NEVER-DO #10.

---

## Approximate size

- 5 migration files (~250 LOC SQL total)
- 1 line-items backfill script (~150 LOC)
- 2 lib files (queries ~200 LOC, actions ~250 LOC)
- 1 page + 11 components (~1,200 LOC TSX)
- 1 small change to `/cash/page.tsx` (banner ~30 LOC)

**Total: ~2,000 LOC of new code, 5 migrations, 1 backfill script.** Few-day project for one engineer; couple of days of team triage to clear the queue afterwards.

---

*Author: Claude (brainstormed with Vivek, 2026-05-01).*
