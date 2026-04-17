# Inventory Module

> Thin module — single-table stock ledger (`stock_pieces`) over warehouse/site movements, with cut-length draw-down tracking and a low-stock gauge for cables/conduit.
> Related modules: [purchase] (origin — PO/GRN/DC references), [projects] (destination — project allocation + installation). Migration 006a.

## Overview

Inventory is a thin module — genuinely just one table (`stock_pieces`) with two pages. Every physical item is tracked as an individual row: serialised items (panels, inverters, batteries) by unique serial number; cut-length items (DC/AC cable, conduit) by `original_length_m` → `current_length_m` with a `minimum_usable_length_m` threshold that auto-flags the piece as scrap when crossed. The module surfaces a summary-card dashboard (total / cut-length / low-stock / scrapped), a filterable stock table with inline cut-length gauges, and a detail page with a per-piece tracker for recording cuts, moving locations, and scrapping. Migration 006a also defines warranty/RFQ/work-order/LOI tables but **those are schema-only today** — no UI surfaces them yet.

## Routes

```
/inventory           ← dashboard: 4 summary cards, low-stock alert card,
                       filter bar, stock table with inline cut-length gauge
/inventory/[id]      ← detail: item info, allocation, audit, cut-length tracker
                       (record cut / update location / mark scrap)
```

- **/inventory**: 4 cards (Total Pieces / Cut-Length Items / Low Stock (Cut) / Scrapped) + amber low-stock callout listing up to 5 cut-length pieces below the 2× minimum threshold + sticky filter bar (search / category / location / condition / cut-length-only) + 8-column table (item, category, serial, location, condition, project, cut-length gauge, updated).
- **/inventory/[id]**: 3-column layout — left col has Item Details / Allocation / Audit cards, right col has `CutLengthTracker` with the visual gauge (coloured by state: green → amber below 2× min → red below min / scrapped), inline "Record Cut" form, location dropdown (warehouse / in_transit / on_site / installed / scrapped / returned) + warehouse shelf/bin input, and a "Mark as Scrap" button.

## User Flow

```
PO placed (purchase module)
  → Material receipt (GRN) → stock_pieces row created per item
    (current_location = 'warehouse', condition = 'new',
     purchase_order_id / grn_id / dc_item_id back-refs populated)
  → Allocate to project (allocateToProject) → current_location = 'on_site', project_id set
  → Cut-length draw-down (updateCutLength) → current_length_m reduced
      → if newLength < minimum_usable_length_m → auto-scrap
         (is_scrap = TRUE, condition = 'scrapped', scrapped_at + scrap_reason set)
  → Install (markAsInstalled) → current_location = 'installed',
     installed_at_project_id + installed_at + installed_by set
  → Scrap manually at any time (scrapStockPiece) with reason
```

Low-stock alerts surface on the `/inventory` dashboard only — there is **no notification wiring** (no email, no n8n webhook). The dashboard highlights cut-length pieces where `current_length_m < 2 × minimum_usable_length_m` (client-side filter in `getLowStockCutLengths`).

## Key Tables

- **`stock_pieces`** — the only live inventory table. One row per physical piece.
  - Origin back-refs: `purchase_order_id`, `dc_item_id` (→ `vendor_delivery_challan_items`), `grn_id` (→ `goods_receipt_notes`)
  - Item identity: `item_category` (12-value enum: panel / inverter / battery / structure / dc_cable / ac_cable / conduit / earthing / acdb / dcdb / net_meter / other), `item_description`, `brand`, `model`, `serial_number` (UNIQUE, nullable for non-serialised items)
  - Cut-length fields: `is_cut_length`, `original_length_m`, `current_length_m`, `minimum_usable_length_m`
  - Location: `current_location` (warehouse / in_transit / on_site / installed / scrapped / returned), `project_id`, `warehouse_location` (shelf/bin string)
  - Status: `condition` (new / good / damaged / faulty / scrapped), `is_scrap`, `scrapped_at`, `scrap_reason`
  - Install record: `installed_at_project_id`, `installed_at`, `installed_by`
  - Pricing: `unit_cost NUMERIC(14,2)` from the PO line

Indexes: `item_category`, `current_location`, partial on `project_id WHERE NOT NULL`, partial on `serial_number WHERE NOT NULL`, partial on `is_scrap WHERE TRUE`, partial on `current_location WHERE = 'warehouse'`.

