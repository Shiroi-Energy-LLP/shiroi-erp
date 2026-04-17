# Zoho Import

One-time backfill of 3 years of Zoho Books data into the Shiroi ERP.
See `docs/superpowers/specs/2026-04-17-finance-module-v2-zoho-design.md` §6.

## Usage

```bash
# dry run all phases
npx tsx scripts/zoho-import/index.ts --phase=all --dry-run

# run a single phase (e.g. phase 6 — project matching)
npx tsx scripts/zoho-import/index.ts --phase=06

# run everything + reconcile
npx tsx scripts/zoho-import/index.ts --phase=all
```

## Phase order

| Phase | File | Description |
|-------|------|-------------|
| 01 | Chart_of_Accounts.xls | → zoho_account_codes |
| 02 | Tax.xls | → zoho_tax_codes |
| 03 | Item.xls | → zoho_items |
| 04 | Contacts.xls | links ERP contacts to Zoho IDs |
| 05 | Vendors.xls | links/creates ERP vendors |
| 06 | Projects.xls | fuzzy-matches → zoho_project_mapping |
| 07 | Purchase_Order.xls | → purchase_orders |
| 08 | Invoice.xls | → invoices |
| 09 | Customer_Payment.xls | → customer_payments |
| 10 | Bill.xls | → vendor_bills + vendor_bill_items |
| 11 | Vendor_Payment.xls | → vendor_payments |
| 12 | Expense.xls (project-tagged only) | → expenses |
| 13 | Credit_Note.xls | → invoice_credit_notes |
| reconcile | — | compare ERP vs Zoho XLS totals |

## Output files

- `docs/zoho-review-queue.csv` — projects needing manual match (0.5-0.85 score)
- `docs/zoho-unmatched-projects.csv` — projects with no match (<0.5 score)
- `docs/zoho-import-report-YYYY-MM-DD.md` — reconciliation report

## Manual project review

After running phase 06, review `docs/zoho-review-queue.csv`. For each row:
1. Open `zoho_project_mapping` table in Supabase
2. Insert a row with `match_method = 'manual'` for each resolved project
3. Then re-run phases 07-13 to pick up those projects' transactions

## Safety

- All phases are idempotent: `ON CONFLICT (zoho_*_id) DO NOTHING`
- `source = 'zoho_import'` prevents sync triggers from enqueuing rows
- Runs against dev Supabase only (actqtzoxjilqnldnacqz)
