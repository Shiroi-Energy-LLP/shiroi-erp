# Payment Dashboard supersede — 2026-07-25

Source: `Payment Dashboard.xlsx`, Google Drive, owner `prem@shiroienergy.com`, modified 2026-07-25.
Applied by migration `214_2026-07-25-payment-dashboard-supersede.sql` (dev only).

## Decision taken

Vivek ruled: **scoped supersede on the sheet's projects only**, and **the sheet wins** wherever it
disagrees with the ERP figure.

The literal reading ("supersede whatever is already in the database") was rejected because the sheet
covers 35 projects / ₹2.81 Cr while the ERP holds 481 invoices (₹74.7 Cr) and 1,160 customer payments
(₹70.4 Cr) across 501 projects — 1,078 of those payments being `zoho_import` rows back to March 2023.
A literal wipe would have destroyed the Zoho Books ledger for 466 projects the sheet says nothing about.

## What was applied

26 of 35 sheet rows mapped 1:1 to an active project by `customer_name`. For each:

- `projects.contracted_value` set to the sheet's PO Value.
- The difference between the sheet's Total Received and the ERP's total was posted as a **single
  dated counter-entry** in `customer_payments` (receipt `PD-ADJ-20260725-<row>`, `payment_date`
  2026-07-25, `source='erp'`, `erp_recorded=true`).

No `UPDATE` or `DELETE` was issued against `customer_payments` — Tier-3 immutability holds and every
adjustment is individually reversible.

**Result:** 20 counter-entries, net −₹3,30,189 (+₹24,13,474 added, −₹27,43,663 reversed).
All 26 projects now match the sheet exactly on both PO and received. Combined outstanding: ₹1,15,52,166.

### Pre-flight checks that made this safe

- No `CHECK` constraint on `customer_payments.amount` → negative counter-entries are legal.
- None of the 26 projects has a channel-partner lead with a non-zero commission, so
  `trg_create_consultant_payout_on_customer_payment` was a **no-op** for every inserted row. No
  spurious `consultant_commission_payouts` were created.
- The migration aborts (`RAISE EXCEPTION`) if the name mapping ever resolves to other than exactly
  26 unique projects, so a re-run against drifted data fails closed rather than half-applying.

## Material reversals — worth a second look

Seven projects had the ERP recording **more** collected than the sheet. Applying "sheet wins" reversed
₹27.4 lakh of Zoho-recorded collections:

| Project | ERP (Zoho) | Sheet | Reversed |
|---|---:|---:|---:|
| Prestige Hill Crest | ₹85,80,584 | ₹74,28,225 | −₹11,52,359 |
| S&P Courtyard | ₹9,95,303 | ₹0 | −₹9,95,303 |
| DRA - Skylanties | ₹5,48,380 | ₹3,50,000 | −₹1,98,380 |
| Newry Adora | ₹8,24,493 | ₹6,74,493 | −₹1,50,000 |
| Lancor Bagya | ₹2,38,959 | ₹1,07,827 | −₹1,31,132 |
| DRA - Trinity | ₹3,64,489 | ₹2,58,000 | −₹1,06,489 |
| 4Bricks - RBI colony | ₹1,45,882 | ₹1,35,882 | −₹10,000 |

S&P Courtyard is the one to check first: the sheet shows ₹0 received against a ₹12 L PO, while Zoho
recorded ₹9,95,303. That pattern reads more like the sheet's "Total Received" column being incomplete
for these rows than like Zoho being wrong. If that turns out to be the case, delete the corresponding
`PD-ADJ-20260725-*` rows to restore the Zoho figure — that is the whole reason the change was written
as counter-entries.

## Open items — 9 rows NOT applied, need Vivek's ruling

These were left untouched because applying them would post money against a guessed customer.

| Sheet row | Sheet PO / kW | Situation |
|---|---|---|
| **GANESH** | ₹3,63,000 / 5 | 3 candidates: `Ganesh` (yet_to_start, PO 0), `M/s Latha Ganesh` (₹3,50,283, completed), `Ramaniyam Ganesha` (PO 0, completed). Sheet's next stage is Material Delivery (due 28-Jul-26), which fits the `yet_to_start` one. |
| **BABU** | ₹2,43,000 / 4.2 | 8 candidates (`Babu`, `Mr Babu Govindarajan`, `Mr. Ramesh Babu 3.3 Kw`, `Rajan babu`, `Mr Rajan Babu` ×2, `Mr. Ramesh Babu TVS Hamlet`, `Suresh Babu ECR`). None has a PO near ₹2,43,000. Note `Mr Rajan Babu` appears twice — a duplicate project row. |
| **CHETTINAD** | ₹4,00,000 / 10 | `Chettinad Cement` (PO 0) vs `Chettinad Grinding Unit` (₹5,65,220). Neither matches. |
| **NATIONAL SCHOOL** | ₹5,42,182 / 12 | `National School` (₹4,97,182) vs `National School Mayavaram` (₹7,33,457). Neither exact; the first is closer. |
| **SREEKUMAR** | ₹6,92,971 / 10.8 | Nearest is `Ramaniyam Sri Kumar` (₹6,90,000) — plausible but the name differs enough to be a different customer. |
| **KARAN VELLORE** | ₹8,00,000 / 16 | Nearest is `Kiran Vellore` (₹8,27,632). Karan vs Kiran — likely the same project, needs confirming. |
| **RAMANIYAM PURNA** | ₹2,82,742 / 5 | No candidate in the ERP at all. Note `Ramaniyam Sridevi` has the identical PO (₹2,82,742) — possibly a second unit of the same order that was never created as a project. |
| **S&P - THE ADDRESS** | ₹1,15,133 / 5 | Only near match is `S&P Signature - Club house` (₹1,25,762) — different building. Likely a missing project. |
| **SRINIVASAN GEEYAM** | ₹5,65,000 / 5 | `Srinivasan Geeyam Ref` exists but was **soft-deleted 2026-06-22** (`deleted_at` set). Sheet shows it Closed with ₹5,65,000 fully received. Needs undeleting before any figure can be posted. |

Once these are ruled on, extend the same migration pattern — add the rows to `pd_sheet`, bump the
expected-count guard, and re-run.

## Not addressed

- The sheet's `Next Payment Stage`, `Due Date` and `Status / Remarks` columns were not imported.
  The ERP models these through `proposal_payment_schedule` milestones and the payment-followup task
  trigger, not as free text on the project. Mapping them would need its own design pass.
- Prod is untouched, per the standing dev-only rule.
