# Proposal Format Revamp — May 20, 2026

> Replace the placeholder PDF templates (shipped May 19 in mig 109 batch) with templates that match Shiroi's actual 3-year customer-facing format, derived from analysis of 24 real proposals across 2022–2025/26.

## Background

The Quick Quote and Detailed Proposal PDFs shipped May 19 were placeholders structured around generic "About Shiroi / Why Shiroi" sections. They don't match the format Prem actually sends customers today. Vivek asked for the format to match the **current proposal** as a best-of synthesis across years.

## Source-material analysis

Pulled 24 `.docx` files from the 4 Drive `Proposals YYYY` folders via the existing service-account flow (`scripts/download-docx-proposal-samples.ts`). Extracted text with `mammoth`. Findings:

**Two distinct templates** are in active use:

### Class A — Detailed proposal (used for medium-large projects, ~8KB text, 8 tables)
Examples: `Acharya Rahul Rev .docx`, `Rhanes Private limited .docx`, `DRA Infinique .docx`, `Navins Cedar Rev3.docx`, `Mr.P.Ramakrishna.docx`, `Mr.Sriram.docx` (all 2025/26), `proposal.docx` (2023), `Radiance Mercury Association.docx` (2022). Identical structure across years — Shiroi has used this template since 2022 with minor refinements.

Sections, in order:
1. **Cover** — "Proposal for rooftop solar PV system" / "Client Name: X" / "Reference number: PV###/YY-YY" / "SHIROI ENERGY LLP" / Date / Adyar address block / Landline 94440 60787 / Email
2. **Table of Contents** with page numbers (1. Executed Project — 3, 2. System Sizing and Production — 4, etc.)
3. **Executed Project** — past clients grouped into four sector columns: Builder, Industrial, Edu./Institutional, Residential. Names like RadianceLifestyle, Prestige, Akshaya, Sumanth, Lancor, Metal Forms, Chemfab Alkalis, Sri Krishna Sweets, Ramakrishna Mission, Hindu School, Mandarin, Radiance Mercury.
4. **System Sizing and Production** — Total Investment + Units Produced Per Day (the two headline numbers). Sub-section 2.1 "Quotation" or "System without panels and structure" with line-item breakdown.
5. **Technical Specification** — 14-row BOM table, "S. No / SOLAR PV POWER PLANT":
   1. System Size · Total Capacity – X KW
   2. Area Required for Installation
   3. Location
   4. Mounting Structure Type (GI / Aluminium Min Rail / etc.)
   5. PV Module (e.g. "600/620 Wp Bifacial Solar module (Premier/Adani) 30 Years Warranty")
   6. DC Cables (Siechem / Polycab / Orbit)
   7. AC Cable (Siechem / Polycab / Orbit)
   8. DC Combiner Box (IP 66 / IP 67 Rated Outdoor Electrical Box, 20A DC MCB)
   9. Inverter (with brand + wifi monitoring note)
   10. (reserved)
   11. ACDB (e.g. "Single phase 20A MCB and SPD")
   12. Earthing Accessories (Cu Wire and copper Bonded earth, 1 mtr length, 17.2 mm dia)
   13. Cable Routing Accessories (Electrical UPVC)
   14. Lightning Arrestor
6. **Scope of Work** — inclusions / exclusions
7. **Terms and Condition** — payment schedule, warranty terms, liability clauses
8. **Documents needed** — list of customer-provided docs (KYC, electricity bill, sanction letter copy, etc.)

### Class B — Quick proposal (used for small/repeat projects, ~1.6KB text, 2 tables)
Examples: `Deepa Balaji Rev3.docx`, `Mrs. Umamaheswari 5 KW.docx`, `S&P Rev1.docx`, `Mr. Pradheep Boopathy.docx`, `Mr. Chandar Seetharaman.docx`.

Sections, in order:
1. **Cover** — identical to Class A cover, but "Reference number: SE/PV/###/YY-YY Rev #" format
2. **Parts Used and Specifications** — same 14-row BOM table as Class A section 5
3. **Pricing for X kWp with 600/620 Wp Bifacial Solar panels** — Supply Cost + Services Cost split
4. **Note** — paragraph of caveats / next steps
5. **Account Details** — bank account for advance payment

