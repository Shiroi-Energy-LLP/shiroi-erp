# Zoho Books Audit — Shiroi Energy LLP (2026-10-21)

> **Scope:** Full read-only audit of Zoho Books org `60026510534` (Shiroi Energy LLP), plus the ERP ↔ Zoho link.
> **Method:** I pulled every module through the Zoho Books API using **GET requests only**. Nothing was created, edited or deleted in Zoho. Altogether that was ~320 calls. The data covers 2,941 bills, 3,003 vendor payments, 5,993 expenses, 1,643 journals, 607 invoices, 1,309 receipts, 1,643 POs, 707 contacts, 1,055 items, 325 projects and 255 accounts. It also includes the Balance Sheet and P&L for FY24-25, FY25-26 and FY26-27 YTD, bank-feed status per account, and invoice detail for all 171 B2B invoices since 1-Apr-2025.
> **Every fix below is a proposal.** Nothing gets changed in Zoho until Vivek approves it item by item (see §6).
> Companion: accounts-team operating guide → [`docs/guides/zoho-books-accounts-guide.md`](../guides/zoho-books-accounts-guide.md).

---

## 1. Verdict

The books are **kept up to date but not kept correct.** Day-to-day entry is fast: FY26-27 bills are entered with a median lag of 3 days, and the UCO WC bank feed is imported up to yesterday. The real problem is that transactions are entered and never *closed out*:

- receipts are not applied to invoices
- vendor advances are not adjusted against bills
- GST ledgers are not set off
- bank lines get excluded without review
- nothing is tagged to a project

The result is a Balance Sheet carrying **₹23 Cr in "Prepaid Expenses"** and **₹18.8 Cr in "Unearned Revenue"** that are really unmatched entries. A **FY26-27 YTD profit of ₹9.74 Cr** (39% net margin) is almost certainly overstated. There is also an **e-invoicing gap of ₹6.87 Cr**, and the ERP cannot do project costing from Zoho at all.

| Area | Grade | One-line reason |
|---|---|---|
| Timeliness of entry | 🟢 B+ | Bills median 3 days, UCO WC feed current |
| Receivables (AR) | 🔴 F | ₹17.4 Cr of receipts never applied; overdue list is fiction |
| Payables (AP) / vendor advances | 🔴 F | ₹23.8 Cr of vendor payments unadjusted (₹22.1 Cr Ritechoice) |
| GST compliance | 🔴 D | 18 B2B invoices / ₹6.87 Cr without IRN; GST ledgers never set off since 2024 |
| Bank & cash | 🟠 C | UCO WC current, but 122 excluded lines, dormant accounts open, ₹5.89L "petty cash" |
| Chart of accounts | 🔴 D | 255 accounts, 91% uncoded, ~50 person-named ledgers, misclassified types |
| Project tagging (ERP link) | 🔴 F | 0 of 5,993 expenses and 277 of 607 invoices have no project |
| Masters (customers / vendors / items) | 🟠 C | 374 of 388 customers have no phone/email; 34 duplicate items; 44 vendors without PAN |
| Year-end discipline | 🟠 C− | No depreciation since FY24-25; ₹3.55 Cr Closing WIP never reversed; ₹15L FY21-22 advance tax still open |
| ERP ↔ Zoho sync | 🔴 F | ERP finance data frozen at 16-Apr-2026; live sync built but never switched on |

---

## 2. Critical findings (money and compliance)

### C1. E-invoicing: ₹6.87 Cr of B2B invoices have no IRN
Shiroi's FY25-26 turnover was ₹17.4 Cr. Above ₹5 Cr, e-invoicing is **mandatory** for every B2B invoice. Above ₹10 Cr, the invoice must be reported to the IRP **within 30 days** of its date.

Of the 171 B2B invoices since 1-Apr-2025:
- **153** have an IRN
- **13** are "Yet To Be Pushed"
- **5** "Failed"

