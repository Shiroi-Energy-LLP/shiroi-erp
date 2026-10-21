# Zoho Books — Accounts Team Guide (Shiroi Energy LLP)

> **For:** the accounts team (and the CA).
> **Owner:** Vivek. Version 1.0, 21-Oct-2026.
> **Why this exists:** Zoho Books is connected to the Shiroi ERP. Whatever you enter in Zoho flows into the ERP's project costing, cash dashboard and collections. An entry that is wrong or incomplete in Zoho becomes wrong in the ERP too. Follow this guide exactly.
> The audit behind this guide: `docs/reviews/2026-10-21-zoho-books-audit.md`.

---

## 1. The 12 golden rules

1. **Every transaction carries a Project.** That means every invoice, bill, expense, receipt and vendor payment. If it is truly company overhead, use the project **"SE-OVERHEAD"** (to be created). Never leave the field blank.
2. **Every receipt is applied to an invoice.** Record it from the invoice (*Record Payment*). If no invoice exists yet, record it as an advance **and apply it the same day the invoice is raised**.
3. **Every vendor payment is applied to a bill.** Advances to vendors must be adjusted against their bills within the month.
4. **No B2B invoice leaves the office without an IRN.** Its e-invoice status must read **"Pushed"** before it is emailed or handed over.
5. **One entry point per document.** Site vouchers are entered in the **ERP** only, never in Zoho (see §7). Invoices, receipts, bills and vendor payments are entered in **Zoho** only.
6. **Company money moves only through company accounts.** That means company bank, petty cash, or a Site Imprest account. A partner's or employee's personal ledger is never used as "Paid Through".
7. **Never use the Expense module to pay GST, TDS, salaries, partner remuneration or taxes.** Use the routes in §8.
8. **Never "Exclude" a bank line** without writing the reason in the notes and getting the CA's or Vivek's OK.
9. **Never create a new account, tax, item or customer** without checking that it doesn't already exist. New *accounts* need Vivek's approval.
10. **Attach the document.** That means the vendor invoice on the bill, the bank advice / UTR on the receipt, and the bill photo on the expense.
11. **Reconcile every bank account every month** before the 7th of the next month.
12. **Close the month, then lock it.** After month-end close, nobody edits that month (§11).

---

## 2. Who does what

| Role | Zoho access | Does |
|---|---|---|
| Vivek (founder) | Admin | Approves new accounts, write-offs, journals > ₹50,000, lock dates |
| CA | Admin / Accountant | GST and TDS returns, set-off journals, year-end entries, review |
| Accounts executive(s) | **Staff (not Admin)** | Invoices, receipts, bills, vendor payments, bank categorisation |
| Dispatch manager | Limited (POs / items) | Purchase orders, item master requests |

Logins must be **@shiroienergy.com** company email IDs, not personal Gmail. When someone leaves, deactivate their login **the same day**.

---

## 3. Masters (set them up once, correctly)

### 3.1 Customers
- **Name:** the legal name exactly as on the GST certificate (for businesses) or the full name as on Aadhaar (for individuals). Use the same spelling everywhere, and no trailing dots.
- **Search before creating.** Search by GSTIN first, then by mobile number, then by name. One GSTIN means exactly one customer.
- **GST treatment:**

  | Customer | Treatment | GSTIN |
  |---|---|---|
  | Registered business | **Registered Business – Regular** | Required (15 characters, validate it) |
  | Individual / homeowner | **Consumer** | — |
  | Trust or society without GSTIN | **Unregistered Business** | — |

- **Mandatory fields:** mobile, email, billing address with pincode, place of supply. A customer without a phone or email cannot receive statements or reminders.

### 3.2 Vendors
- Legal name as on the GST certificate, plus GSTIN (if registered), **PAN (always)**, bank details and MSME/Udyam number (if MSME).
- **MSME vendors must be paid within 45 days.** Otherwise the expense is disallowed under Income-tax §43B(h). Mark MSME status on the vendor.
- Labour contractors: PAN is mandatory, because TDS u/s 194C applies.