Class B is 2–3 pages, no executed-project grid, no savings model, no scope/terms (those become hyperlinks or are skipped — the deal is small enough that the customer trusts the Class A standard terms by reference).

### Brand particulars (consistent across all 24 samples)

- Company: **SHIROI ENERGY LLP** (NOT "Private Limited" — that's a bug in the current PDF; the LLP legal-name correction was tracked in May 1 changelog but the PDF templates still say "ENERGY PRIVATE LIMITED")
- Address: 75/34, Rangeela Apartments, Third Main Road, Kasturba Nagar, Adyar, Chennai - 600 020, INDIA
- Landline: 94440 60787 (Prem's mobile)
- Email: prem@shiroienergy.com
- No website URL on proposals (verified — not used)
- Reference number format: `PV###/YY-YY` for detailed, `SE/PV/###/YY-YY Rev #` for revised quick quotes

## Design — what we ship

### Mode selector

A single React-PDF component family with two top-level entry points:

```ts
<DetailedProposalPDF data={...} mode="detailed" />
<QuickQuotePDF        data={...} mode="quick" />
```

Both share the new `CoverPage`, `BomTable`, `BrandFooter`, and `PageFrame` components. They diverge after the cover:
- Detailed: ToC → Executed Projects → System Sizing → Tech Spec (BOM) → Scope → Terms → Documents needed
- Quick: Tech Spec (BOM) → Pricing → Note → Account Details

### Component breakdown

```
apps/erp/src/lib/pdf/
├── proposal-pdf-data.ts          (unchanged — data shape passes through)
├── pdf-styles.ts                  (rewrite: brand tokens, fonts, table styles)
├── proposal/                      (new sub-dir)
│   ├── cover-page.tsx             (shared — Shiroi template cover)
│   ├── bom-table.tsx              (shared — 14-row Technical Specification table)
│   ├── brand-footer.tsx           (shared — address strip footer)
│   ├── executed-projects-page.tsx (detailed only — 4-column past-client grid)
│   ├── system-sizing-page.tsx     (detailed only — Total Investment + Units/Day)
│   ├── scope-of-work-page.tsx     (detailed only — inclusions/exclusions)
│   ├── terms-and-condition-page.tsx (detailed only — payment schedule + warranty + liability)
│   ├── documents-needed-page.tsx  (detailed only — KYC list)
│   ├── pricing-page.tsx           (quick only — Supply + Services split)
│   ├── note-and-account-page.tsx  (quick only — Note paragraph + bank details)
│   ├── detailed-proposal-pdf.tsx  (rewrite — composes the detailed flow)
│   └── quick-quote-pdf.tsx        (rewrite — composes the quick flow)
```

The existing `savings-page.tsx` and `shared-pages.tsx` (About Shiroi, Warranty/T&C, Why Shiroi) become unused. **Delete them** in the same commit — they were the placeholder content from May 19; leaving them around is confusing.

### Brand tokens (in `pdf-styles.ts`)

```ts
export const BRAND = {
  green:     '#00B050',   // matches design-system.md --brand
  greenDark: '#007A38',   // matches --brand-dark
  black:     '#111318',   // matches --n950
  gray900:   '#1A1D24',
  gray700:   '#3F424D',   // body text on white
  gray500:   '#6B7280',   // secondary labels
  gray300:   '#DFE2E8',
  gray100:   '#F1F3F5',
  gray50:    '#F8FAFC',
  solar:     '#F0B429',   // optional CTA accent on payment milestone callouts
} as const;

export const COMPANY = {
  legalName:   'SHIROI ENERGY LLP',
  brandName:   'SHIROI',
  tagline:     'Solar EPC · Chennai',
  address:     '75/34, Rangeela Apartments, Third Main Road,\nKasturba Nagar, Adyar, Chennai - 600 020, INDIA',
  landline:    '94440 60787',
  email:       'prem@shiroienergy.com',
} as const;
```

### Cover page (shared)

Layout (A4, 40mm margins):
```
─────────────────────────────────  ← 6mm brand-green stripe
SHIROI                              ← 36pt Helvetica-Bold, --brand
ENERGY LLP                          ← 12pt, --gray500, letter-spacing 3pt

(40mm gap)

Proposal for rooftop solar PV system  ← 18pt Helvetica-Bold, --black, centered

Client Name: <customerName>         ← 14pt, --gray700, centered
Reference number: <proposalNumber>   ← 12pt, --gray500, centered
<date>                              ← 12pt, --gray500, centered

(pushed to bottom)
SHIROI ENERGY LLP                    ← 11pt Helvetica-Bold, --green
<address, 2 lines>                   ← 9pt, --gray700
Landline: 94440 60787                ← 9pt, --gray700
E-Mail: prem@shiroienergy.com        ← 9pt, --gray700
```

In quick mode, append an italic line under the title: "Budgetary estimate — subject to site survey".

### Executed Projects page (detailed only)

Section title "Executed Project" (24pt, --black). Then a 4-column grid:

| Builder Sector | Industrial Sector | Edu. / Institutional | Residential |
|---|---|---|---|
| Radiance Lifestyle | Metal Forms | Ramakrishna Mission | Mandarin |
| Prestige | Chemfab Alkalis | Hindu School | Radiance Mercury |
| Brigade | Pioneer Spinning Mills | GGN School | Lancor RWD |
| Akshaya | Sri Krishna Sweets | | Sun Grow |
| GRN | SVA Spinning Mills | | |
| Vijay-Raja | SVPB Spinners | | |
| Marutham | MSM Spinning Mill | | |
| Ramaniyam | Cholan Paper Mills | | |
| Sumanth & Co | | | |
| Indus Alliance | | | |
| DRA | | | |
| Bhagyam | | | |
| Olympia Panache | | | |
| Lancor | | | |

This list is **hardcoded** in `executed-projects-page.tsx` — it doesn't come from the database (these are sales/marketing assets and should not be tied to live project status). If Prem wants to add a customer to the brag list, he edits the file. A future revision can add a UI surface for this.

Each cell renders as a small chip: light gray border, customer name in 9pt --gray700. No logos in v1 — text-only chips. Future revision can add per-customer logo images stored as PNG in `apps/erp/public/proposal-assets/logos/`.

### System Sizing and Production page (detailed only)

Two big numbers up top:
- **Total Investment**: ₹formatINR(totalAfterDiscount) — 28pt --green
- **Units Produced Per Day**: <system_size_kwp × 4.5 (Tamil Nadu average insolation)> kWh — 28pt --black

Below: a small breakdown of the line items as a 4-column table (Category / Description / Qty / Amount). Same data as the existing BOM but presented as a financial summary.

### Technical Specification page (shared — Class A's section 5 / Class B's section 1)

Title: "Technical Specification" (detailed) or "Parts Used and Specifications" (quick).

Two-column table, 14 rows:

| S. No | SOLAR PV POWER PLANT |
|---|---|
| 1 | **System Size** — Total Capacity – <kWp> kW |
| 2 | **Area Required for Installation** — As per layout shared |
| 3 | **Location** — <city> |
| 4 | **Mounting Structure Type** — <structureLabel> |
| 5 | **PV (Photovoltaic) Module** — <panelWattage> Wp <panelType> (<panelBrand>) 30 Years Warranty |
| 6 | **DC Cables** — Siechem / Polycab / Orbit |
| 7 | **AC Cable** — Siechem / Polycab / Orbit |
| 8 | **DC Combiner Box** — IP 66 / IP 67 Rated Outdoor Electrical Box, 20A DC MCB |
| 9 | **Inverter** — <inverterCapacityKw> kW <inverterBrand> (wifi monitoring enabled) |
| 10 | **ACDB** — 20A MCB and SPD |
| 11 | **Earthing Accessories** — Cu Wire and copper bonded earth, 1 mtr length, 17.2 mm dia |
| 12 | **Cable Routing Accessories** — Electrical UPVC |
| 13 | **Lightning Arrestor** — Copper LA with 4 prong |
| 14 | **Net Metering & Liaison** (if scope_owner = 'shiroi' on net_meter line) |

The data shape on `ProposalPDFData` doesn't currently carry the brand options for cables/earthing/etc. — those are universal defaults baked into Shiroi's spec. Hardcode them in `bom-table.tsx` as a fallback when the BOM doesn't have a line for that category. When the BOM DOES have a specific line (e.g. customer requested Orbit cables specifically), use that line's value.

Row 14 (Net Metering & Liaison) appears only when the proposal includes a net_meter BOM line with scope_owner='shiroi' — otherwise omit it (skip row entirely, don't render "Excluded").

### Scope of Work page (detailed only)

Two columns:

**Inclusions**
- Supply of all materials per Technical Specification
- Installation, commissioning, and testing
- TNEB net-metering liaison (if applicable)
- CEIG approval support (>10 kWp systems)
- 1-year free maintenance
- Remote monitoring portal setup

**Exclusions**
- Civil works (foundation, watertight roof penetration sealing) unless quoted separately
- Electrical contractor licence fees
- TNEB net-metering deposit
- Any structural strengthening of the existing roof
- Insurance during installation

Pull inclusion/exclusion text from BOM lines where `scope_owner = 'client'` to dynamically build the exclusions list. Add the 5 universal exclusions above as defaults.

### Terms and Condition page (detailed only)

Section A — Payment Schedule (auto-generated from `payment_schedule`):
- Milestone name · Trigger · Amount · GST · Total

Section B — Warranty
- Solar Panels: 12 years product / 30 years performance (manufacturer)
- Inverter: 5 years standard (extendable to 10 years for ₹X)
- Mounting Structure: 10 years against galvanic failure
- Workmanship: 1 year free maintenance, then optional AMC

Section C — Liability
- Quotation valid for 30 days
- Prices subject to GST as per current rates
- Final price subject to site survey and design confirmation
- Force majeure: weather, regulatory changes, material shortages

Section D — Acceptance
- Authorised Signatory (Shiroi): _____________ Name: _____________ Date: _______
- Authorised Signatory (Customer): _____________ Name: _____________ Date: _______

### Documents needed page (detailed only)

Bulleted list:
1. KYC: Aadhar + PAN of property owner
2. Electricity bill (latest 3 months)
3. Sanction letter copy (electrical service connection)
4. Property documents (sale deed / patta — first page only, for net-metering)
5. Cancelled cheque (for refund of net-metering deposit if applicable)
6. Society NOC (apartments / gated communities only)
7. Roof access / installation site photos
8. Site survey form (filled jointly with Shiroi engineer)

### Pricing page (quick only)

Two side-by-side panels:

**Supply Cost** (5% GST)
- Subtotal: ₹X
- GST @ 5%: ₹Y
- Total: ₹Z

**Services Cost** (18% GST)
- Subtotal: ₹X
- GST @ 18%: ₹Y
- Total: ₹Z

**Grand Total**: ₹X (28pt --green)

Pulled directly from `subtotal_supply`, `subtotal_works`, `gst_supply_amount`, `gst_works_amount`, `total_after_discount` on `proposals`.

### Note and Account Details page (quick only)

Note paragraph (boilerplate):
> "This is a budgetary estimate based on the system size and segment provided. Final pricing will be confirmed after a detailed site survey. The system specifications listed are indicative and may be revised based on roof type, structural assessment, and shading analysis. Once accepted, an advance of 50% is required to lock in panel inventory and start procurement. Subsequent milestones are payable as per the schedule confirmed in the detailed proposal."

Account details:
```
Account Name: SHIROI ENERGY LLP
Bank: <bank name from settings>
Account Number: <a/c>
IFSC: <ifsc>
Branch: <branch>
GSTIN: <gstin>
```

These four (bank name / a/c / IFSC / branch / GSTIN) should pull from a new `settings` row or — simplest — from environment variables `SHIROI_BANK_NAME`, `SHIROI_BANK_AC`, `SHIROI_BANK_IFSC`, `SHIROI_BANK_BRANCH`, `SHIROI_GSTIN`. v1 hardcodes the values in `proposal/quote-constants.ts` with a clear note "TODO: move to settings table when /settings/company exists".

### Footer (shared)

```
Reference: <proposalNumber>   |   SHIROI ENERGY LLP   |   Page X of Y
```

Pinned to bottom of every page, --gray500, 8pt. Brand-green hairline above.

## What we delete

- `apps/erp/src/lib/pdf/shared-pages.tsx` → all three of `AboutShiroiPage`, `WarrantyAndTermsPage`, `WhyShiroiPage` are now unused. Delete the file. Move `PageFooter` into a new `apps/erp/src/lib/pdf/proposal/brand-footer.tsx`.
- `apps/erp/src/lib/pdf/savings-page.tsx` → replaced by `system-sizing-page.tsx`. Delete.

Both files were placeholders from May 19. Removing them avoids leaving dead exports that the next developer might assume are live.

## What stays

- `apps/erp/src/lib/pdf/proposal-pdf-data.ts` — data shape passes through. May need to add `customerCity` to the data fetcher if not already populated (verify).
- `apps/erp/src/lib/pdf/pdf-styles.ts` — rewrite contents but keep file path so imports don't churn.

## Out of scope

- **Logos / images** for executed projects. v1 ships text-only chips. Future revision adds PNGs to `apps/erp/public/proposal-assets/logos/`.
- **Customer-editable executed project list.** Hardcoded in code for v1. Founder/marketing_manager UI to manage the list is a separate feature.
- **Multi-language** (Tamil). All copy in English for v1.
- **DM Sans / Inter font registration.** React-PDF font registration adds bundle size and complexity; v1 stays on built-in Helvetica family. Future revision can register Inter / DM Sans following the React-PDF font-registration pattern.
- **Signature image overlays.** v1 just shows the signature lines for hand-sign.
- **Savings/payback model.** Removed from detailed proposal in v1 — none of the 9 Class A samples I analyzed include a savings calculation in the proposal PDF (Shiroi communicates savings verbally / via separate spreadsheet). If needed later, can add an optional `<SavingsPage>` toggle.

## Verification

Manual smoke (Vivek to perform after deploy):
1. Create a new test lead, run Quick Quote → download PDF → confirm 3 pages, brand-green cover with "SHIROI ENERGY LLP" (no more "Private Limited"), correct address, 14-row tech spec, supply+services split, bank details on last page.
2. Open an existing detailed proposal in negotiation → download PDF → confirm 8 pages, executed-projects grid, full BOM table, scope, T&C, documents needed.
3. Confirm reference number renders correctly (PV###/YY-YY format).

Automated:
- Snapshot test of `getDetailedProposalPDFData(<test proposal id>)` to lock the data contract.
- `pnpm check-types` clean.
- `pnpm lint --max-warnings 0` clean.
- `bash scripts/ci/check-forbidden-patterns.sh` — no new violations.

## Files touched

Created:
- `apps/erp/src/lib/pdf/proposal/cover-page.tsx`
- `apps/erp/src/lib/pdf/proposal/bom-table.tsx`
- `apps/erp/src/lib/pdf/proposal/brand-footer.tsx`
- `apps/erp/src/lib/pdf/proposal/executed-projects-page.tsx`
- `apps/erp/src/lib/pdf/proposal/system-sizing-page.tsx`
- `apps/erp/src/lib/pdf/proposal/scope-of-work-page.tsx`
- `apps/erp/src/lib/pdf/proposal/terms-and-condition-page.tsx`
- `apps/erp/src/lib/pdf/proposal/documents-needed-page.tsx`
- `apps/erp/src/lib/pdf/proposal/pricing-page.tsx`
- `apps/erp/src/lib/pdf/proposal/note-and-account-page.tsx`
- `apps/erp/src/lib/pdf/proposal/quote-constants.ts` (Shiroi bank/GSTIN + executed projects list)

Modified:
- `apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx` (rewrite — composes quick flow)
- `apps/erp/src/lib/pdf/detailed-proposal-pdf.tsx` (rewrite — composes detailed flow)
- `apps/erp/src/lib/pdf/pdf-styles.ts` (new BRAND tokens, COMPANY constants)

Deleted:
- `apps/erp/src/lib/pdf/shared-pages.tsx` (placeholder content; moved PageFooter to brand-footer.tsx)
- `apps/erp/src/lib/pdf/savings-page.tsx` (replaced by system-sizing-page.tsx)

Documentation:
- `docs/CHANGELOG.md`, `docs/CURRENT_STATUS.md`, `docs/modules/sales.md`
