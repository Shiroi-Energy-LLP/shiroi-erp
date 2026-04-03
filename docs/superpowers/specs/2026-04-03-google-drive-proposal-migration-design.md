# Google Drive Proposal Migration — Design Spec

**Date:** April 3, 2026
**Author:** Claude Code
**Status:** Approved (Approach A)

---

## 1. Objective

Migrate 1,353 proposal folders from Google Drive into the Shiroi ERP Supabase database, syncing with the 1,115 existing HubSpot-imported leads. Extract all available structured data (system size, pricing, BOM, panel/inverter specs) from costing spreadsheets inside each folder.

## 2. Source Data

| Year Folder | Folder ID | Proposal Folders | Root Files |
|-------------|-----------|-----------------|------------|
| 2022 ("Proposals 2022") | `1IL-A9w62tJ8leN5_aims89fp10PCf8VN` | 312 | 2 |
| 2023 ("Proposals 2023") | `13HGLU9S2IoMD6fi-GDP0ackKWlgAlkkC` | 339 | 12 |
| 2024-25 ("Proposals 2024/25") | `1wO4Cs95DLlnhgRQZz_T6EqTwM1yZMw7f` | 346 | 28 |
| 2025-26 ("Proposals 2025/26") | `1aNK0rk8ICghMsdo3o_HMqAbnxbunAn_E` | 356 | 9 |
| **Total** | | **1,353** | |

### Folder Structure Patterns

- **Folder names** follow `PV{NNN}/{FY} {CustomerName}` or `PV{NNN}-{FY} {CustomerName}` (e.g., `PV345/25-26 Mr.P.Ramakrishna_Padur`)
- Some folders lack PV numbers (e.g., `Prestige Metropolitan`)
- Inside each folder: mix of `.docx` proposals, `.xlsx` costing sheets, Google Sheets, PDFs, DWGs, photos
- **Master "List All Quotes" sheets** at root of each year are auto-generated folder inventories with no quote data — not useful for extraction
- Many newer folders (2025-26) are empty or only have PDFs/layouts

### Costing Sheet Structure (when present)

Google Sheets or `.xlsx` files with tabs like:
- `{N} KWp` / `BOM {N}kWp` — BOM with columns: Item Description, Unit, Qty, Rate, Amount, GST%, Total Cost
- `Costing sheet` — summary: System Size, Total Cost, Cost Per Watt, Supply Cost, Installation Cost
- `Assumptions` — investment parameters
- `IRR - With Tax Savings` — financial analysis

Key extractable fields from costing tabs:
- System size (kWp)
- Total cost (₹)
- Cost per watt (₹/Wp, with and without tax)
- Supply cost vs installation cost breakdown
- Panel/inverter specs from BOM line items

## 3. Target Schema

### Leads table — update existing or create new

| Field | Source | Notes |
|-------|--------|-------|
| `customer_name` | Folder name parse | Only set on new leads |
| `estimated_size_kwp` | Costing sheet "System Size" | Update if currently null/0 |
| `city` | Folder name parse if location present | Default: Chennai |
| `status` | Infer from context | New leads: `proposal_sent`; won projects keep current status |
| `notes` | Append Drive folder URL + PV number | Never overwrite existing notes |

### Proposals table — update existing or create new

| Field | Source | Notes |
|-------|--------|-------|
| `system_size_kwp` | Costing sheet | Update if richer than current |
| `panel_brand`, `panel_model`, `panel_wattage`, `panel_count` | BOM tab | Extract from panel line items |
| `inverter_brand`, `inverter_model`, `inverter_capacity_kw` | BOM tab | Extract from inverter line items |
| `subtotal_supply` | Costing sheet "Supply Cost" | |
| `subtotal_works` | Costing sheet "Installation Cost" | |
| `total_before_discount` | Costing sheet "Total cost" | |
| `total_after_discount` | Same as total_before_discount | No discount info in sheets |
| `notes` | Append PV number + Drive URL + cost_per_watt | |

### Projects table — update if lead already converted to project

Only update fields that are currently null/0/placeholder:
- `system_size_kwp`, `contracted_value`, `panel_*`, `inverter_*`
- Never overwrite non-null project data from the confirmed-projects migration

## 4. Matching Strategy

Multi-tier cascade to match Drive folders to existing DB leads:

### Tier 1: PV Number Match
- Parse PV number from folder name: regex `PV\s*(\d+)\s*[\/\-]\s*(\d{2}(?:-\d{2})?)`
- Search leads where `notes ILIKE '%PV{number}%'` or `hubspot_deal_id` notes contain the PV
- Search proposals where `notes ILIKE '%PV{number}%'`
- If match found → link to that lead

