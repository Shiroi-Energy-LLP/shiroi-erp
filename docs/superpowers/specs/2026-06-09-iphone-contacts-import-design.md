# Selective Google / iPhone Contacts Import + Fuzzy Match — Design

> Date: 2026-06-09
> Status: Approved (design) — pending spec review
> Module: contacts (+ projects enrichment)
> Related: `docs/modules/contacts.md`, `docs/modules/projects.md`, `docs/modules/sales.md`
> **Branch discipline:** this spec is committed to `main`. Implementation goes on a
> NEW branch `feat/iphone-contacts-import` cut from `main` — do **not** build it
> into the in-flight `feat/leads-projects-customer-project-name` tree.

## Problem

Vivek's real customer + company phone numbers and emails live in his **Google
Contacts** (synced from his iPhone), not in the ERP. ERP contact details came from
leads / HubSpot / the historical-plants backfill and are frequently missing or
wrong. The immediate driver is **marketing to existing clients** (WhatsApp
check-ins / drip / referral outreach): those flows can only reach a customer if the
right number sits on the right record. We want to selectively pull the relevant
Google contacts in, fuzzy-match them to existing projects / contacts / companies,
and on confirmation enrich + link them so every project carries the correct person
with complete details.

## Goal / success criteria

- A selectively-exported set of Google contacts (a vCard) imports into a **staging
  table** without touching live data.
- Each staged card is **classified** (project person / company person / company
  office / none) and **fuzzy-matched** to the right ERP record(s), with the founder
  confirming every match in a **review UI** — no auto-linking, because the imported
  phone is the disambiguator the ERP currently lacks.
- On Accept, the customer's details are **enriched in both homes**: the denormalized
  `projects.customer_phone` / `customer_email` (what marketing actually dials) **and**
  the canonical `contacts` row, linked via `entity_contacts` (project) or
  `contact_company_roles` (company).
- Personal / irrelevant contacts never get linked and never get committed to git.

## Decisions (locked during brainstorming)

- **Approach A — enrich both homes.** Match against projects + contacts (+ companies
  for org cards); on accept write `projects.customer_*` AND upsert `contacts` + create
  the link. (B "contacts-only" rejected — leaves marketing sends without a number;
  C "projects-only" rejected — leaves the CRM empty.)
- **Selective at source.** Founder pre-picks contacts into a Google **Label** and
  exports only that label as vCard. Keeps personal contacts out of the company DB.
  (Filter-at-review and spreadsheet-trim rejected.)
- **Review UI, mirroring `/om/import-review`.** Founder confirms every row;
  bulk-approve only for `phone_exact`. (Markdown report / spreadsheet round-trip
  rejected.)
- **Company contacts are people + roles.** `companies` has no phone/email column, so a
  company's number is stored on a `contacts` person linked via `contact_company_roles`
  (HubSpot model, already surfaced on `/companies/[id]`).

## Key findings from the codebase (load-bearing)

- **`projects.customer_phone` is what marketing dials.** `customer_outreach_queue` rows
  carry only `project_id`; n8n `30-customer-checkin.json` fetches
  `projects?select=...,customer_phone`. Enrichment MUST write
  `projects.customer_phone` / `customer_email`, not just `contacts`.
- **A reusable fuzzy matcher already exists** — `scripts/whatsapp-import/fuzzy-match.ts`:
  `normalise()` (strips Mr/Mrs/Dr + Pvt/Ltd/LLP/Industries/… suffixes) +
  `bigramSimilarity()` (Dice coefficient), 0.35 floor. Reuse (extract the two helpers
  to a shared module, or copy ~25 LOC).
- **A staging + review pattern already exists** — `pending_project_imports` (mig 159) +
  `/om/import-review` (tabs, summary cards, row expansion, per-row Approve/Reject,
  bulk-approve, transactional approve RPC). Mirror it.
- **Schema (mig 016/017):** `companies`(NO phone/email; name, segment, gstin, address,
  website, notes, pan, industry, company_size, owner_id);
  `contacts`(name, phone, email, secondary_phone, designation, lifecycle_stage, source,
  owner_id, first/last_name); `contact_company_roles`(contact_id, company_id,
  role_title NOT NULL, is_primary, started_at/ended_at);
  `entity_contacts`(contact_id, entity_type lead|proposal|project, entity_id,
  role_label, is_primary, UNIQUE(contact_id, entity_type, entity_id));
  `projects`(customer_name, customer_phone, customer_email, company_id, project_name).

