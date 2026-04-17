# Purchase Module

> Project-centric procurement. BOQ items with vendor assignments → vendor-wise POs → material receipt → Ready to Dispatch → DC (in projects module).
> Related modules: [projects] (BOQ origin, DC consumption), [finance] (vendor payments, MSME compliance). Cross-cutting references: master reference §7, migration 041.

## Overview

Purchase is driven from the project's BOQ step, not from a standalone PO ledger. When a PM flips BOQ lines to "Send to Purchase" the project appears in the purchase officer's request queue, where vendor assignment happens per-BOQ-item (not per-PO) — so a single project can source panels from Waree, inverter from Sungrow, and cable from a local vendor without any manual PO splitting. A one-click "Create POs" auto-groups assigned items by vendor into separate POs, after which material receipt and "Ready to Dispatch" toggles flow the items back to the PM's delivery-challan step.

## User Flow / Screens

```
/procurement                         ← project-centric purchase request list
/procurement/project/[projectId]     ← per-project detail (vendor assign + create POs + receipt)
/procurement/orders                  ← flat PO list (legacy / audit view)
/procurement/[poId]                  ← PO detail (items, DCs, vendor payments, flag button)
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

- Vendor assignment is **per BOQ item** via `project_boq_items.vendor_id` (migration 041).
- `createPOsFromAssignedItems` auto-groups: one PO per distinct vendor across all assigned items on the project. No manual PO splitting.
- `purchase_order_items.boq_item_id` back-links each PO line to its source BOQ row for Dispatch sync.
- MSME vendors get a 45-day payment SLA — tracked in `vendor_payments`, alert on Day 40 via `/msme-compliance`.
- PO totals compute on save: subtotal + per-rate-band GST split (intra-state Tamil Nadu = 50/50 CGST/SGST) + round-off.
- PO status enum includes `approved` and `cancelled` (migration 041 fixed the constraint). Cancel is a soft delete — no `deleted_at` column on `purchase_orders`.
- Price Book (252 active rows, Manivel's sheet) is the rate source of truth for auto-pricing and PO creation.

## Key Tables

- `purchase_orders` — PO main, 8-status enum including `approved` and `cancelled`
- `purchase_order_items` — line items with `boq_item_id` FK back to `project_boq_items`
- `project_boq_items` — `vendor_id` FK added in migration 041, owns `procurement_status`
- `vendors` — 108+ seeded vendors, MSME flag, GSTIN, category
- `vendor_payments` — per-tranche payments, 45-day MSME SLA clock
- `delivery_challans` — consumed by the projects module DC step (see projects doc)

## Key Files

```
apps/erp/src/app/(erp)/procurement/
  ├── page.tsx                            # project-centric list
  ├── orders/page.tsx                     # flat PO list
  ├── project/[projectId]/page.tsx        # per-project detail
  └── [poId]/page.tsx                     # PO detail

apps/erp/src/app/(erp)/vendors/page.tsx
apps/erp/src/app/(erp)/vendor-payments/page.tsx
apps/erp/src/app/(erp)/msme-compliance/page.tsx
apps/erp/src/app/(erp)/deliveries/page.tsx

apps/erp/src/lib/
  ├── procurement-queries.ts              # list + detail reads
  ├── procurement-actions.ts              # createPurchaseOrder, assignVendorToBoqItem,
  │                                       #   bulkAssignVendor, createPOsFromAssignedItems,
  │                                       #   markItemsReceived, markItemsReadyToDispatch,
  │                                       #   updateProcurementPriority
  ├── procurement-audit.ts                # PO audit trail helpers
  ├── po-actions.ts                       # updatePoLineItemRate (recalcs subtotal+GST+total)
  ├── vendor-queries.ts
  ├── vendor-portal-queries.ts            # public vendor portal reads
  └── vendor-portal-actions.ts            # RFQ / quote submission writes
  (sendBoqToPurchase lives in project-step-actions.ts — origin is the project BOQ step)

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
- `docs/superpowers/specs/2026-04-17-purchase-module-v2-design.md` — V2 design spec (5-tab pipeline: BOQ → RFQ → Comparison → PO → Dispatch).
- `docs/superpowers/plans/2026-04-17-purchase-module-v2-implementation.md` — current V2 implementation plan (RFQ library + vendor portal landed in commits `7106d39` and `0158765`; remaining tabs pending).
- `docs/archive/CLAUDE_MD_2026-04-17_ARCHIVED.md` — PO PDF template history, rate inline edit bug fix, Cancel PO soft-delete decision.

## Role Access Summary

| Role              | Access                                                                    |
|-------------------|---------------------------------------------------------------------------|
| `purchase_officer`| Full CRUD on `purchase_orders`, `purchase_order_items`, `vendor_payments`, `vendors`. Read on projects/BOQ. Vendor assignment + Create POs + Receipt + Ready to Dispatch. |
| `founder`         | Full access across the module + vendor payment approval.                  |
| `finance`         | Vendor payment approval, MSME compliance tracker, read on POs.            |
| `project_manager` | Read-only on `/procurement/[poId]`. Owns `sendBoqToPurchase` from the project BOQ step. |
| `site_supervisor` | Read-only on PO detail for material receipt context.                      |