**Schema-only (no UI today):** `warranty_registrations`, `warranty_claims`, `stock_replacement_history`, `price_book_accuracy`, `rfq_requests`, `rfq_responses`, `subcontractor_work_orders`, `letters_of_intent` — all in migration 006a. RFQ got a separate module surface in migration 060 (purchase v2), see `docs/modules/purchase.md`.

## Key Files

```
apps/erp/src/app/(erp)/inventory/
  ├── page.tsx                  # dashboard: cards + low-stock alert + filter bar + table
  └── [id]/page.tsx             # detail: 3-col layout, embeds CutLengthTracker

apps/erp/src/lib/
  ├── inventory-queries.ts      # getStockPieces / getStockPiece / getLowStockCutLengths
  │                             #   / getInventorySummary / getProjectStock
  └── inventory-actions.ts      # updateCutLength / allocateToProject / updateStockLocation
                                #   / scrapStockPiece / markAsInstalled

apps/erp/src/components/inventory/
  └── cut-length-tracker.tsx    # visual gauge + "Record Cut" form + location + scrap button
```

## Business Rules & Gotchas

- **Cut-length auto-scrap is in application code, not a DB trigger.** Despite a misleading comment in `inventory-actions.ts` ("auto-scrap will be handled by DB trigger"), the scrap flip actually happens inside `updateCutLength` — if `newLengthM < minimum_usable_length_m` the same update sets `is_scrap = TRUE`, `condition = 'scrapped'`, `scrapped_at = now()`, and `scrap_reason = 'Cut below minimum usable length (Xm)'`. No DB trigger exists for this today.
- **Cut validation**: `updateCutLength` rejects `newLengthM > current_length_m` (can only shrink) and negative lengths. It does not require the piece to be allocated to a project.
- **Low-stock threshold**: `current_length_m < 2 × minimum_usable_length_m` AND `>= minimum_usable_length_m` (i.e. approaching, not yet below). Client-side filter in `getLowStockCutLengths` — the SQL-level query pulls all active cut-length pieces, then JS narrows.
- **No notification wiring**: low-stock "alerts" are a dashboard card only. No email, no n8n webhook, no reorder suggestion, no assigned owner. If inventory runs dry, someone has to be looking at `/inventory`.
- **Purchase connection is one-way**: `stock_pieces` has FK back-refs to `purchase_orders`, `vendor_delivery_challan_items`, and `goods_receipt_notes`, but **nothing currently creates `stock_pieces` rows automatically from GRN/DC flow** — rows are expected to be inserted at material receipt, but there is no server action in this module that does so. Today's purchase module flips `procurement_status` to `ready_to_dispatch` without populating `stock_pieces` (see `docs/modules/purchase.md`, Status Flow).
- **No BOQ actuals tie-back**: `stock_pieces` does not reference `project_boq_items.id`. Issued-vs-BOQ reconciliation has to go through `project_id` + `item_category` matching, or through the DC/PO path — there is no direct join.
- **Scrap via prompt()**: the detail page's "Mark as Scrap" button uses browser `prompt()` for the reason. Good enough for now, not ideal UX.
- **Allocation side-effect**: `allocateToProject` sets `current_location = 'on_site'` unconditionally. Caller must not use it for warehouse reservation — there is no separate "reserved" state.

## Recent Changes

- **Step 67 (archived CLAUDE.md, pre-restructure)** — `/inventory` dashboard + `/inventory/[id]` detail with cut-length gauge, location/scrap management, low-stock alerts. This is the only feature commit on the module — the schema has been in place since migration 006a (2026-03-29) but the UI was built later as Step 67.

## Related Migrations

- **006a_inventory.sql** (2026-03-29) — the only inventory migration. Creates `stock_pieces` (+ indexes + RLS) plus 8 adjacent tables that are schema-only today (warranty registrations + claims, replacement history, price-book accuracy, RFQ requests + responses, subcontractor work orders, letters of intent). RLS: founder / project_manager / site_supervisor write; finance reads.

## Role Access Summary

| Role              | Access                                                                 |
|-------------------|------------------------------------------------------------------------|
| `founder`         | Full CRUD on `stock_pieces`.                                           |
| `project_manager` | Full CRUD — owns allocation, install marking, scrap.                   |
| `site_supervisor` | Full CRUD — records cuts and location moves at site.                   |
| `finance`         | Read-only — unit cost visibility.                                      |
| `om_technician`   | No direct access to `stock_pieces` (see warranty_claims / replacement flow for post-install). |
