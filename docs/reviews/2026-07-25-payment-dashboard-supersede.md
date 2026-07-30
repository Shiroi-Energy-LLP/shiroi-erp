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

Combined: ₹40,04,028 PO / ₹22,53,576 received / ₹17,50,452 outstanding still unrepresented.

Matching by `system_size_kwp` (the sheet carries kW per row) resolved these much further than
name-matching alone — four now have a candidate matching the sheet's kW exactly.

| Sheet row | Sheet PO / kW | Best candidate | Situation |
|---|---|---|---|
| **GANESH** | ₹3,63,000 / 5 | `Ganesh` (5.00 kWp, PO ₹0, waiting_net_metering) | 3 candidates; the other two are `completed`, which the sheet's "Material Delivery, due 28-Jul-26" rules out. Recommended. |
| **BABU** | ₹2,43,000 / 4.2 | `Babu` (**4.20 kWp**, PO ₹2,61,323, yet_to_start) | Only 4.2 kWp candidate out of 8. Recommended. Separately: `Mr Rajan Babu` exists **twice** as identical live projects (6.63 kWp, ₹4,37,266) — de-dupe needed, unrelated to this sheet. |
| **CHETTINAD** | ₹4,00,000 / 10 | `Chettinad Grinding Unit` (10.00 kWp, PO ₹5,65,220) | Only live option — `Chettinad Cement` (also 10 kWp) is soft-deleted. ₹1.65 L PO gap: is the sheet tracking the deleted Cement site instead? |
| **NATIONAL SCHOOL** | ₹5,42,182 / 12 | `National School` (15.00 kWp, PO ₹4,97,182) | Only live option — `National School Mayavaram` is soft-deleted. Neither matches on kW (15 vs 12) or PO (₹45,000 apart). |
| **SREEKUMAR** | ₹6,92,971 / 10.8 | `Ramaniyam Sri Kumar` (10.00 kWp, PO ₹6,90,000) | Only candidate in the ERP. PO within ₹2,971 — likely the same project, but the names differ enough to be two customers, and it posts ₹6.46 L. |
| **KARAN VELLORE** | ₹8,00,000 / 16 | `Kiran Vellore` (**16.00 kWp**, PO ₹8,27,632) | kW and surname match exactly; Karan/Kiran is likely a spelling slip. **Soft-deleted** — needs undeleting first. |
| **RAMANIYAM PURNA** | ₹2,82,742 / 5 | `Ramaniyam Purna Krishna` (3.60 kWp, PO ₹0, order_received) | Exists after all (an earlier pass reported none). `order_received` fits a ₹0-collected row; kW disagrees. `Ramaniyam Sridevi` carries the identical ₹2,82,742 PO — possibly two units of one order. Nothing financial at risk (₹0 either way). |
| **S&P - THE ADDRESS** | ₹1,15,133 / 5 | `S&P Signature - Club house` (2.40 kWp, PO ₹1,25,762) | Different building, half the kW. **Most likely a project never created in the ERP** — would need creating before ₹92,091 can be posted. |
| **SRINIVASAN GEEYAM** | ₹5,65,000 / 5 | `Srinivasan Geeyam Ref` (10.00 kWp, PO ₹1,15,565, ₹2,65,000 received) | Messiest of the nine: **soft-deleted 2026-06-22** while the sheet tracks it as live and Closed at ₹5,65,000; PO, received and kW all disagree. Check the actual order first. |

Once these are ruled on, extend the same migration pattern — add the rows to `pd_sheet`, bump the
expected-count guard, and re-run.

## Not addressed

- The sheet's `Next Payment Stage`, `Due Date` and `Status / Remarks` columns were not imported.
  The ERP models these through `proposal_payment_schedule` milestones and the payment-followup task
  trigger, not as free text on the project. Mapping them would need its own design pass.
- Prod is untouched, per the standing dev-only rule.

## Concurrency caveat

Between two passes over the same data during this task, `Ganesh` moved from `order_received` to
`waiting_net_metering` and `Babu`'s `contracted_value` went from ₹0 to ₹2,61,323 — a parallel session
was editing `projects` at the same time. Re-read the figures at the moment of ruling rather than
trusting the snapshots in this document.