| Status | Invoice | Date | Customer | ₹ |
|---|---|---|---|---|
| Failed | SE/SAL/2627/113 | 30-Sep-26 | Megagrid Voltares Bharat | 6,07,76,834 |
| Failed | SE/SAL/2627/056 | 05-Aug-26 | Accord Foundations | 15,85,654 |
| Failed | SE/SAL/26-27/053 | 01-Aug-26 | Kanishkaa Foundation | 6,25,000 |
| Failed | SE/SAL/2627/020 | 18-May-26 | RCC E-Construct | 1,55,168 |
| Failed | SE/SAL/2627/010 | 06-May-26 | Ramaniyam Realtors LLP | 3,45,861 |
| Not pushed | /115, /116, /117, /118, /119, /121, /122, /125 | 05–16 Oct-26 | Shri Chaitanya, Jain Housing, Solverminds, Ramaniyam ×2, Aanirudh ×3 | 34,76,216 |
| Not pushed | /013, /014, /016, /018, /019 | 14–18 May-26 | Ramaniyam, Lancor ×2, Jain Housing, RCC | 17,60,466 |

There are also two **probable duplicates**, each a pair with the same customer, date and amount:
- /019 and /020 (RCC, ₹1,55,168 each)
- /121 and /122 (Aanirudh, ₹41,760 each)

**Impact:** an invoice without an IRN is not a valid tax invoice. The customer cannot claim ITC on it, Shiroi faces penalties (₹10,000 per invoice, or 100% of tax), and the customer has a reason not to pay. The Megagrid ₹6.08 Cr invoice alone carries roughly ₹30L or more of GST.

**Fix:**
1. **Today:** push the 8 October invoices (still inside 30 days). Read the 5 "Failed" errors (usually GSTIN, HSN or pincode) and correct them.
2. For May–Sep invoices past the 30-day window, the **CA decides**: cancel the invoice in Zoho, then re-issue it under a new number and date.
3. Void whichever of /019–/020 and /121–/122 is the duplicate.
4. Make it routine: **no B2B invoice is sent to a customer until its e-invoice status is "Pushed".** Run a daily check on Invoices → filter "E-Invoice: Yet to be pushed / Failed".

### C2. ₹17.4 Cr of customer receipts never applied to invoices
- 141 receipts (₹17.37 Cr) sit as "unused" customer advances. **98 of them (₹13.65 Cr) are over 90 days old.**
- The Balance Sheet shows Unearned Revenue of ₹18.80 Cr *and* Accounts Receivable of ₹9.85 Cr **at the same time**.
- Megagrid alone: receipts of ₹85.15 Cr against invoices of ₹79.59 Cr. ₹13.09 Cr of receipts are unapplied, yet ₹8.96 Cr of Megagrid invoices still show "unpaid".
- 81 customers carry unused credits. The "70 overdue invoices (₹69L)" list is unreliable, because many of those customers have unapplied money sitting in their account.
- 1,090 of 1,309 receipts have no reference (UTR / cheque number), and only 11 have the bank advice attached.

**Impact:** customer statements, overdue reminders and ageing are all wrong. Collections staff chase people who have already paid, and the ERP cash-position view inherits the error.

**Fix:**
- Customer by customer, starting with Megagrid, Coromandel, Radiance, Jain Housing and VGK: open the customer → *Apply credits* → apply each advance to its invoice(s).
- Where a receipt is a genuine advance for a future invoice, leave it, but **tag it to the project**.
- From now on, every receipt is recorded **against the invoice** (Record Payment from the invoice). It is booked as an "advance" only when no invoice exists yet, and in that case it is applied the same day the invoice is raised.
- Always fill in the UTR.

### C3. ₹23.8 Cr of vendor payments never adjusted against bills (Ritechoice: ₹22.1 Cr)
- 111 vendor payments (₹23.80 Cr) are unapplied. Zoho parks these in **Prepaid Expenses (₹22.95 Cr on the Balance Sheet)**.
- **Ritechoice Foundation & Engineering:** 333 payments totalling ₹59.57 Cr since Sep-2023. Only **4 bills (₹32.33 Cr)** are booked, leaving **₹22.11 Cr unadjusted**.
- In addition, Ritechoice exists as a *GL account* with a credit balance of −₹1.75 Cr, so the party is split across two ledgers.
- Other vendors with unadjusted advances: Electrovast ₹54.6L, Sunbridger ₹52.1L, Southern Power Source ₹30.1L, Solargencia ₹9.3L, Welcome Engineers ₹7.9L.