### 3.3 Projects (this is the link to the ERP)
- Each ERP project gets **one** Zoho project. The Zoho project's **PROJECT CODE must equal the ERP project number** (e.g. `SHIROI/PR/2026/0412`). Name format: `<Customer> <kWp> KWP`, e.g. `BALAJI 3.6 KWP`.
- **Create the Zoho project the same day the ERP project is created** (once the sync is live, the ERP will do this for you).
- Never reuse a project for a different site. Never put two customers on one project.
- Company overheads go to the project **SE-OVERHEAD**.

### 3.4 Items
- Search before creating. "50 Sqmm single core aluminium Flexible Cable" and "50SQ MM SINGLE CORE ALUMINIUM FLEXIBLE CABLE" must be **one** item.
- Every item needs:
  - **HSN/SAC:** solar module 85414011, inverter 85044010, solar EPC works 995461, design/consulting 998338
  - unit
  - category (Panel / Inverter / Structures / Cables / Electrical / Earthing / ACDB / DCDB / Battery / Others)
  - the correct GST rate
- Tax: use the **GST5 / GST18 / GST0** groups for intra-state and **IGST5 / IGST18** for inter-state. **Never use "CGST 18%" or "SGST 18%"** (these are being deactivated).

---

## 4. Chart of accounts — which account to use

The CoA is being restructured with the CA. Until then, use **only** the accounts in this table. If it isn't in the table, ask.

| You are recording… | Account to use |
|---|---|
| Panels, inverters, structures, cables, BOS bought for a project | **Materials (Cost of Goods Sold)**, or Inventory Asset if stocked. The GST rate goes in the *tax* field, not the account name. |
| Installation / civil / fabrication labour | **Labour Charges** (COGS) |
| Net-metering, CEIG, liaison fees | **Net – Metering** / **Liasoning Charges** |
| Transport of material to site | **Transport Charges** (one account; GST goes in the tax field) |
| Staff travel, fuel | **Travelling Expense** / **Petrol & Diesel Expense** |
| Bank charges | **Bank Fees and Charges** (not "Bank Charges") |
| Site supervisor's spend from imprest | Expense account as above, **Paid Through = Site Imprest – <name>** (§7) |
| Salary advance to an employee | **Salary Advance**, with the employee as the contact |
| Unknown / not sure | **Ask the CA.** Never use Uncategorized or Suspense. |

**Proposed coded CoA** (for the CA restructure, to be approved by Vivek):

| Code range | Group | Examples |
|---|---|---|
| 1000s | Assets | 1010 Petty Cash · 1020 UCO WC · 1030 UCO CC · 1040 SBI CC · 1200 Accounts Receivable · 1300 Inventory · 1400 Site Imprest (control) · 1410 Staff Advance (control) · 1420 Salary Advance (control) · 1500 Input CGST/SGST/IGST · 1510 TDS Receivable · 1600 Security Deposits · 1700 Fixed Assets |
| 2000s | Liabilities | 2010 Accounts Payable · 2100 Output CGST/SGST/IGST · 2110 GST Payable · 2120 TDS Payable · 2200 Salary Payable · 2300 Customer Advances · 2400 UCO Term Loan · 2410 SBI GECL · 2500 Loans from Related Parties |
| 3000s | Partners' funds | 3010 K.S. Vinodh Capital · 3020 K.S. Vinodh Current · 3030 Sirisha G Capital · 3040 Sirisha G Current |
| 4000s | Income | 4010 Sales – Solar EPC · 4020 Sales – Services / AMC · 4900 Other Income |
| 5000s | Direct costs (COGS) | 5100 Materials · 5200 Labour · 5300 Transport to site · 5400 Net-metering & liaison · 5500 Equipment hire |
| 6000s | Overheads | 6010 Salaries · 6020 Partner Remuneration · 6030 Rent · 6040 Travel · 6050 Fuel · 6060 Professional fees · 6070 Bank charges · 6080 Interest · 6090 Depreciation · 6100 Insurance · 6110 Office & admin |

