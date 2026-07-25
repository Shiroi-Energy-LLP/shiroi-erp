# Purchase Module

> Project-centric procurement. Two parallel flows on the same `purchase_orders` table:
>   1. **v2 competitive pipeline** (Apr 17) — BOQ → RFQ → Quote Comparison → PO with founder approval → Dispatch lifecycle. Default for v2 projects.
>   2. **Quick PO** (pre-v2, preserved) — direct BOQ → assigned-vendor PO for projects that don't need a competitive RFQ.
>
> Related modules: [projects] (BOQ origin, DC consumption), [finance] (vendor payments, MSME compliance). Cross-cutting references: master reference §7, migrations 041 + 060 + 065.

## Overview

Purchase is driven from the project's BOQ step, not from a standalone PO ledger. When a PM flips BOQ lines to "Send to Purchase" the project appears in the purchase officer's request queue (`/procurement`), where the Purchase Engineer (`purchase_officer`) works a 5-tab workspace per project:

1. **BOQ** — finalize items, set price-book rates, flag shortages. Pencil-edit Qty/Rate inline; PDF download per project (Shiroi-branded via `@react-pdf/renderer`).
2. **RFQ** — send a UUID-token RFQ to N vendors over Gmail compose or WhatsApp deep-link (no SMTP). Vendors submit via the public portal (no login), or the PE captures the quote manually / by Excel upload. Vendor typeahead (2+ char) on the send panel; expandable per-RFQ rows show invitation list with per-vendor Gmail/WhatsApp/Copy-link buttons.
3. **Comparison** — side-by-side matrix, L1 auto-highlight, per-item award (override requires reason), "Auto-award all L1" bulk action, then "Generate POs" creates one PO per winning vendor. Footer rows show each vendor's payment terms, delivery time, and notes (first non-null across their quoted items).
4. **PO** — founder is the sole approver. PE hits "Send for approval" → founder approves/rejects (with reason). Approved POs get a **Send to vendor** button (Email / WhatsApp / Copy link) which stamps `sent_to_vendor_at`, appends the channel to `sent_via_channels`, and flips `status` to `dispatched` on first send. Founder-authored POs (quick-PO or competitive) auto-approve on insert and cascade the BOQ `procurement_status` flip immediately.
5. **Dispatch** — state-driven: `[Mark dispatched]` (PE sent PO to vendor) → `[Record vendor dispatch]` (vendor shipped with date + tracking) → `[Mark received]` (acknowledged). A generated `dispatch_stage` column (draft/shipped/in_transit/received) drives the lifecycle badge. Receipt cascades the BOQ flip from `order_placed → ready_to_dispatch`. The Quick-PO / assignment flow is still available for projects that skip RFQs.

## User Flow / Screens

```
/procurement                         ← project-centric purchase request list
/procurement/project/[projectId]     ← 5-tab workspace: ?tab=boq|rfq|comparison|po|dispatch (default boq)
/procurement/orders                  ← flat PO list (audit view)
/procurement/[poId]                  ← PO detail (items, DCs, vendor payments, flag button)
/vendor-portal/rfq/[token]           ← PUBLIC vendor-facing quote submission (no auth, UUID-gated)
/vendors                             ← vendor master list
/vendor-payments                     ← vendor payment ledger
/msme-compliance                     ← 45-day MSME SLA tracker
/deliveries                          ← delivery challan list (cross-linked from projects module)
```

- **/procurement**: summary cards (Yet to Place / Order Placed / Received), project rows with procurement priority, customer name, BOQ totals, and received counts
- **/procurement/project/[projectId]**: BOQ items table with per-item vendor dropdown, bulk vendor assignment, "Create POs" button, "Mark Received" and "Mark Ready to Dispatch" per item, High/Medium priority toggle
- **/procurement/[poId]**: vendor info, items table (double-click rate to inline-edit), delivery challans, vendor payments, flag button, PDF download, cancel PO

## Status Flow

```
BOQ (yet_to_finalize) → Send to Purchase (yet_to_place) → Vendor Assigned →
  Create POs (ordered) → Received (received) → Ready to Dispatch (ready_to_dispatch) →
    DC (consumed by projects module delivery step)
```

- `project_boq_items.procurement_status`: `yet_to_finalize` | `yet_to_place` | `ordered` | `received` | `ready_to_dispatch`
- `projects.procurement_status`: same enum, rolled up at project level
- `projects.procurement_priority`: `high` | `medium`

## Key Business Rules