**Impact:** if Ritechoice supplied ~₹22 Cr of EPC work for the Megagrid project, that cost is **missing from the P&L**. That is the most likely reason FY26-27 YTD shows ₹9.74 Cr profit on ₹24.76 Cr revenue. The GST input on those missing bills is also probably unclaimed (a real cash loss), and TDS u/s 194C on contractor payments needs checking.

**Fix:**
- Get Ritechoice's ledger and a confirmation of balance.
- Book all their outstanding tax invoices in Zoho as bills (with project tag and ITC), then apply the payments.
- If any part is a loan or pass-through rather than a purchase, the CA reclassifies it with a documented journal.
- Merge the "Ritechoice" GL account into the vendor ledger.
- Repeat the exercise for the 5 other vendors listed above.

### C4. GST ledgers never set off since 2024
- Output CGST ₹1.53 Cr, Output SGST ₹1.53 Cr, Input CGST ₹1.90 Cr, Input SGST ₹1.89 Cr have all been accumulating since the org was created (Jan-2024).
- GST is paid by booking an **Expense** (₹1.08 Cr) against the "GST Payable" account, rather than through Zoho's GST filing / set-off.
- "GST Payable" itself is −₹3.1L. There are stray "Input IGST 12% / 5% / @18%" accounts sitting under **liabilities**, and a "Reverse Charge Tax Input but not due" balance of ₹1.85L.
- Two taxes named "CGST 18%" and "SGST 18%", **each at 18%**, are active. If someone picks them, the bill or invoice is taxed at 36%.

**Impact:** the books cannot be tied to GSTR-3B. ITC actually claimed vs ITC in the books is unknown, and so is any excess or short payment.

**Fix:**
- For each month, pass a set-off journal (Dr Output CGST/SGST/IGST, Cr Input CGST/SGST/IGST, Cr GST Payable for the cash paid) that matches the filed GSTR-3B. The CA should do the back-months in one sitting.
- Reconcile Input with GSTR-2B every month (Zoho GST module → "Reconcile").
- Pay GST by clearing "GST Payable", not by raising an Expense.
- Deactivate the two 18% CGST/SGST taxes and the "Input IGST x%" liability accounts.

### C5. Bank and cash
| Account | Book balance | Last statement imported | Excluded lines |
|---|---|---|---|
| UCO BANK WC 0908 | −₹2,31,06,497 | 20-Oct-2026 ✅ | **87** |
| UCO LOAN A/C 8548 | −₹59,08,885 | 10-Sep-2026 | 0 |
| UCO BANK CC 3497 | ₹5,50,001 | 12-Oct-2026 | 0 |
| SBI BANK CC 6362 | ₹1,76,636 | 28-Sep-2026 | 2 |
| SBI BANK WC 9724 | −₹1,75,447 | **15-Jul-2025** | **35** |
| ICICI 7495 | ₹0 (inactive) | 12-Jul-2024 | 4 |
| Petty Cash | **₹5,89,189** | — | — |

- SBI WC 9724 was the main account until July 2025 (689 receipts, 1,524 vendor payments), but has had no entries since. It still carries −₹1.75L, so the account was either closed without reconciliation or it is still in use and not being recorded.
- **"Excluded" bank lines are invisible to the books.** The 122 excluded lines on the two WC accounts need a reviewer's sign-off.
- A ₹5.89L petty-cash balance is not credible for a site-imprest business. It is almost certainly unrecorded spends.

**Fix:**
- Reconcile every active bank account monthly (Banking → Reconcile) and keep the reconciliation report.
- Confirm SBI WC 9724's real status with the bank, reconcile it to zero, then mark it inactive.
- Review every excluded line.
- Do a physical petty-cash count and book a journal for the difference, approved by Vivek.
- The UCO loan should also be reconciled against the loan statement (interest and principal split).