Persons (site engineers, staff) are tracked as **contacts on a control account**, not as separate GL accounts.

---

## 5. Sales cycle

### 5.1 Raising an invoice
1. **Before raising:** check the project exists and the customer master is complete (§3.1).
2. Use the series **SE/SAL/2627/nnn** (FY 26-27). Never type a number by hand, and never use a format like "SE/SAL/26-27/053" or "142A".
3. Fill in the **Project** on every line, **HSN** on every line, the correct tax group and the **Place of Supply**.
4. Attach the signed work-completion / delivery note if available.
5. **For B2B (customer has a GSTIN):** Save, then **Push to IRP** (e-Invoice). Wait for status **"Pushed"** and check that the IRN and QR code show on the PDF.
   - If it says **Failed**, open the error, fix it (usually the GSTIN, pincode or HSN) and push again.
   - **Shiroi must push within 30 days of the invoice date. After that the IRP rejects it.**
6. Email the invoice **from Zoho** (Send). This records that it was sent and lets reminders work.
7. **Never raise the same bill twice.** If you need to correct an invoice, edit it (if not yet e-invoiced) or issue a **credit note**. Do not issue a second invoice.

### 5.2 Recording a customer receipt
1. Each morning, import the bank statement (§9) and look for credits.
2. **Against an invoice:** open the invoice → **Record Payment**. Deposit To = the bank account the money actually came into. Reference = **UTR / cheque number**. Attach the bank advice.
3. **Advance (no invoice yet):** Customers → Payments Received → New, mark it an advance, set the project, enter the UTR.
4. **When the invoice is later raised:** open the customer → **Apply Credits** → apply the advance to the new invoice. **Do this the same day.**
5. Match the bank feed line to this receipt (Banking → the line → *Match*). **Never "Categorise" a customer receipt as income directly.**
6. Never deposit customer money into a personal or loan ledger.

### 5.3 Credit notes
Use a credit note for returns, rate corrections or cancelled scope. If the original invoice had an IRN, the credit note needs one too. Apply the credit note to the invoice; don't leave it open.

### 5.4 Collections (weekly, every Monday)
- Run **Reports → Receivables → AR Ageing Summary.**
- First check that no customer has unapplied credits (Customers → filter "Unused credits"). If one does, apply them *before* chasing.
- Send statements from Zoho. Payment reminders are switched on: 3 days before due, on the due date, and 7 / 15 / 30 days after.

---

## 6. Purchase cycle

### 6.1 Purchase order
Raised by the dispatch manager in Zoho (or the ERP, once the purchase module is live) with the project. Close POs that won't be billed, and don't leave drafts lying around.

### 6.2 Booking a vendor bill
1. Book a bill **within 3 days** of receiving the vendor's invoice.
2. **Bill#** = the vendor's invoice number exactly. Zoho warns on duplicates; never override that warning without checking.
3. Convert from the PO where one exists.
4. On every line, fill in the **Project**, account (§4), HSN, tax and **ITC eligibility**.
5. Deduct **TDS** where applicable: 194C contractors, 194J professionals, 194I rent, 194Q purchases > ₹50L/year from one vendor.
6. Attach the vendor invoice PDF. **No attachment means no bill.**
7. Reverse-charge purchases (e.g. GTA transport, legal fees): tick **Reverse Charge**.

### 6.3 Paying a vendor
1. Pay **against the bill** (bill → Record Payment). Paid Through = the actual company bank account.
2. **Advance to vendor:** record it as an advance, with the project. **Adjust it against the vendor's bill the day the bill is booked** (Vendor → Apply Credits).
3. **Big contractors** (Ritechoice, EPC subcontractors): get the running-account bill monthly and book it. Never let advances pile up. Get a ledger confirmation every quarter.
4. MSME vendors: pay within 45 days of acceptance.
5. Match the bank feed debit to the payment.