- **Founder is the sole PO approver** (v2): `purchase_orders.approval_status` flows `draft → pending_approval → approved | rejected`. Rejection requires a reason stored in `approval_rejection_reason`. Approval is guarded server-side in `approvePO` / `rejectPO` — the UI just hides buttons for other roles. **Founder-authored POs bypass the queue** — both `createPOsFromAssignedItems` and `generatePOsFromAwards` check `profiles.role === 'founder'` and set `approval_status='approved'` + `requires_approval=false` at insert, then call `fn_cascade_po_approval_to_boq` to flip the BOQ `procurement_status` immediately.
- **Approval + receipt cascades are SQL helpers** (migration 065): `fn_cascade_po_approval_to_boq(p_po_id)` flips linked BOQ rows `yet_to_place → order_placed` (both competitive and Quick-PO paths), and `fn_cascade_po_receipt_to_boq(p_po_id)` flips `order_placed → ready_to_dispatch`. Both are `SECURITY DEFINER` and idempotent so the server actions (`approvePO`, `markPOAcknowledged`) and the existing GRN trigger converge on the same end state.
- **Vendor portal is UUID-gated, no auth** (v2): each `rfq_invitations.access_token` is a random UUID. The `/vendor-portal/rfq/<token>` route is excluded from the auth middleware. Tokens expire per `rfq_invitations.expires_at`.
- **Dispatch lifecycle** (v2): `purchase_orders.status` goes `draft → dispatched → acknowledged` after approval. `sent_to_vendor_at` (migration 065) = PE sent PO to vendor; `vendor_dispatch_date` + `vendor_tracking_number` = vendor shipped goods; `acknowledged_at` = Shiroi received. The generated `dispatch_stage` column (4-stage: draft/shipped/in_transit/received) is the display column — Tab 5 renders `<DispatchStageBadge>` off of it. Purchase Engineers, Project Managers, and Founders all can drive the dispatch actions (Apr 17 role-matrix update).
- **Audit log is mandatory** (v2): every mutation in `rfq-actions.ts`, `vendor-portal-actions.ts`, `po-actions.ts` calls `logProcurementAudit(...)` after a successful DB write. 14 user-initiated events + 1 DB-trigger event (GRN completes PO) — see spec §9.
- **Notifications are fire-and-forget** (v2): 6 events (BOQ→purchase, quote submitted, PO sent for approval, PO approved, PO rejected, all materials received) insert into `notifications` inside try/catch so a notification failure never rolls back the primary mutation.
- Vendor assignment is **per BOQ item** via `project_boq_items.vendor_id` (migration 041, preserved for Quick-PO flow).
- `createPOsFromAssignedItems` auto-groups: one PO per distinct vendor across all assigned items on the project. No manual PO splitting.
- `generatePOsFromAwards` (v2) does the same per-vendor grouping from the awarded RFQ matrix.
- `purchase_order_items.boq_item_id` back-links each PO line to its source BOQ row for Dispatch sync.
- MSME vendors get a 45-day payment SLA — tracked in `vendor_payments`, alert on Day 40 via `/msme-compliance`.
- PO totals compute on save: subtotal + per-rate-band GST split (intra-state Tamil Nadu = 50/50 CGST/SGST) + round-off.
- PO status enum includes `approved`, `dispatched`, `acknowledged`, `cancelled`. Cancel is a soft delete — no `deleted_at` column on `purchase_orders`.
- Price Book (238 live rows) is the rate source of truth for auto-pricing and PO creation.
- **FY26-27 rates loaded 2026-07-25 (dev)** from `Price List - 26-27.xlsx` via `scripts/import-price-list-2026-27.ts` — 199 repriced, 15 added, 12 duplicate April rows retired. The importer is dry-run by default and idempotent; re-run it for the next rate card rather than hand-editing. It matches on normalized `(category, description, brand)` with a fuzzy fallback because the April import and the vendor sheets word the same item differently. Two things it deliberately does **not** do: touch rows the sheet doesn't cover (IC labour, MMS, transport/civil), or pick a canonical duplicate without checking FK references first — a row referenced by a BOM/BOQ/PO is never the one retired. Traps and open items in `docs/reviews/2026-07-25-price-book-fy26-27-import.md`.
- **Categories + units are DB-managed since mig 177 (2026-06-11):** `item_categories` (seeded Manivel-15; `price_book.item_category` is now an FK to it — the old CHECK constraint is gone) + `item_units` (seeded with Vivek's canonical list + every in-use value). Add/Edit dialogs load both lists from the DB and offer inline "+ Add new…" for founder/PM/purchase-officer; full management (add + activate/deactivate) at `/price-book/settings`. This also fixed a real bug: the dialogs' old hardcoded legacy category list violated the mig-057 CHECK, so saving most categories failed. BOI/BOQ item forms consume the same lists (props with constants fallback); `getCategoryLabel` title-cases unknown values.
- **Add/Edit fixed for PMs (mig 182, 2026-06-16).** Manivel hit `new row violates row-level security policy for table "price_book"` because `price_book_write` (mig 052) granted INSERT/UPDATE to founder/sales_engineer/purchase_officer/marketing_manager/designer but **not `project_manager`** — yet the server action `assertCanEditPriceBook` allows founder/project_manager/purchase_officer/finance, and the UI is gated to founder/PM/purchase_officer. Mig 182 realigns the policy to that editor set (founder, project_manager, purchase_officer, finance) **with an explicit `WITH CHECK`** (mig 052 had `USING`-only). A second latent bug: the Add dialog never sent the `NOT NULL gst_type` (enum `supply`/`works_contract`) — a **GST Type** select was added to both Add + Edit dialogs and `createPriceBookItem` now defaults it to `'supply'`. Net effect: PMs can add/edit all fields and save.

## Key Tables

- `purchase_orders` — PO main. `status` (draft/approved/dispatched/acknowledged/partially_delivered/fully_delivered/closed/cancelled) + `approval_status` (draft/pending_approval/approved/rejected) + `approval_rejection_reason` + `prepared_by` (employee) + `approved_by` (employee) + `dispatched_at`, `vendor_dispatch_date`, `vendor_tracking_number`, `expected_delivery_date`, `acknowledged_at`, `actual_delivery_date` + **`sent_to_vendor_at` + `sent_via_channels` + generated `dispatch_stage`** (migration 065).
- `purchase_order_items` — line items with `boq_item_id` FK back to `project_boq_items`.
- `rfqs` (migration 060) — RFQ header. `status` (draft/sent/comparing/awarded/cancelled), `created_by`, `rfq_number`.
- `rfq_items` (migration 060) — per-RFQ line items; `winning_invitation_id` set on award.
- `rfq_invitations` (migration 060) — one row per (rfq, vendor). `access_token` (UUID) is the vendor-portal key. `status` (pending/sent/viewed/submitted/expired), `sent_via_channels` (array of 'email'/'whatsapp'/'copy_link'), `submission_mode` (vendor_portal/manual/excel).
- `rfq_vendor_quotes` (migration 060) — vendor's submitted line-level prices.
- `procurement_audit_log` (migration 060) — append-only audit trail. `entity_type` + `entity_id` + `action` + `actor_id` + `old_value` + `new_value` + `reason`.
- `project_boq_items` — `vendor_id` FK from migration 041, owns `procurement_status`. **Mig 198** added the actual-spend + voucher track: `actual_quantity`, `actual_unit_price`, `actual_total_price`, `voucher_no`, `bill_status` (`need_bill`/`submitted`/`na`, default `na`) — populated by the BOM import (see section below); all nullable so legacy rows are untouched.
- `vendors` — 108+ seeded vendors, MSME flag, GSTIN, category.
- `vendor_payments` — per-tranche payments, 45-day MSME SLA clock.
- `notifications` — `recipient_employee_id`, `notification_type`, `title`, `body`, `entity_type`, `entity_id`.
- `delivery_challans` — consumed by the projects module DC step (see projects doc).
- `pending_bom_imports` (**mig 198**) — staging for the BOM + voucher import; one row per uploaded project sheet (parsed lines + header + summary as JSONB, fuzzy-match candidates, lifecycle `pending`/`imported`/`rejected`/`error`). Founder/PM RLS + `service_role` for the seed script. Reviewed at `/bom-review/import`; `approve_bom_import` cascades a confirmed row into a `project_bois` + its `project_boq_items`. See the BOM Import section below.

## Key Files

```
apps/erp/src/app/(erp)/procurement/
  ├── page.tsx                            # project-centric list
  ├── orders/page.tsx                     # flat PO list
  ├── project/[projectId]/
  │   ├── page.tsx                        # 5-tab shell (?tab=boq|rfq|comparison|po|dispatch)
  │   ├── loading.tsx
  │   ├── _tabs/
  │   │   ├── tab-boq.tsx                 # BOQ finalize + price book apply
  │   │   ├── tab-rfq.tsx                 # RFQ list + send + vendor invitation cards
  │   │   ├── tab-comparison.tsx          # quote-comparison matrix shell
  │   │   ├── tab-po.tsx                  # PO list + founder-only pending-approval banner
  │   │   └── tab-dispatch.tsx            # post-approval lifecycle timeline
  │   └── _client/
  │       ├── boq-editable-table.tsx      # Pencil-edit Qty/Rate inline (Apr 17 feedback)
  │       ├── send-rfq-panel.tsx          # Vendor typeahead (2+ char) via searchVendors action
  │       ├── send-rfq-modal.tsx          # Gmail + WhatsApp deep links per vendor
  │       ├── vendor-search-combobox.tsx  # 2+ char typeahead picker (Apr 17 feedback)
  │       ├── invitation-action-buttons.tsx   # Re-usable per-invitation Gmail/WA/Copy row
  │       ├── manual-quote-entry-dialog.tsx
  │       ├── excel-quote-upload-dialog.tsx
  │       ├── comparison-matrix.tsx       # L1 auto-highlight + override-with-reason + terms footer
  │       ├── po-approval-actions.tsx     # Send / Approve / Reject state-machine buttons
  │       ├── po-send-button.tsx          # Send / Re-send PO to vendor (Apr 17 feedback)
  │       ├── po-send-dialog.tsx          # Channel picker (Email/WhatsApp/Copy) + sendPOToVendor
  │       └── dispatch-actions.tsx        # Mark dispatched / Record / Mark received (PE + PM + founder)
  └── [poId]/page.tsx                     # PO detail

apps/erp/src/app/vendor-portal/rfq/[token]/
  ├── page.tsx                            # PUBLIC (no auth) — validates UUID, renders form
  └── _client/quote-submit-form.tsx

apps/erp/src/app/(erp)/vendors/page.tsx           # vendor master (read + Add Vendor button)
apps/erp/src/components/vendors/add-vendor-dialog.tsx  # full-schema Add dialog (May 2, 2026)
apps/erp/src/lib/vendor-actions.ts                # createVendor / updateVendor (May 2, 2026)
apps/erp/src/app/(erp)/vendor-payments/page.tsx
apps/erp/src/app/(erp)/msme-compliance/page.tsx
apps/erp/src/app/(erp)/deliveries/page.tsx

apps/erp/src/lib/
  ├── procurement-queries.ts              # list + detail reads, getEmployeeIdForProfile helper,
  │                                       #   VendorSearchResult type (search impl lives in actions)
  ├── procurement-actions.ts              # createPurchaseOrder, assignVendorToBoqItem,
  │                                       #   bulkAssignVendor, createPOsFromAssignedItems
  │                                       #     (founder auto-approve + cascade),
  │                                       #   markItemsReceived (+ PM notification on all-received),
  │                                       #   markItemsReadyToDispatch, updateProcurementPriority,
  │                                       #   searchVendors (client-callable server action)
  ├── procurement-audit.ts                # logProcurementAudit helper
  ├── rfq-actions.ts                      # createRfq, markInvitationSent, submitQuoteManually,
  │                                       #   submitQuoteFromExcel, awardRfqItem, autoAwardL1,
  │                                       #   generatePOsFromAwards (founder auto-approve + cascade),
  │                                       #   cancelRfq
  ├── rfq-queries.ts                      # RFQ list + detail, getRfqComparisonData
  │                                       #   (with paymentTerms/deliveryDays/notes per quote
  │                                       #   + vendorTerms), getPendingApprovalPOs
  ├── po-actions.ts                       # updatePoLineItemRate, deletePoSoft,
  │                                       #   sendPOForApproval, approvePO (cascade), rejectPO,
  │                                       #   sendPOToVendor (stamp sent_to_vendor_at + channel),
  │                                       #   markPODispatched, recordVendorDispatch,
  │                                       #   markPOAcknowledged (cascade)
  ├── gmail-whatsapp-links.ts             # buildGmail/WhatsApp URL + RFQ + PO message builders
  ├── vendor-queries.ts
  ├── vendor-portal-queries.ts            # public vendor portal reads (validateToken, etc.)
  └── vendor-portal-actions.ts            # markInvitationViewed, submitQuoteFromPortal
  (sendBoqToPurchase lives in project-step-actions.ts — origin is the project BOQ step,
   and it now notifies all purchase_officer users.)

apps/erp/src/components/procurement/
  ├── create-po-dialog.tsx                # multi-line PO entry with auto-totals
  ├── purchase-detail-controls.tsx        # per-item vendor dropdown, bulk assign, receipt + priority
  ├── po-status-badge.tsx
  ├── dispatch-stage-badge.tsx            # 4-stage lifecycle badge (draft/shipped/in_transit/received)
  ├── po-rate-inline-edit.tsx             # double-click rate cell
  ├── po-download-button.tsx
  ├── boq-download-button.tsx             # per-project BOQ PDF (Apr 17 feedback)
  └── po-delete-button.tsx                # soft-delete via status=cancelled

apps/erp/src/lib/pdf/
  ├── purchase-order-pdf.tsx              # Shiroi-branded @react-pdf/renderer template
  └── boq-pdf.tsx                         # Per-project BOQ PDF (Apr 17 feedback)

# API routes:
apps/erp/src/app/api/procurement/[poId]/pdf/route.ts
```

## Known Gotchas

- **PO rate inline edit**: double-click rate in PO detail items table. `updatePoLineItemRate` fetches `quantity_ordered` + `gst_rate`, recalculates `total_price = newRate × qty`, then recalculates PO `subtotal` + `gst_amount` + `total_amount`. Pre-existing bug fixed: use `quantity_ordered` (not `quantity`).
- **Create PO requires**: project + vendor + ≥1 line item. `CreatePODialog` handles dynamic add/remove of lines with auto-totals (subtotal, GST, total recomputed on every change).
- **PO PDF** requires `@react-pdf/renderer` listed in `experimental.serverComponentsExternalPackages` in `apps/erp/next.config.js` (shared with all other PDF routes — see projects module Known Gotchas).
- **"Send to Purchase" from BOQ** is bulk (`yet_to_finalize` → `yet_to_place`) and lives in the project BOQ step, not here. Entry point is `sendBoqToPurchase` in `project-step-actions.ts`.
- **PO cancel** is a status flip to `cancelled`, not a row delete — `purchase_orders` has no `deleted_at` column. The PO stays in the flat list (`/procurement/orders`) with a cancelled badge for audit.
- **PO list is paginated** (mig 192, June 2026). `getPurchaseOrders(filters)` returns `{ rows, total }` — a trimmed select (only the ~7 displayed cols + vendor/project embeds), `count:'estimated'` + `.range()`, 50/page; the page has a filter-preserving pager. It used to be a bare `.limit(100)` that silently hid ~1,950 of ~2,046 POs. The **purchase dashboard** (`purchase-queries.ts::getPurchaseDashboardData`) gets its three status KPIs from RPC **`get_purchase_order_status_counts`** (one `COUNT(*) FILTER` pass, SECURITY INVOKER) and its "recent POs" from `getPurchaseOrders({ per_page: 10 })` — never aggregate PO buckets in JS over a capped fetch again (NEVER-DO #12/#13/#25).
- **Vendor assignment on a received item** should be blocked upstream; the BOQ row is effectively locked once it moves past `ordered`.

## C1 Additions (Migration 123, May 2026)

Three gaps closed in the C1 overnight agent pass:

### Material Requisitions

New `material_requisitions` table — quick lightweight requests from site to PM before a formal PO exists:

- Columns: `project_id`, `requested_by` (employee FK), `urgency` (enum: normal/urgent/critical), `status` (enum: pending/approved/converted/rejected), `items` (JSONB array of `{description, quantity, unit, notes?}`), `notes`, `reviewer_id`, `reviewed_at`, `review_notes`, `converted_po_id`.
- Items are JSONB (not a separate table) because requisitions are quick operational requests, not formal BOQ — rates are set on the PO after conversion.
- RLS: all authenticated roles read; site_supervisor / pm / purchase_officer / founder insert; pm / purchase_officer / founder approve/convert.
- Server actions: `submitMaterialRequisition`, `reviewMaterialRequisition`, `convertRequisitionToPO`.
- `convertRequisitionToPO` creates a draft PO with all items at ₹0 rate. The PM edits rates inline on the PO detail page afterward.
- `/procurement/requisitions` — inbox page (urgency/status badges, item summary, Approve/Reject/Convert-to-PO actions).
- `SubmitRequisitionButton` — client dialog for site_supervisor / PM to submit. Max 20 dynamic line items.
- `RequisitionReviewActions` — client component with Approve, Reject (with mandatory reason), Convert-to-PO (vendor typeahead + payment terms).
- Nav item `matRequisitions` added to Procurement section for founder, project_manager, purchase_officer, and to a new Procurement section for site_supervisor.

### Vendor Bill Panel on PO Detail

`/procurement/[poId]` now shows an "Associated Vendor Bills" section:
- `getVendorBillsForPO(poId)` query uses the existing `vendor_bills.purchase_order_id` FK (migration 067) — no schema change needed.
- Shows: bill_number, bill_date, status badge, total_amount, amount_paid, balance_due, Zoho/ERP source badge.
- "View PO reconciliation →" link on the PO detail Project card navigates to the per-project reconciliation view.

### Per-Project PO vs Bill Reconciliation

New `fn_get_po_bill_reconciliation(p_project_id UUID)` SQL RPC (STABLE SECURITY DEFINER, migration 123):
- Returns per-PO: po_id, po_number, vendor_name, vendor_is_msme, po_date, po_total, approval_status, po_status, billed_amount, paid_amount, balance, bill_count, bill_status (unbilled/pending/partial/paid).
- All monetary aggregation in SQL (NEVER-DO #12 compliant).
- `/procurement/reconciliation/[projectId]` — page with 4 KPI cards (Total PO Value, Unbilled, Billed, Paid) + table with all columns + footer totals row (when >1 PO).
- Role gate: founder, finance, project_manager, purchase_officer.

### Queries / Actions File

- `apps/erp/src/lib/material-requisition-queries.ts` — all reads: `getMaterialRequisitionsForProject`, `getPendingMaterialRequisitions`, `getPOBillReconciliation`, `getVendorBillsForPO`, `getProjectBasicInfo`.
- `apps/erp/src/lib/material-requisition-actions.ts` — all mutations with `'use server'` + `ActionResult<T>`.

## Review-pass fixes (Migration 135, 2026-05-24)

Findings from `docs/reviews/2026-05-24-comprehensive-review.md`:

- **`fn_get_po_bill_reconciliation` now gates by role** — original mig 123 RPC was `SECURITY DEFINER` with no project access check, meaning any authenticated user could read any project's vendor financials by URL-guessing the `projectId`. Mig 135 wraps the function body with `IF role NOT IN ('founder','finance','project_manager','purchase_officer') THEN RAISE` and adds `SET search_path = public, pg_temp`.
- **Material requisition notifications no longer silently drop** — `submitMaterialRequisition` / `reviewMaterialRequisition` / `convertRequisitionToPO` were inserting `notification_type='material_requisition'` and `entity_type='material_requisition'`, neither of which exist in the `notifications` CHECK constraint (mig 014). Every insert failed with 23514, silently logged-and-continued. Now using `notification_type='approval_required'` (for PM ping + PO pending approval) / `'info'` (for requester reply) and dropping `entity_type` entirely (`entity_id` still preserves the requisition / PO id for deep-linking).
- **Reviewer != requester check** — `reviewMaterialRequisition` now rejects an approve/reject attempt if the calling employee is the same one who submitted the requisition. Founder is exempt (override path).

## BOM + Voucher Import (Migration 198, 2026-06-21)

Bulk-loads Shiroi's hand-maintained per-project BOM sheets (the `se-master-file` workbook — one "Bill Of Materials" sheet per project, ~48) into `project_boq_items`, capturing the **actual** spend track and **voucher/bill** status that previously lived nowhere (the contracted side was already in `proposal_bom_lines`). Mirrors the historical-plants importer (`pending_project_imports` / `/om/import-review`); targets the procurement side, attaches to **existing projects only**.

**Pipeline:** upload at `/bom-review/import` (founder/PM) → `parseBomWorkbook` (client-side `exceljs`) → `seedBomImports` stages one `pending_bom_imports` row per sheet, fuzzy-matching to a project via the `match_project_by_name` pg_trgm RPC → reviewer fixes the project match (`<ProjectCombobox>` + candidate chips) and edits any parsed cell (incl. `voucher_no` + `bill_status`) → **Confirm** calls `approve_bom_import(id, projectId, lines)` (SECURITY DEFINER, founder/PM), which creates one `project_bois` container (status `locked`, provenance in `notes`) + its `project_boq_items` rows, then marks the staging row `imported`. **Skip** is a plain RLS `UPDATE` to `rejected`. On error the row is flagged `error` with `import_error`.

**Tolerant parser** (`apps/erp/src/lib/bom-sheet-parser.ts`, shared browser + Node): anchors the table on the `Items`+`Qty`/`Rate` header row (column offsets drift between sheets), classifies category-header vs item rows, splits the contracted (1st Qty/Units/Rate/Gst/Amount/Total block) and actual (2nd block) tracks, normalises GST fractions (0.18→18), reconstructs GST-inclusive totals when the cell is an uncached Excel formula, and emits warnings instead of throwing (surfaced in the upload preview + review UI). Unit-tested in `apps/erp/src/lib/__tests__/bom-sheet-parser.test.ts`.

**Matching is never blind-written** — confidence bands (`exact ≥0.85` / `fuzzy ≥0.45` / `none`) only pre-select a default; the reviewer confirms each sheet. Seed the initial batch with `scripts/seed-bom-imports.ts` (`--dry-run` supported; idempotent on `(source_file_name, sheet_name)`). 48 sheets are staged on dev awaiting Manivel's review.

**Key files:** `bom-sheet-parser.ts`, `bom-import-actions.ts` (`seedBomImports` / `approveBomImport` / `rejectBomImport`), `bom-import-queries.ts`, `bom-import-constants.ts` (client-safe label/option maps — NEVER-DO #21), `app/(erp)/bom-review/import/` (server page + `_components/bom-upload-dialog.tsx` / `bom-import-list.tsx` / `bom-import-row-card.tsx`), `scripts/seed-bom-imports.ts`. Entry button on `/bom-review`. Spec: `docs/superpowers/specs/2026-06-21-bom-voucher-import-design.md`.

**Phase-2 (not built):** automated rough-sheet voucher consolidation (fuzzy MT/VN → line mapping); minting the ~40% of sheets with no matching project (stays `/om/import-review`'s job — create the project there, attach its BOM here).

## Quick purchase flow — BOI Manager parity (2026-07-21, migs 210/211/213)

Replicates Manivel's Google-Sheets "Bill of Items Manager" (spec `2026-07-20-purchase-flow-boi-manager-spec.md` — extracted from the live Apps Script source). Coexists with the v2 competitive flow on the same tables; quick POs carry `purchase_orders.source = 'boi_quick'` (v2 = `'erp'`).

**Routes:** `/purchase` (BOI workspace: full `project_boq_items` table, inline single-field edits, status-money KPI row that ignores the status filter, 5 sidebar status views via `?status=`, add-single w/ price-book autocomplete, bulk-add from price book, multi-select bulk bar → Change Status / Create PO / Delete) · `/purchase/orders` (PO log: search, KPIs, metadata-only edit, delete w/ default-ON revert-to-Yet-to-Place) · `/purchase/projects` (rollup: contracted_value vs BOI total vs expenses vs profit %; procurement status/priority badge-selects) · `/purchase/intake` (mobile-first site-engineer app: price-stripped price-book search → qty → submit as `yet_to_finalize`).

**RPCs (migs 210/211/213):** `create_boi_po` (atomic: re-reads lines by id, SQL totals, PO-0001 sequence via `next_boi_po_number()`, freezes `purchase_order_items`, flips lines to `order_placed`; rejects already-PO'd lines) · `delete_boi_po(id, revert)` · `get_boi_status_totals` (KPI money; search haystack includes project name; `ready_to_dispatch` folds into `received`) · `get_purchase_project_rollup` (SECURITY DEFINER, role-gated).

**Roles:** `PRICE_VISIBLE_ROLES` = founder/PM/purchase_officer/finance (finance is read-only — UI disables writes, RLS enforces); `PURCHASE_WRITE_ROLES` = founder/PM/purchase_officer; `site_supervisor` = intake only, prices stripped server-side (mig 211 removed them from `price_book_read`; intake PB reads run on the admin client as labelled system ops).

**PO PDFs:** deliberately minimal layout (no letterhead/GSTIN/signature — the team's format), generated at creation + on-demand at `/api/purchase/[poId]/pdf`, stored at `project-files/<project_id>/purchase-orders/<po_number>.pdf` (surfaces in the project Files tab).

**Deliberate deltas from the sheet:** real project FKs (combobox quick-creates a minimal project via `quickCreateProject` — mig 211 made `projects.lead_id/proposal_id` nullable for this); vendor required on PO; categories from the `item_categories` master (not the sheet's 15-item list); `procurement_priority` has no `'low'` (mig 041 CHECK); spreadsheet export is CSV (SheetJS not an erp-app dep); PDFs print "Rs." (₹ glyph missing in react-pdf builtin Helvetica); price-book and expenses screens are the existing ERP pages, not rebuilt. Open item: site supervisors can still see prices via the projects BOQ/BOM tabs (pre-existing read policy, needs a product decision).

## Past Decisions & Specs

- **Migration 103 (May 2, 2026) — `purchase_orders_status_check` finally allows `'dispatched'`.** v2 (migration 060/065) wired the `draft → dispatched → acknowledged` flow but the legacy CHECK constraint added in migration 041 only listed `('draft','approved','sent','acknowledged','partially_delivered','fully_delivered','closed','cancelled')`. Every `sendPOToVendor` / `markPODispatched` call hit `new row for relation "purchase_orders" violates check constraint "purchase_orders_status_check"`. Migration 103 drops + recreates the constraint with `'dispatched'` added; legacy values retained for backward-compat. Same-day code fixes: `createVendorAdHoc` wrote `vendor_type='supplier'` (not in the enum) → changed to `'other'` (`as any` cast also removed); Download PDF now surfaces server errors inline instead of silently swallowing into `console.error`; Copy-link button removed from PO send dialog (the URL `/procurement/<poId>` is internal-only and sent vendors to login).
- **Vendor master Add UI (May 2, 2026).** `/vendors` got an "+ Add Vendor" button (rendered only for founder / finance / project_manager / purchase_officer per RLS). Dialog covers the full schema (Identity / Address / Tax / Terms sections + MSME flag + payment terms days). New `apps/erp/src/lib/vendor-actions.ts` with `createVendor` + `updateVendor` server actions. Edit-from-row UI + vendor portal `/vendor-portal/po/[token]` deferred for a follow-up.
- **Migration 065 (Apr 17, 2026)** — Purchase v2 feedback pass. Adds `sent_to_vendor_at` + `sent_via_channels` + generated `dispatch_stage` to `purchase_orders`; back-fills existing dispatched/acknowledged rows; creates `fn_cascade_po_approval_to_boq` + `fn_cascade_po_receipt_to_boq` SECURITY DEFINER helpers. Paired code changes: Tab 1 inline Qty/Rate edit + per-project BOQ PDF; Tab 2 vendor typeahead + expandable invitation rows with re-usable `<InvitationActionButtons>`; Tab 3 payment-terms / delivery / notes footer rows; Tab 4 Send-to-vendor dialog (Email/WhatsApp/Copy) + founder quick-PO auto-approval; Tab 5 `<DispatchStageBadge>` + PM role widened on dispatch actions + receipt cascade. Specs: `docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md` + plan `docs/superpowers/plans/2026-04-17-purchase-v2-feedback-implementation.md`.
- Migration 041 — vendor_id FK on `project_boq_items`, `boq_item_id` on `purchase_order_items`, project-level procurement tracking columns (`boq_sent_to_purchase_at/by`, `procurement_priority`, `procurement_status`, `procurement_received_date`), PO status constraint fix (adds `approved`), indexes + backfill.
- Migration 046 — Price Book expansion (24 categories, vendor_name, default_qty, rate audit columns) — rate source for PO creation.
- **Migration 061 (Apr 17, 2026)** — Hotfix: broadens INSERT/UPDATE on `rfqs`, `rfq_items`, `rfq_invitations`, `rfq_quotes`, `rfq_awards` to include `project_manager`. Shiroi has no `purchase_officer` user; the PM (Manivel) is the de-facto PE. Founder-only approval on POs untouched.
- **Migration 060 (Apr 17, 2026)** — Purchase Module v2. New tables `rfqs`, `rfq_items`, `rfq_invitations`, `rfq_vendor_quotes`, `procurement_audit_log`. New `purchase_orders` columns: `approval_status`, `approval_rejection_reason`, `prepared_by`, `approved_by`, `dispatched_at`, `vendor_dispatch_date`, `vendor_tracking_number`, `expected_delivery_date`, `acknowledged_at`, `actual_delivery_date`. RLS wired for the public vendor portal (SELECT on `rfqs`/`rfq_items`/`rfq_invitations` gated by `access_token` match; INSERT on `rfq_vendor_quotes` same). Indexes on every filterable column (status, approval_status, access_token, rfq_id, vendor_id).
- `docs/superpowers/specs/2026-04-17-purchase-module-v2-design.md` — V2 design spec: 5-tab pipeline, permissions matrix, notification events (§7), audit contract (§9).
- `docs/superpowers/plans/2026-04-17-purchase-module-v2-implementation.md` — V2 implementation plan. All 10 phases landed Apr 17:
  - Phase 1: migration 060 + RLS
  - Phase 2: RFQ actions + queries + audit helper
  - Phase 3: Tab 1 (BOQ) + Tab 2 (RFQ) UI
  - Phase 4: Tab 3 comparison matrix
  - Phase 5: Tab 4 PO approval + lifecycle actions
  - Phase 6: Tab 5 dispatch tracking
  - Phase 7+8: notification + audit coverage
  - Phase 9: 3 Playwright smoke tests (6 → 9 tests total)
  - Phase 10: CI gates + docs + push
- **Quick-PO preservation**: The legacy direct-to-PO flow (`createPurchaseOrder`, `assignVendorToBoqItem`, `createPOsFromAssignedItems`) is retained for projects that skip RFQs. Both flows coexist on the same `purchase_orders` table — v2 POs simply set `approval_status='pending_approval'` and go through the founder-approval gate.
- `docs/archive/CLAUDE_MD_2026-04-17_ARCHIVED.md` — PO PDF template history, rate inline edit bug fix, Cancel PO soft-delete decision.

## Role Access Summary

| Role              | Access                                                                    |
|-------------------|---------------------------------------------------------------------------|
| `purchase_officer`| Full CRUD on RFQs, quote entry (manual/Excel), item awards, PO creation, send-for-approval, **Send PO to vendor** (Email/WhatsApp/Copy), dispatch lifecycle (Mark dispatched / Record vendor dispatch / Mark received). Cannot approve/reject POs. Full CRUD on `vendor_payments`, `vendors`. |
| `founder`         | Full access. **Sole approver** of POs: sees the pending-approval banner on Tab 4 and can approve / reject with reason. **Founder-authored POs auto-approve on insert** (both quick-PO and competitive paths) and cascade the BOQ flip immediately. Can also override RFQ awards, drive dispatch, and do everything the PE can. |
| `finance`         | Vendor payment approval, MSME compliance tracker, read on POs.            |
| `project_manager` | In practice, the PM doubles as the Purchase Engineer at Shiroi (no dedicated `purchase_officer` user exists). Migration 061 broadened RFQ-family RLS so PM can CRUD RFQs, invitations, quotes, awards, and POs. **Migration 065 (Apr 17) role-matrix update: PM can also drive the dispatch lifecycle and Send-to-vendor** (matching PE). PM still can't approve/reject POs — that's founder-only. Also owns `sendBoqToPurchase` from the project BOQ step and receives the "all materials received" notification. |
| `site_supervisor` | Read-only on PO detail for material receipt context.                      |
| vendor (anonymous)| Token-gated access to `/vendor-portal/rfq/<uuid>` only. Can view their invitation + submit a quote. No auth.                                        |