### C6. Expenses: no project, wrong module, possible duplicates
- **0 of 5,993** expenses carry a project or customer. Site spends cannot be costed to a job from Zoho.
- The Expense module is used for things that are not expenses: salary payments (568 entries, ₹2.22 Cr to "Salary Payable"), GST (₹1.08 Cr), TDS (₹58L), partner remuneration (₹1.07 Cr), advance tax (₹15L).
- 142 groups of entries share the same date, amount, account and description (₹14.6L in total). These are probable duplicates that need eyeballing.
- 2,458 expenses have no receipt attached. Only 1 expense records a vendor, so GST input on expenses is not traceable to a GSTIN.

**Fix:**
- Make "Project" mandatory on every expense (Settings → Preferences → Expenses → make the field mandatory).
- Pay statutory dues and salaries through the proper route: a *Journal*, or the bank categorisation "Transfer to account / Payment of liability". The Expense module is not the place for them.
- Have the duplicates list reviewed (I can produce it on request).
- Any expense with GST must carry the vendor and GSTIN.

---

## 3. Structural findings

### S1. Chart of accounts is unusable for MIS
- **255 accounts, 232 with no code.**
- **~50 person-named ledgers:** 17 "Site Advance – <name>", 13 "Salary Advance – <name>", 19 "Staff Advance – <name>". These are split across *two* account types (Other Current Asset vs Other Asset). "Staff Advance – Satyaraj" sits under **liabilities**.
- **Parties booked as GL accounts instead of contacts:** Ritechoice, Megagrid Private Limited, Megagrid Voltares Bharat (₹1.04 Cr), S.P Bajaj Enterprises, COSMIX, Professional Couriers, Sujan Enterprises, GD Builders, Sriram Gurunathan-Labours.
- **Duplicates:** Bank Charges / Bank Fees and Charges; Depreciation Expense / Depreciation and Amortisation / Depreciation – Furniture; Petrol & Diesel / Fuel/Mileage; Transport Charges / Transport Charges with GST; Purchase / Material Purchase / Purchase GST @5/12/18/28% / IGST Purchase @12/28% / COGS → Materials.
- **Wrong types:**
  - **Purchases are booked as Operating Expense instead of COGS.** "Purchase GST @18%" alone was ₹7.83 Cr in FY25-26, so the P&L shows an 82% gross margin, which is meaningless.
  - Salaries, Rent, Travel, Insurance and Interest are typed "Other Expense" (non-operating), which wrecks operating profit.
  - "State Bank Of India" sits under Current Liabilities.
- **Suspense-type accounts:** "Uncategorized", "Suspense A/c", "Opening Balance Adjustments", "Dimension Adjustments". These are not used today, but they are not locked either.

**Fix:** adopt the coded CoA in the guide (§4 of the guide: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx direct costs, 6xxx overheads).
- Purchase / material accounts merge into **5100 Materials (COGS)**. The GST rate is captured by the *tax*, not the account.
- Person-named advances collapse into **one control account per type** (Site Imprest, Staff Advance, Salary Advance), with the person recorded as the *contact / reporting tag*.
- Party accounts become contacts.
- Duplicates are merged: deactivate the extra, then transfer the balance by journal.

This is a CA-supervised exercise. Do it at a month-end, with Vivek's sign-off.

### S2. Stale balances and year-end gaps
| Item | Balance | Issue |
|---|---|---|
| Closing WIP (Other Asset) | ₹3,54,52,350 | Booked FY24-25 and never reversed or rolled forward. FY25-26 profit is distorted by it. |
| Advance Tax FY 2021-22 | ₹15,00,000 | Never set off against the FY21-22 tax provision |
| TDS Receivable | ₹33,18,545 | Not matched to Form 26AS |
| Service Tax Receivable | ₹76,015 | Pre-GST leftover. Write off. |
| Retained Earnings (LLP) | ₹3,98,08,089 | FY25-26 profit not transferred to partners' current accounts |
| Depreciation | ₹5.68L in FY24-25, **nil since** | FY25-26 and FY26-27 not booked |
| Sundry Balances Write-off | ₹85.1L (FY24-25) + ₹10.7L (FY25-26) | A symptom of party ledgers never being reconciled |
| Opening-balance date | 01-Apr-2023 | Org created Jan-2024. Check the opening TB was signed off. |

