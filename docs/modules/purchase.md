# Purchase Module

> Project-centric procurement. Two parallel flows on the same `purchase_orders` table:
>   1. **v2 competitive pipeline** (Apr 17) — BOQ → RFQ → Quote Comparison → PO with founder approval → Dispatch lifecycle. Default for v2 projects.
>   2. **Quick PO** (pre-v2, preserved) — direct BOQ → assigned-vendor PO for projects that don't need a competitive RFQ.
>
> Related modules: [projects] (BOQ origin, DC consumption), [finance] (vendor payments, MSME compliance). Cross-cutting references: master reference §7, migrations 041 + 060.

## Overview

Purchase is driven from the project's BOQ step, not from a standalone PO ledger. When a PM flips BOQ lines to "Send to Purchase" the project appears in the purchase officer's request queue (`/procurement`), where the Purchase Engineer (`purchase_officer`) works a 5-tab workspace per project:

1. **BOQ** — finalize items, set price-book rates, flag shortages.
2. **RFQ** — send a UUID-token RFQ to N vendors over Gmail compose or WhatsApp deep-link (no SMTP). Vendors submit via the public portal (no login), or the PE captures the quote manually / by Excel upload.
3. **Comparison** — side-by-side matrix, L1 auto-highlight, per-item award (override requires reason), "Auto-award all L1" bulk action, then "Generate POs" creates one PO per winning vendor.
4. **PO** — founder is the sole approver. PE hits "Send for approval" → founder approves/rejects (with reason). Approved POs are ready to dispatch.
5. **Dispatch** — state-driven: `[Mark dispatched]` (PE sent PO to vendor) → `[Record vendor dispatch]` (vendor shipped with date + tracking) → `[Mark received]` (acknowledged). The Quick-PO / assignment flow is still available for projects that skip RFQs.

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