## Getting contacts off the phone (runbook — Google Contacts)

Contacts sync to Google, so the iPhone isn't needed — export from the browser on the
ERP machine:

1. **contacts.google.com**, signed into the synced Google account.
2. **Pre-pick via a Label**: select wanted contacts → "Manage labels" (tag icon) →
   create/apply `Shiroi ERP Import`.
3. **Export**: sidebar → Export → choose the `Shiroi ERP Import` label → format
   **vCard (for iOS Contacts)** → Export → `.vcf` downloads.
4. Save to `scripts/data/iphone-contacts-YYYY-MM-DD.vcf` (gitignored).

Pick **vCard, not CSV** — it preserves multiple phones/emails + `ORG`/`TITLE`. Google
also emits Labels as `CATEGORIES:` lines, usable as classification hints. (Alternates:
Mac Contacts → File → Export → vCard; or a backup app that emails all contacts —
loses the selective benefit.)

## Data model — `pending_contact_imports` (migration 173)

New staging table (confirm 173 is the next free number at build time — 172 is in
flight on another branch). Slim mirror of `pending_project_imports`.

- **Identity / source:** `id`, `vcard_name`, `first_name`, `last_name`, `org_name`,
  `title`, `phones JSONB` (array of `{type, value}`), `emails JSONB`,
  `categories JSONB` (Google labels), `normalized_name`, `normalized_phones JSONB`,
  `raw_vcard TEXT` (optional, debugging).
- **Match outcome:** `suggested_target_type` + `target_type`
  CHECK ('project_person' | 'company_person' | 'company_office' | 'none');
  `matched_project_id` → projects, `matched_company_id` → companies,
  `matched_contact_id` → contacts; `match_type` CHECK ('phone_exact' | 'fuzzy' | 'none');
  `match_score NUMERIC(4,3)`; `candidates JSONB` (top-3 per dimension for "pick another").
- **Enrichment choices:** `use_phone TEXT`, `use_email TEXT`, `phone_conflict BOOLEAN`.
- **Review lifecycle:** `status_review`
  CHECK ('pending' | 'approved' | 'rejected' | 'imported' | 'error') default 'pending',
  `reviewed_by` → profiles, `reviewed_at`, `imported_at`, `import_error`,
  `rejection_reason`, `created_at`.
- **Indexes:** `status_review`, `matched_project_id`, `matched_company_id`.
- **RLS:** founder + marketing_manager (read/write).

## Classification taxonomy ("appropriately table them")

Parser sets `suggested_target_type`; founder confirms/overrides in the UI. On Accept:

| `target_type` | Detected when | Writes |
|---|---|---|
| `project_person` | no `ORG`, personal-looking name | enrich `projects.customer_phone`/`email` on matched project; upsert `contacts`; `entity_contacts(project, is_primary)` |
| `company_person` | has `ORG` / a vendor-type CATEGORY | upsert `contacts` (phone/email/title); match `companies`; `contact_company_roles(role_title)`; optional `entity_contacts` to projects the founder picks |
| `company_office` | name itself is a company, no person | upsert `contacts` named "<Company> — Office"; `contact_company_roles(role_title='Office')` to matched company |
| `none` | nothing scores ≥ floor | park as standalone `contacts(source='iphone')`, or founder manually picks a project/company, or reject |

## Matching engine

- **Phone-exact (gold path):** `normalizePhone` → last-10 digits → match against
  `projects.customer_phone`, `contacts.phone` / `secondary_phone`, `leads.phone`. Hit →
  `match_type='phone_exact'`, score 1.0; bypasses fuzzy ambiguity.
- **Fuzzy fallback:** reuse `normalise()` + `bigramSimilarity()`. `project_person` →
  `projects.customer_name`; `company_*` → `companies.name`. 0.35 floor to surface a
  candidate; store top-3 candidates. **Never auto-link.**

## Review UI — `/contacts/import-review`