---

## 7. Site expenses and imprest (ERP vouchers)

**From the sync go-live date** (Vivek will announce it):
- Site engineers submit vouchers in the **ERP** (`/expenses`). The project manager verifies and finance approves. **Approved vouchers are pushed to Zoho automatically** as expenses, with project and category.
- The accounts team **does not re-enter these in Zoho.** Doing so books the expense twice.
- Each site engineer has **one** imprest account: "Site Imprest – <Name>", under the 1400 control account.
- **Top-up to an engineer:** in the bank feed, categorise the debit as *Transfer to account* → "Site Imprest – <Name>". Do not book it as an Expense.
- Every month: the imprest balance in Zoho must equal (cash given − approved vouchers). Any difference gets resolved with the engineer before month-end.

**Until go-live:** continue entering site expenses in Zoho, but **with the Project filled in** and the bill photo attached.

---

## 8. Statutory payments — the right way

| Payment | How to book it in Zoho | NOT like this |
|---|---|---|
| GST (monthly, GSTR-3B) | Banking → debit line → Categorise as **Payment of liability → GST Payable**. The CA passes the monthly set-off journal (Dr Output GST / Cr Input GST / Cr GST Payable). | ❌ Expense to "GST Payable" |
| TDS (by the 7th) | Categorise as **Payment of liability → TDS Payable** | ❌ Expense |
| Salaries | Month-end journal: Dr Salaries & Wages / Cr Salary Payable. On payment: categorise the debit → **Salary Payable** | ❌ Expense to "Salary Payable" |
| Partner remuneration | Journal: Dr Partner Remuneration / Cr Partner Current A/c; payment debits the Current A/c | ❌ Expense |
| Advance tax | Categorise → **Advance Tax FY xx-xx** (asset) | ❌ Expense |
| Loan EMI | Split: principal → loan account, interest → Interest Paid | ❌ All to interest |

### Compliance calendar
| Due | What |
|---|---|
| 7th | TDS payment for the previous month (30 April for March) |
| 11th | GSTR-1 (outward supplies), filed after checking every B2B invoice has an IRN |
| 14th | Reconcile ITC with GSTR-2B |
| 20th | GSTR-3B plus GST payment, then the set-off journal |
| 15 Jun / 15 Sep / 15 Dec / 15 Mar | Advance tax |
| 31 Jul / 31 Oct / 31 Jan / 31 May | TDS returns (24Q / 26Q) |
| 30 May / 30 Oct | LLP Form 11 / Form 8 |
| Monthly | MSME payments within 45 days |

---

## 9. Bank and cash

- **Daily:** import the statement for UCO WC, UCO CC, SBI CC and the UCO loan account (Banking → Import Statement, or bank feed). For each line:
  - **Match** it to an existing receipt or payment, or
  - **Categorise** it with the correct account and project.
- **Never Exclude** a line unless it is a genuine duplicate of the import. Write the reason in the notes.
- **Monthly (by the 7th):** Banking → account → **Reconcile**. Zoho's closing balance must equal the bank statement's. Save the reconciliation report.
- **Petty cash:** count it physically on the last working day of each month. Zoho's balance must match the cash in the box. Any difference goes to Vivek for approval.
- **Dormant accounts** (SBI WC 9724, ICICI 7495): reconcile to zero, then mark inactive with Vivek's approval.

---

## 10. Journals

- Journals are allowed only for: month-end provisions (salary, rent, audit fees), GST set-off, depreciation, reclassifications, and corrections approved by the CA.
- **Every journal needs:** a narration explaining *why*, a reference to the supporting document, and the project where relevant.
  - Not OK: "cash payment".
  - OK: "Cash paid by Manivel to Sahayaraj ₹3,500 – civil work, project SHIROI/PR/2026/0388, voucher 112".
- Journals above ₹50,000, any write-off and any entry to a partner or related-party account need **Vivek's approval** *before* posting.
- Never use a journal to "make a balance go away".