**Fix:** a one-time year-end clean-up with the CA, then the month-end checklist in the guide.

### S3. Related-party and personal balances
| Ledger | Balance | Used as "paid through" |
|---|---|---|
| C.K. Sridhar | ₹65,61,004 (asset) | 19 vendor payments, 38 expenses |
| Sujatha Loan Related Party | ₹56,26,157 (asset) | 34 vendor payments |
| Vivek | ₹20,69,922 (asset) | 71 vendor payments, 46 expenses |
| VEL Ventures Loan | ₹17,75,000 (asset) | — |
| Sirisha Govind | ₹9,63,164 (asset) | — |
| K.S Vinodh Loans & Advances | **−₹13,95,615** (debit balance inside a liability) | 97 vendor payments, 3 customer receipts |
| Partners' current accounts | K.S. Vinodh ₹91.3L, Sirisha G ₹1.20 Cr | 30 vendor payments |

Customer money was received into an individual's loan ledger in 3 cases. Vendor payments are routed through 8 individual ledgers.

**Fix:**
- Get a balance confirmation for each, plus a loan agreement where it is a loan, and disclose them as related-party transactions.
- From now on, company payments go **only** through company bank, cash or imprest accounts. If a partner pays out of pocket, record it as one journal: Dr expense or vendor, Cr Partner current account.

### S4. Masters
- **Customers:** 374 of 388 have no phone or email (statements and reminders are impossible). There are 5 duplicate customers (e.g. "Aanirudh Engineering" ×2 under the same GSTIN, "Raksha's Enterprises" / "Rakshas Enterprises", "Sri Krishna Sweets" ×2). The same GSTIN appears on 2 different customers 3 times. One GSTIN is invalid ("ADPS TRUST – CYNERGY WATTMON": 33AAATA0037B11O).
- **Vendors:** 44 have no PAN, so TDS cannot be deducted or reported correctly.
- **Items:** 34 duplicate items (trailing dot or case differences), 72 sellable items without HSN/SAC, 214 without a category, 261 inactive.
- **Users:** 4 of 5 users are Admin, 3 of them on personal Gmail addresses. "sakthivel accounts" authored 545 records and no longer appears in users; confirm the login is deactivated. Nobody should be Admin except Vivek and the CA.

### S5. Process hygiene
- 606 of 607 invoices were never emailed from Zoho, payment reminders are **disabled**, and no salesperson is set on any invoice.
- Number series: sales orders use the same **SE/SAL/2627/nnn** series as invoices (SO SE/SAL/2627/016 and invoice SE/SAL/2627/016 both exist). There are also stray formats such as SE/SAL/26-27/053 and SE/SAL/2526/142A.
- 43 draft POs, plus 43 open POs older than 1-Jul-2026 worth ₹6.25 Cr, need to be closed or billed.
- Payment reminders and customer portal: off.

---

## 4. ERP ↔ Zoho link findings

| # | Finding | Evidence |
|---|---|---|
| E1 | **ERP finance data is frozen at 16-Apr-2026.** The live sync (mig 204, `zoho-sync` edge fn, n8n wf 63) is built but **never run**: all 12 `zoho_sync_state` rows say "never". | Since then Zoho has gained 129 invoices, 228 receipts, 623 bills, 566 vendor payments and 877 expenses that the ERP doesn't have. |
| E2 | **No shared project key.** Zoho has 325 projects coded `SE26-nnn`; the ERP has 663 coded `SHIROI/PR/…`. Only 141 are mapped (`zoho_project_mapping`). | 277 of 607 Zoho invoices have no project; 43 of 171 recent B2B invoices have untagged lines; 0 expenses are tagged. ERP: 303 invoices and 741 payments pending attribution; 1,403 of 2,336 bills have no project. |
| E3 | **Voucher double-entry risk.** 1,169 approved ERP vouchers are not in Zoho, while accounts separately books the same site spends in Zoho through the "Site Advance – <name>" accounts (≈2,700 expenses paid through imprest ledgers). | Switching on the voucher push as-is would double-book site expenses. |
| E4 | **The voucher push design assumes one paid-through account** (`ZOHO_PAID_THROUGH_ACCOUNT_ID`). Shiroi runs per-person imprest. | Needs an employee → imprest-account mapping before go-live. |
| E5 | Bills post to Inventory Asset / Finished Goods with a project on the line (good). But invoices for the same project often carry no project, so project P&L in Zoho is one-sided. | Spot check: 4 of 6 recent bills fully tagged; customer invoices often not tagged. |

