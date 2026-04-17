# Contacts Module

> HubSpot-style CRM: person and organization as separate entities, linked by roles, with a polymorphic engagement timeline across leads / proposals / projects.
> Related modules: [sales](./sales.md), [projects](./projects.md). See also master reference §6 (sales + customer data).

## Overview

Contacts V2 treats a **person** (`contacts`) and an **organization** (`companies`) as separate first-class entities — a deliberate HubSpot-style split away from the old "one row per customer" model. A person can belong to zero, one, or many companies via the `contact_company_roles` junction (with role titles and start/end dates), and any lead / proposal / project can reference any number of contacts via the polymorphic `entity_contacts` junction with a free-form `role_label` (primary / engineering / accounts / finance, etc.). A single `activities` timeline — also polymorphic via `activity_associations` — surfaces notes, calls, emails, meetings, site visits, WhatsApp messages, tasks, and status changes under any entity that touches the contact. Company is **optional**: residential homeowners typically have no company, and that's fine. After the Apr 4 backfill the DB holds ~1,115 contacts and ~56 companies.

## Routes

```
/contacts                    ← list (DataTable, CONTACT_COLUMNS, lifecycle-stage filter)
/contacts/new                ← create contact
/contacts/[id]               ← contact detail (company roles, linked entities, activity timeline)
/contacts/[id]/edit          ← edit contact

/companies                   ← list (DataTable, COMPANY_COLUMNS, segment filter)
/companies/new               ← create company
/companies/[id]              ← company detail (people, linked leads/projects, activity timeline)
/companies/[id]/edit         ← edit company
```

Both list pages use the shared `data-table` component with DB-backed saved views from `table_views` (migration 018) — filter / column-visibility / sort state is persisted per user per entity.

## Data Model

### `contacts` — a person (migration 016 + 017)