Mirror `/om/import-review`: summary cards + tabs
(Pending / Approved / Rejected / Imported / Errors); per-row expansion showing the
Google/iPhone details, the **type toggle**, candidate matches + scores, a
**phone/email picker** (iPhone-wins / keep-ERP / set-as-secondary on conflict),
**Accept / Reject**, and a **manual project/company search** for `none` rows.
**Bulk-approve** restricted to `phone_exact` rows. Nav under the contacts section;
founder + marketing_manager.

Server layer: `contact-import-queries.ts` (reads) + `contact-import-actions.ts`
(`'use server'`). Approve = transactional RPC
`approve_contact_import(p_id, p_target_type, p_project_id, p_company_id, p_phone, p_email, p_phone_strategy)`
(atomic multi-write) wrapped by a thin action returning `ActionResult`. Reject +
manual-reassign are separate actions that `.select('id')` and treat 0 rows as
RLS-blocked.

## Enrichment conflict rule

Default **fill-if-empty**. If `projects.customer_phone` already differs from the chosen
number → set `phone_conflict=true`, surface in the UI, founder picks (iPhone wins /
keep ERP / store iPhone as `contacts.secondary_phone`). `customer_name` is **never**
auto-overwritten (load-bearing for matching/display) — name change is an explicit
per-row choice. New contacts get `lifecycle_stage='customer'`, `source='iphone'`,
`owner_id = founder`.

## The import script

`scripts/iphone-contacts/`:

- `parse-vcard.ts` — hand-rolled vCard 3.0 parser (FN, N, TEL×n, EMAIL×n, ORG, TITLE,
  CATEGORIES; line-unfolding; ignores PHOTO). No new dependency.
- `seed-imports.ts` — load projects / contacts / companies / leads reference data;
  classify + phone-exact + fuzzy; dedup against already-staged + already-linked; insert
  `pending_contact_imports`. `--dry-run` + `--file=<path>` flags. Uses
  `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (dev).
- Reuses `normalise` / `bigramSimilarity` (shared module or copy).

## Files to touch (implementation, on `feat/iphone-contacts-import`)

- `supabase/migrations/173_2026-06-09-pending-contact-imports.sql` (new — table + RLS +
  `approve_contact_import` RPC)
- `packages/types/database.ts` (regenerate, same commit — NEVER-DO #20)
- `scripts/iphone-contacts/{parse-vcard.ts, seed-imports.ts}` (+ vitest for
  parser/classifier)
- `apps/erp/src/lib/contact-import-queries.ts` + `contact-import-actions.ts` (new)
- `apps/erp/src/app/(erp)/contacts/import-review/page.tsx` + components (mirror
  `om/import-review`)
- sidebar nav entry (founder + marketing_manager)
- `.gitignore`: add `scripts/data/*.vcf`

## Out of scope

- Live / continuous Google sync (this is a one-time / occasional batch).
- Auto-creating projects or leads for unmatched cards.
- Per-company rollup / group-by views (tracked with the
  leads-projects-customer-project-name Phase 2 backfill).
- Adding phone/email columns to `companies` (YAGNI — nothing reads them; the
  role-linked person is the store).

## Testing / verification

- **Parser unit tests:** multi-phone card, ORG/TITLE present, CATEGORIES, PHOTO ignored,
  line-folding.
- **Classifier tests:** residential → `project_person`; ORG card → `company_person`;
  "X Industries Pvt Ltd" with no person → `company_office`.
- **Matching tests:** phone-exact beats fuzzy; fuzzy floor honoured; top-3 candidates
  returned.
- **Manual:** import a small real vCard on dev → review screen → accept one of each type
  → verify `projects.customer_phone` set, `contacts` upserted,
  `entity_contacts` / `contact_company_roles` link created, conflict path works.
- **Standard gates before push:**
  `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`
  (read actual stdout — CI gate discipline).

## Risks & gotchas

- **Don't pollute the in-flight tree.** Implementation branches off `main`, not
  `feat/leads-projects-customer-project-name`.
- **Migration number race** — confirm the next free number vs the 172 branch before
  applying.
- **RLS silent UPDATE** — every write path `.select('id')` and treats 0 rows as blocked.
- **Phone normalization** — last-10 works for mobiles; Chennai landlines (044 + 8 digits)
  may mis-normalize — fuzzy name is the safety net; never auto-link.
- **Privacy** — `.vcf` is gitignored; staging holds only pre-picked cards; keep phone
  numbers out of logs.