- **Founder is the sole PO approver** (v2): `purchase_orders.approval_status` flows `draft → pending_approval → approved | rejected`. Rejection requires a reason stored in `approval_rejection_reason`. Approval is guarded server-side in `approvePO` / `rejectPO` — the UI just hides buttons for other roles.
- **Vendor portal is UUID-gated, no auth** (v2): each `rfq_invitations.access_token` is a random UUID. The `/vendor-portal/rfq/<token>` route is excluded from the auth middleware. Tokens expire per `rfq_invitations.expires_at`.
- **Dispatch lifecycle** (v2): `purchase_orders.status` goes `draft → dispatched → acknowledged` after approval. `dispatched_at` = PE sent PO to vendor; `vendor_dispatch_date` + `vendor_tracking_number` = vendor shipped goods; `acknowledged_at` = Shiroi received.
- **Audit log is mandatory** (v2): every mutation in `rfq-actions.ts`, `vendor-portal-actions.ts`, `po-actions.ts` calls `logProcurementAudit(...)` after a successful DB write. 14 user-initiated events + 1 DB-trigger event (GRN completes PO) — see spec §9.
- **Notifications are fire-and-forget** (v2): 6 events (BOQ→purchase, quote submitted, PO sent for approval, PO approved, PO rejected, all materials received) insert into `notifications` inside try/catch so a notification failure never rolls back the primary mutation.
- Vendor assignment is **per BOQ item** via `project_boq_items.vendor_id` (migration 041, preserved for Quick-PO flow).
- `createPOsFromAssignedItems` auto-groups: one PO per distinct vendor across all assigned items on the project. No manual PO splitting.
- `generatePOsFromAwards` (v2) does the same per-vendor grouping from the awarded RFQ matrix.
- `purchase_order_items.boq_item_id` back-links each PO line to its source BOQ row for Dispatch sync.
- MSME vendors get a 45-day payment SLA — tracked in `vendor_payments`, alert on Day 40 via `/msme-compliance`.
- PO totals compute on save: subtotal + per-rate-band GST split (intra-state Tamil Nadu = 50/50 CGST/SGST) + round-off.
- PO status enum includes `approved`, `dispatched`, `acknowledged`, `cancelled`. Cancel is a soft delete — no `deleted_at` column on `purchase_orders`.
- Price Book (252 active rows, Manivel's sheet) is the rate source of truth for auto-pricing and PO creation.

## Key Tables

- `purchase_orders` — PO main. `status` (draft/approved/dispatched/acknowledged/partially_delivered/fully_delivered/closed/cancelled) + `approval_status` (draft/pending_approval/approved/rejected) + `approval_rejection_reason` + `prepared_by` (employee) + `approved_by` (employee) + `dispatched_at`, `vendor_dispatch_date`, `vendor_tracking_number`, `expected_delivery_date`, `acknowledged_at`, `actual_delivery_date`.
- `purchase_order_items` — line items with `boq_item_id` FK back to `project_boq_items`.
- `rfqs` (migration 060) — RFQ header. `status` (draft/sent/comparing/awarded/cancelled), `created_by`, `rfq_number`.
- `rfq_items` (migration 060) — per-RFQ line items; `winning_invitation_id` set on award.
- `rfq_invitations` (migration 060) — one row per (rfq, vendor). `access_token` (UUID) is the vendor-portal key. `status` (pending/sent/viewed/submitted/expired), `sent_via_channels` (array of 'email'/'whatsapp'/'copy_link'), `submission_mode` (vendor_portal/manual/excel).
- `rfq_vendor_quotes` (migration 060) — vendor's submitted line-level prices.
- `procurement_audit_log` (migration 060) — append-only audit trail. `entity_type` + `entity_id` + `action` + `actor_id` + `old_value` + `new_value` + `reason`.
- `project_boq_items` — `vendor_id` FK from migration 041, owns `procurement_status`.
- `vendors` — 108+ seeded vendors, MSME flag, GSTIN, category.
- `vendor_payments` — per-tranche payments, 45-day MSME SLA clock.
- `notifications` — `recipient_employee_id`, `notification_type`, `title`, `body`, `entity_type`, `entity_id`.
- `delivery_challans` — consumed by the projects module DC step (see projects doc).

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
  │       ├── boq-editable-table.tsx
  │       ├── send-rfq-panel.tsx
  │       ├── send-rfq-modal.tsx          # Gmail + WhatsApp deep links per vendor
  │       ├── manual-quote-entry-dialog.tsx
  │       ├── excel-quote-upload-dialog.tsx
  │       ├── comparison-matrix.tsx       # L1 auto-highlight + override-with-reason
  │       ├── po-approval-actions.tsx     # Send / Approve / Reject state-machine buttons
  │       └── dispatch-actions.tsx        # Mark dispatched / Record / Mark received
  └── [poId]/page.tsx                     # PO detail

apps/erp/src/app/vendor-portal/rfq/[token]/
  ├── page.tsx                            # PUBLIC (no auth) — validates UUID, renders form
  └── _client/quote-submit-form.tsx

apps/erp/src/app/(erp)/vendors/page.tsx
apps/erp/src/app/(erp)/vendor-payments/page.tsx
apps/erp/src/app/(erp)/msme-compliance/page.tsx
apps/erp/src/app/(erp)/deliveries/page.tsx

apps/erp/src/lib/
  ├── procurement-queries.ts              # list + detail reads, getEmployeeIdForProfile helper
  ├── procurement-actions.ts              # createPurchaseOrder, assignVendorToBoqItem,
  │                                       #   bulkAssignVendor, createPOsFromAssignedItems,
  │                                       #   markItemsReceived (+ PM notification on all-received),
  │                                       #   markItemsReadyToDispatch, updateProcurementPriority
  ├── procurement-audit.ts                # logProcurementAudit helper
  ├── rfq-actions.ts                      # createRfq, markInvitationSent, submitQuoteManually,
  │                                       #   submitQuoteFromExcel, awardRfqItem, autoAwardL1,
  │                                       #   generatePOsFromAwards, cancelRfq
  ├── rfq-queries.ts                      # RFQ list + detail, getRfqComparisonData,
  │                                       #   getPendingApprovalPOs
  ├── po-actions.ts                       # updatePoLineItemRate, deletePoSoft,
  │                                       #   sendPOForApproval, approvePO, rejectPO,
  │                                       #   markPODispatched, recordVendorDispatch,
  │                                       #   markPOAcknowledged
  ├── vendor-queries.ts
  ├── vendor-portal-queries.ts            # public vendor portal reads (validateToken, etc.)
  └── vendor-portal-actions.ts            # markInvitationViewed, submitQuoteFromPortal
  (sendBoqToPurchase lives in project-step-actions.ts — origin is the project BOQ step,
   and it now notifies all purchase_officer users.)

apps/erp/src/components/procurement/
  ├── create-po-dialog.tsx                # multi-line PO entry with auto-totals
  ├── purchase-detail-controls.tsx        # per-item vendor dropdown, bulk assign, receipt + priority
  ├── po-status-badge.tsx
  ├── po-rate-inline-edit.tsx             # double-click rate cell
  ├── po-download-button.tsx
  └── po-delete-button.tsx                # soft-delete via status=cancelled

apps/erp/src/lib/pdf/purchase-order-pdf.tsx   # Shiroi-branded @react-pdf/renderer template

# API routes:
apps/erp/src/app/api/procurement/[poId]/pdf/route.ts
```

## Known Gotchas

- **PO rate inline edit**: double-click rate in PO detail items table. `updatePoLineItemRate` fetches `quantity_ordered` + `gst_rate`, recalculates `total_price = newRate × qty`, then recalculates PO `subtotal` + `gst_amount` + `total_amount`. Pre-existing bug fixed: use `quantity_ordered` (not `quantity`).
- **Create PO requires**: project + vendor + ≥1 line item. `CreatePODialog` handles dynamic add/remove of lines with auto-totals (subtotal, GST, total recomputed on every change).
- **PO PDF** requires `@react-pdf/renderer` listed in `experimental.serverComponentsExternalPackages` in `apps/erp/next.config.js` (shared with all other PDF routes — see projects module Known Gotchas).
- **"Send to Purchase" from BOQ** is bulk (`yet_to_finalize` → `yet_to_place`) and lives in the project BOQ step, not here. Entry point is `sendBoqToPurchase` in `project-step-actions.ts`.
- **PO cancel** is a status flip to `cancelled`, not a row delete — `purchase_orders` has no `deleted_at` column. The PO stays in the flat list (`/procurement/orders`) with a cancelled badge for audit.
- **Vendor assignment on a received item** should be blocked upstream; the BOQ row is effectively locked once it moves past `ordered`.

## Past Decisions & Specs

- Migration 041 — vendor_id FK on `project_boq_items`, `boq_item_id` on `purchase_order_items`, project-level procurement tracking columns (`boq_sent_to_purchase_at/by`, `procurement_priority`, `procurement_status`, `procurement_received_date`), PO status constraint fix (adds `approved`), indexes + backfill.
- Migration 046 — Price Book expansion (24 categories, vendor_name, default_qty, rate audit columns) — rate source for PO creation.
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
| `purchase_officer`| Full CRUD on RFQs, quote entry (manual/Excel), item awards, PO creation, send-for-approval, dispatch lifecycle (Mark dispatched / Record vendor dispatch / Mark received). Cannot approve/reject POs. Full CRUD on `vendor_payments`, `vendors`. |
| `founder`         | Full access. **Sole approver** of POs: sees the pending-approval banner on Tab 4 and can approve / reject with reason. Can also override RFQ awards and do everything the PE can. |
| `finance`         | Vendor payment approval, MSME compliance tracker, read on POs.            |
| `project_manager` | Read-only on POs + `/procurement/[poId]`. Owns `sendBoqToPurchase` from the project BOQ step. Receives "all materials received" notification when every item lands. |
| `site_supervisor` | Read-only on PO detail for material receipt context.                      |
| vendor (anonymous)| Token-gated access to `/vendor-portal/rfq/<uuid>` only. Can view their invitation + submit a quote. No auth.                                        |