---

## 11. Month-end close checklist (finish by the 10th)

| # | Task | Done |
|---|---|---|
| 1 | All bank accounts reconciled; reconciliation reports saved | ☐ |
| 2 | Petty cash counted and matched | ☐ |
| 3 | No uncategorised bank lines; every excluded line has a reason | ☐ |
| 4 | Every B2B invoice of the month has e-invoice status "Pushed" | ☐ |
| 5 | Customer credits applied (Customers → Unused credits = only genuine advances for future invoices) | ☐ |
| 6 | Vendor advances adjusted (Vendors → Unused credits = only genuine advances) | ☐ |
| 7 | Every bill, invoice and expense of the month has a Project (Reports → filter Project = none must be empty) | ☐ |
| 8 | Salary, rent and partner remuneration journals posted | ☐ |
| 9 | GSTR-1 and 3B filed; set-off journal posted; ITC reconciled with 2B | ☐ |
| 10 | TDS paid; TDS Payable = this month's deduction only | ☐ |
| 11 | Site imprest balances confirmed with each engineer | ☐ |
| 12 | Depreciation posted (monthly or at least quarterly) | ☐ |
| 13 | ERP ↔ Zoho weekly reconciliation report reviewed, with no unresolved differences | ☐ |
| 14 | Vivek reviews the P&L and Balance Sheet, then **sets the Transaction Lock date** (Settings → Transaction Locking) | ☐ |

**Year-end, additionally:** Closing WIP and stock entries (reversed on 1 April), depreciation, TDS Receivable matched to 26AS, advance tax set off against the provision, partners' profit share transferred to their current accounts, and balance confirmations from the top 20 customers and vendors.

---

## 12. Daily and weekly routine

**Daily (30–45 min):**
1. Import bank statements, then match or categorise every line.
2. Record receipts against invoices, with the UTR.
3. Book bills received yesterday.
4. Check Invoices → E-Invoice filter "Yet to be pushed / Failed" is **empty**.

**Weekly (Monday):**
1. AR ageing; apply credits; send statements.
2. AP ageing; MSME bills approaching 45 days go to the payment list for Vivek.
3. Vendor advance list: anything older than 30 days not yet adjusted needs a reason.
4. Review the ERP ↔ Zoho reconciliation report.

---

## 13. How Zoho and the ERP work together

| Data | Entered in | Flows to | Notes |
|---|---|---|---|
| Projects | ERP | → Zoho (same project code) | Don't create Zoho projects by hand once this is live |
| Customer invoices, credit notes | Zoho | → ERP (every 15 min) | Project must be set, or the ERP can't attribute it |
| Customer receipts | Zoho | → ERP | Applied to invoice = correct "money received" per project |
| Vendor bills, vendor payments, POs | Zoho | → ERP | Project on every line |
| Site vouchers | ERP (approved) | → Zoho expenses | **Never re-enter in Zoho** |
| Chart of accounts, taxes, items | Zoho | → ERP | Changes need Vivek's approval |

If something looks wrong in the ERP's project costing or cash screens, the fix is almost always **in Zoho**: a missing project tag, an unapplied receipt, or an unadjusted advance. Fix it there, and the ERP updates on the next sync.

---

## 14. Quick "don't" list
- ❌ Don't book GST, TDS, salary or tax payments as Expenses.
- ❌ Don't use "Uncategorized", "Suspense A/c" or "Opening Balance Adjustments".
- ❌ Don't create a GL account for a customer, vendor or person. Create a **contact**.
- ❌ Don't pay through a personal ledger (Vivek, K.S Vinodh Loans, C.K. Sridhar, Sujatha…).
- ❌ Don't leave a receipt or vendor payment unapplied for more than a day.
- ❌ Don't email a B2B invoice before its IRN is generated.
- ❌ Don't exclude bank lines to make a reconciliation "tally".
- ❌ Don't edit a locked or closed month.
- ❌ Don't share your login. Each person has their own.
