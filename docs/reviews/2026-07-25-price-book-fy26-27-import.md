# Price Book — FY26-27 rate card import (2026-07-25)

Source: `Price List - 26-27.xlsx` (Vivek, Desktop) — 214 rows of
`S.No | Category | Item | Make | Unit | Rate | Gst | Vendor`, one sheet.

Script: `scripts/import-price-list-2026-27.ts` (dry-run by default, `--apply` to write).
Applied to **dev only**. Re-running the dry run after apply reports 0 changes (idempotent).

## Result

| | Before | After |
|---|---|---|
| Live `price_book` rows | 235 | 238 |

- **199 rows updated** — `base_price`, `gst_rate`, `unit`, `vendor_name`, `rate_updated_at`, `effective_from = 2026-07-25`. 56 of those were real price movements; the rest re-confirmed the existing rate.
- **12 duplicate rows retired** (`deleted_at` set) — all zero-reference armoured/flexible cable rows duplicated by the April import (`3.5C, 95 sq mm Aluminium Aromoured Cable` vs `3.5C,95 Sq.mm Aluminium Armoured Cable`, etc.).
- **15 rows inserted** — items only in the new sheet.
- **24 live rows left untouched** — IC labour, MMS structures, transport/civil, JKR cable trays, 8-in-8-out DCDBs, and 4 old per-panel seed rows (Waaree/Adani/Trina/Jinko @ 12% GST). The sheet is a vendor *material* rate card and never covered these.

## Matching

The April rows and this sheet describe the same items with different wording, so exact matching alone would have created ~214 duplicates. Three stages:

1. **Exact key** — `(item_category, normalized description, normalized brand)`. Normalization folds `sq.mm`/`sq mm`, `aromoured`/`armoured`, `aluminum`/`aluminium`, `cu`/`copper`, `non dcr`/`ndcr`. → 175 rows.
2. **Fuzzy pairing** — Dice coefficient over word tokens, gated on numeric tokens (one side's numbers must be a sub-multiset of the other's). → 24 more rows.
3. **Duplicate folding** — leftover live rows compared *row-vs-row* (identical numeric tokens + ≥0.85 similarity), not row-vs-sheet.

### Three traps worth remembering

- **Decimals.** Reading numeric tokens off the *normalized* string split `1.5"` into `1` and `5`, which paired `1.5" PVC fisher` with `1" PVC fisher` and `1.5" Star Screw` with `1" SS Star Screw` — different sizes. Numbers are now read off the raw description.
- **Greedy over-collection.** Letting one sheet row claim several live rows collapsed two genuinely distinct DCDBs (`2 In 2 Out … 1000V DC SPD` @₹4,875 and the `2 Nos / Per String one SPD` variant @₹5,285) into one group, retiring the ₹5,285 row. Stage 2 now assigns exactly one live row per sheet row; duplicates only fold in via the stricter stage-3 test.
- **Word overlap ≠ same product.** `4.8 mm thick, 400 mm length SS Cable tie` (₹450, steel) outscored the correct `400 * 4.8 UV rated cable tie` (₹220) against the live `400 mm Length * 4.8 mm Thick UV Rated PVC Cable tie` — it shared more filler words. A penalty now applies per material/spec token present on only one side (`ss`, `uv`, `pvc`, `copper`, `aluminium`, `gi`, `rcc`, `dcr`, `ndcr`, `bifacial`, `topcon`, `spike`, `chemical`, …).

Canonical row for each duplicate group is chosen by FK reference count first (`proposal_bom_lines`, `project_boq_items`, `purchase_order_items`, `price_book_accuracy`) so a row a BOM/BOQ/PO already points at is never the one retired. All 12 retired rows had 0 references. Retirement is a soft delete, so existing references still resolve.

## Decisions taken (Vivek, 2026-07-25)

1. Items absent from the sheet → **keep all as-is**.
2. ₹0 rates in the sheet → **import exactly as written**. 48 sheet rows carry ₹0 (inverter sizes a vendor hasn't quoted). Two live rows were consequently zeroed: Orbit `4 sq mm Copper wire` (₹40 → ₹0) and Orbit `6 sq mm Copper wire` (₹60 → ₹0).
3. Pre-existing duplicates → **dedupe as part of this import**.

## Open items

Two pairings are judgement calls where two sheet rows compete for one live row; both were applied as the scorer ranked them, and the prices are worth a second look:

- **Lightning arrester** — live `17 mm dia one meter copper bonded Spike type LA With base plate` @₹1,450 was updated to ₹880 from the sheet's *spike type* row. The sheet's other arrester (`…rod type … with nylon base and ss spikes` @₹1,430) was inserted as new and sits much closer to the old ₹1,450.
- **Chemical GI rod** — live `40 mm dia , 2 Meter Chemical Filled GI Earth Rod` @₹870 was updated to ₹1,200. The sheet's `Gi 40mm dia 2mtr earthing electrode` @₹870 matches the old price exactly and was inserted as new.

Also unresolved, and untouched by this import: three rows are miscategorised as `solar_panels` — two Feston inverters (`125 KW` / `136 KW`, both ₹0) and a `Incomer : 250A 4P MCCB …` LT panel @₹4.2L.

`Walkway` and `Handrail` sheet categories have no `item_categories` equivalent; both were mapped to `miscellaneous`.