**Fix (ERP side, needs Vivek's go-ahead):**
1. Make the **ERP project number the Zoho project's "PROJECT CODE"**. When a project is created in the ERP, create the Zoho project with the same code. That's a one-time back-fill of the 325 existing projects into `zoho_project_mapping`.
2. **One entry point per document type:**

   | Document | Entered in | Synced |
   |---|---|---|
   | Site vouchers | ERP | → Zoho |
   | Customer invoices, receipts, bills, vendor payments | Zoho | → ERP |

   Accounts must stop keying site vouchers in Zoho from the go-live date.
3. Add `employees.zoho_imprest_account_id` so each pushed voucher lands in that person's Site Imprest account.
4. Go-live sequence: clean-up items C2 and C3 → set the secrets (`ZOHO_PULL_SINCE=2026-04-17`) → pull only for 2 weeks → reconcile → enable the voucher push.
5. Weekly reconciliation report (ERP vs Zoho per project: invoiced, received, billed, paid, expenses). This matches the two-way-sync intent in the 2026-07-16 spec, which needs revising for E3 and E4.

---

## 5. What's done well
- Bills and vendor payments are entered promptly. FY26-27 bills have a median lag of 3 days; 90% are entered within 25 days.
- 94% of bills have the vendor invoice attached, and ITC eligibility is marked on bill lines.
- The UCO WC feed is imported to 20-Oct and only 1 line is uncategorised.
- Every journal has a narration, and monthly salary-payable journals are consistent.
- 153 of 171 B2B invoices since Apr-2025 were e-invoiced correctly. The process exists; it just isn't followed every time.

---

## 6. Proposed changes in Zoho — awaiting Vivek's approval
*Nothing below has been done. Approve item by item. Each line names who would do it.*

| # | Change | Who | Urgency |
|---|---|---|---|
| A1 | Push the 8 October B2B e-invoices; fix and retry the 5 failed ones | Accounts | **This week** |
| A2 | CA decision on the 10 expired-window invoices (cancel and re-issue) and on the /019–/020 and /121–/122 duplicates | CA | This week |
| A3 | Apply customer advances to invoices (Megagrid first) | Accounts + CA | 2 weeks |
| A4 | Ritechoice ledger confirmation → book missing bills → apply ₹22.1 Cr of payments; same for the 5 other vendors | Accounts + CA | 2 weeks |
| A5 | GST set-off journals for all months since Jan-2024, tied to filed GSTR-3B; deactivate the CGST 18% / SGST 18% taxes | CA | 1 month |
| A6 | Reconcile all bank accounts, review the 122 excluded lines, close SBI WC 9724 and ICICI, petty-cash count | Accounts | 2 weeks |
| A7 | Year-end clean-up: Closing WIP, depreciation, advance tax FY21-22, TDS 26AS match, Service Tax write-off, partner profit transfer | CA | 1 month |
| A8 | Related-party confirmations; stop routing payments through personal ledgers | Vivek + CA | 1 month |
| A9 | Chart-of-accounts restructure (coded CoA from the guide) | CA, at a month-end | 6 weeks |
| A10 | Masters clean-up: merge duplicate customers and items, add PAN / contact details / HSN, fix the invalid GSTIN | Accounts | 1 month |
| A11 | Users: downgrade everyone except Vivek and the CA from Admin; move to @shiroienergy.com logins; confirm ex-staff are deactivated | Vivek | This week |
| A12 | Settings: make Project mandatory on invoices, bills and expenses; enable payment reminders; separate SO number series (e.g. SE/SO/2627/); set a transaction lock date after each month close | Vivek | This week |
| A13 | ERP: project-code alignment, employee → imprest mapping, then sync go-live (§4) | Claude (code) + Vivek | After A3, A4 |