### Tier 2: Customer Name Exact
- Normalize folder customer name (trim, lowercase)
- Search `leads.customer_name` with case-insensitive match
- Handle common patterns: `Mr.`, `Mrs.`, `M/s.` prefixes; `_` vs space

### Tier 3: Customer Name Fuzzy
- Split on ` - `, `/`, `_` delimiters
- Match any substantial part (>4 chars) against existing lead names
- Reuse `VENDOR_CANONICAL_MAP` approach from existing migration for known name variations

### Tier 4: Create New
- If no match found, create new lead with:
  - `status`: `proposal_sent` (they had a proposal folder)
  - `source`: `referral`
  - `segment`: infer from size (≤15kWp → residential, >15kWp → commercial)
  - `phone`: placeholder `8888{timestamp_suffix}` to avoid collisions
  - `notes`: includes PV number + Drive folder URL

### Deduplication safety
- Before creating any new lead, check that no lead with same PV number already exists
- Track all matches in audit CSV for review

## 5. Sheet Reading Strategy

For each proposal folder:

1. **List files** in folder
2. **Find spreadsheet** — prioritize Google Sheets (`application/vnd.google-apps.spreadsheet`), fall back to `.xlsx`
3. **Get tab names** from spreadsheet metadata
4. **Read costing tab** — look for tabs containing: `costing`, `cost`, `summary`
   - Extract: System Size, Total Cost, Cost Per Watt, Supply/Install split
5. **Read BOM tab** — look for tabs containing: `bom`, `kwp`, `bill`
   - Extract: panel and inverter line items (brand, model, wattage, quantity)
6. **Skip** folders with no spreadsheet — create lead from folder name only

### .xlsx Handling
- Google Sheets API can read `.xlsx` files uploaded to Drive IF they are opened with Sheets
- For native `.xlsx` files not opened in Sheets: download via Drive API and parse with `xlsx` npm package
- Both formats will be supported — some folders (especially 2023) only have `.xlsx` costing sheets with no Google Sheet equivalent

## 6. Execution Plan

Script: `scripts/migrate-drive-proposals.ts`

### CLI Interface
```
npx tsx scripts/migrate-drive-proposals.ts --year 2022 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2022
npx tsx scripts/migrate-drive-proposals.ts --year 2023 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2023
npx tsx scripts/migrate-drive-proposals.ts --year 2024-25 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2024-25
npx tsx scripts/migrate-drive-proposals.ts --year 2025-26 --dry-run
npx tsx scripts/migrate-drive-proposals.ts --year 2025-26
```

### Per-Year Processing
1. **Scan** — list all folders in year folder, parse names
2. **Load DB state** — fetch all existing leads, proposals, projects (for matching)
3. **Read sheets** — for folders with spreadsheets, read costing/BOM data
4. **Match** — run the 4-tier cascade for each folder
5. **Sync** — update matched records OR create new ones
6. **Report** — generate audit CSV + console summary

### Output Per Run
- Console: progress + summary (matched, updated, created, skipped, errors)
- CSV: `scripts/data/drive-migration-{year}-audit.csv` with columns: folder_name, pv_number, match_type, matched_lead_id, action_taken, system_size, total_cost

## 7. Idempotency

- Check `notes ILIKE '%drive.google.com/drive/folders/{folderId}%'` before creating duplicates
- If a lead/proposal already has the Drive folder URL in notes → skip (already migrated)
- Updates are additive (append to notes, fill null fields) — never destructive

## 8. What NOT to Do

- Do NOT upload files (PDFs, photos, DWGs) to Supabase Storage — that's a separate future task
- Do NOT read `.docx` proposal content — too unstructured for automated extraction
- Do NOT create projects for proposals that were never won — only update existing projects
- Do NOT overwrite data from the confirmed-projects migration (which has richer operational data)
- Do NOT attempt to parse `.docx` Word files — only spreadsheets (Google Sheets + `.xlsx`)

## 9. Expected Outcomes

| Metric | Estimate |
|--------|----------|
| Folders scanned | 1,353 |
| Matched to existing leads | ~400-600 (based on 1,115 existing leads vs 1,353 folders, with overlap) |
| New leads created | ~700-900 |
| Proposals enriched with pricing | ~300-500 (folders with costing sheets) |
| Projects enriched | ~100-200 (subset of matched that are already projects) |
| Empty/skip folders | ~200-300 (no spreadsheet, folder name only) |

## 10. Dependencies

- Service account key: `C:\Users\vivek\Downloads\shiroi-migration-key.json`
- `googleapis` npm package (already installed)
- Supabase admin client via `.env.local`
- Migrations 011 + 012 applied (already done)