- `id`, `name` (auto-generated from first+last via `trg_contact_display_name`), `first_name`, `last_name`
- `phone`, `secondary_phone`, `email`, `designation`, `notes`
- `lifecycle_stage` TEXT — `subscriber → lead → opportunity → customer → evangelist` (HubSpot's 5-stage funnel)
- `source` TEXT — free-form acquisition source
- `owner_id` UUID → `profiles.id` — the Shiroi owner of this relationship
- `created_at`, `updated_at`
- Indexed on `name`, `phone`, `email`

### `companies` — an organization (migration 016 + 017)

- `id`, `name`, `segment` (residential / commercial / industrial enum)
- `gstin`, `pan`, `industry`, `company_size` (small / medium / large)
- `address_line1/2`, `city`, `state` (default `Tamil Nadu`), `pincode`, `website`, `notes`
- `owner_id` UUID → `profiles.id`

### `contact_company_roles` — person ↔ company junction

- `contact_id`, `company_id`, `role_title` TEXT (required), `is_primary` BOOL
- `started_at`, `ended_at` DATE — a contact with `ended_at IS NULL` is currently at that org
- Lets one person sit on multiple boards / act as a consultant to multiple firms simultaneously

### `entity_contacts` — polymorphic contact ↔ lead/proposal/project

- `contact_id`, `entity_type` (`lead` | `proposal` | `project`), `entity_id`, `role_label` TEXT, `is_primary` BOOL
- UNIQUE on `(contact_id, entity_type, entity_id)` — a contact can't be duplicated on the same entity, but the same contact can appear on many entities with different role labels
- This is how a project surfaces its primary / engineering / accounts contacts in parallel

### `activities` — engagement log (migration 017)

- `activity_type` CHECK: `note` | `call` | `email` | `meeting` | `site_visit` | `whatsapp` | `task` | `status_change`
- `title`, `body`, `occurred_at`, `duration_minutes`, `owner_id`, `metadata` JSONB

### `activity_associations` — polymorphic activity ↔ entity

- `activity_id`, `entity_type` CHECK: `contact` | `company` | `lead` | `proposal` | `project`, `entity_id`
- UNIQUE on `(activity_id, entity_type, entity_id)` — same activity surfaces on every linked entity's timeline (a site visit for a project shows under the contact, the company, the lead, and the project)

## Key Files

```
apps/erp/src/app/(erp)/contacts/
  page.tsx, new/page.tsx
  [id]/page.tsx, [id]/edit/page.tsx

apps/erp/src/app/(erp)/companies/
  page.tsx, new/page.tsx
  [id]/page.tsx, [id]/edit/page.tsx

apps/erp/src/lib/
  contacts-queries.ts   ← getContacts, getContact, getCompanies, getCompany,
                          getEntityContacts, getContactEntities, searchContacts,
                          getEntityActivities
  contacts-actions.ts   ← createContact, updateContact, createCompany, updateCompany,
                          linkContactToEntity, unlinkContactFromEntity,
                          addContactToCompany, endContactCompanyRole, createActivity

apps/erp/src/components/contacts/
  contact-form.tsx           ← create/edit person (first/last, phone, email, lifecycle, owner)
  company-form.tsx           ← create/edit organization (name, segment, GSTIN, PAN, industry)
  contacts-table-wrapper.tsx ← wires /contacts list to CONTACT_COLUMNS + saved views
  companies-table-wrapper.tsx
  add-contact-dialog.tsx     ← inline dialog used from lead/project detail to attach a contact
  entity-contacts-card.tsx   ← the "People" card on lead/proposal/project detail
  activity-timeline.tsx      ← HubSpot-style timeline; reads from activity_associations

apps/erp/src/components/data-table/column-config.ts
  CONTACT_COLUMNS            ← 11 columns (name + first/last/phone/secondary/email/designation/
                               lifecycle_stage/company_name/source/created_at)
  COMPANY_COLUMNS            ← 7 columns (name, segment, city, GSTIN, industry, state, created_at)
```

## Business Rules & Gotchas

- **Company is optional.** Residential customers (the majority of Shiroi's volume) are a pure `contacts` row with no `contact_company_roles` link. Never gate a feature on a contact having a company.
- **Name is derived.** `contacts.name` is auto-set by `trg_contact_display_name` from `first_name` + `last_name` on every INSERT/UPDATE when `first_name IS NOT NULL`. Legacy rows that predate the V2 split retain their original name until edited.
- **Phone dedup history.** 284 contacts with duplicate phones were merged on Apr 4, 2026. No duplicates remain. Related: `leads.phone` has a **partial unique index** that excludes `disqualified` and `lost` statuses (see [sales.md](./sales.md)) — so re-engaging a lost lead with the same phone still works.
- **Multiple orgs per person.** `contact_company_roles` intentionally has no uniqueness constraint on `(contact_id, company_id)` — a consultant who advises multiple firms, or switches firms over time, gets one row per role with `started_at` / `ended_at` bounding each stint.
- **Multiple contacts per entity.** `entity_contacts` is how a project carries its primary contact, engineering contact, accounts contact, and so on in parallel. Use `role_label` for the human description; `is_primary` picks the one that shows in compact UI.
- **Polymorphic activity surface.** A single activity row with two `activity_associations` (e.g. `contact` + `project`) appears on both timelines without duplication — the timeline component reads the `activity_associations` index, not `activities` directly.
- **Smart name + company splitting.** The Apr 4 backfill used regex detection on free-text customer names — tokens like `Pvt`, `Ltd`, `LLP`, `Industries`, `Enterprises` routed the string to the `companies` table; everything else became a `contacts` row with a best-effort first/last split. Reuse the same helper if you ever re-import from a CSV.
- **Lifecycle stage is NOT lead status.** `lifecycle_stage` on `contacts` is HubSpot's CRM funnel (subscriber → evangelist). `status` on `leads` is Shiroi's sales pipeline (new → won / lost). They move independently: a contact stays `customer` forever even after their lead closes.
- **Saved views are per user.** `table_views` (migration 018) stores `visibility` as `private` | `team` | `everyone`. The list pages hydrate columns / filters / sort from the active view — don't hardcode defaults in the page component.

## Recent Changes

- **Apr 4, 2026 — Migration 017 (Contacts V2).** Cleared all backfilled data (names were project names), added `first_name` / `last_name` / `lifecycle_stage` / `secondary_phone` / `owner_id` / `source` on contacts; `pan` / `industry` / `company_size` / `owner_id` on companies; created `activities` + `activity_associations` tables with RLS + the display-name trigger.
- **Apr 4, 2026 — Migration 018 (`table_views`).** HubSpot-style saved views for list pages (leads, proposals, projects, contacts, companies, vendors, purchase_orders, invoices, tasks).
- **Apr 4, 2026 — Smart backfill.** Ran the name/company-detection regex over legacy customer strings; rebuilt `contacts` + `companies` + `contact_company_roles` from clean sources.
- **Apr 4, 2026 — Phone dedup.** 284 duplicate-phone contacts merged; 0 duplicates remain.
- **Apr 4, 2026 — Contact backfill from leads.** 367 leads had no linked contact; 364 `contacts` rows were created or linked via `entity_contacts`, 3 junk leads were excluded.

## Related Migrations

- **016** — Initial contacts DB: `companies`, `contacts`, `contact_company_roles`, `entity_contacts`, `leads.company_id`, `projects.company_id`, RLS
- **017** — Contacts V2: first/last name, lifecycle stage, owner, source, PAN, industry, company size, `activities`, `activity_associations`, display-name trigger
- **018** — `table_views` (saved views per user per entity)
