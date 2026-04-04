# Contacts Database — Design Spec

> Date: 2026-04-04
> Author: Claude (with Vivek)
> Scope: Separate contacts + companies system, linked to leads/proposals/projects

---

## 1. Problem

Customer data is currently embedded directly in `leads.customer_name` and duplicated to `projects.customer_name`. There's no concept of a company, no way to track multiple people at a company, and no way to handle when someone moves between companies. For commercial/industrial projects (builders, factories), Shiroi deals with 5-6 people per company (owner, COO, purchase head, finance, site in-charge, electrical head, PM) — none of this can be captured today.

## 2. Data Model

### 2.1 `companies` table

Represents an organization (builder firm, factory, homeowner household).

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | PK | `gen_random_uuid()` |
| `name` | TEXT | Yes | Company name. For residential: homeowner's name |
| `segment` | `customer_segment` enum | Yes | residential / commercial / industrial |
| `gstin` | TEXT | No | GST number |
| `address_line1` | TEXT | No | |
| `address_line2` | TEXT | No | |
| `city` | TEXT | No | |
| `state` | TEXT | No | Default 'Tamil Nadu' |
| `pincode` | TEXT | No | |
| `website` | TEXT | No | |
| `notes` | TEXT | No | |
| `created_at` | TIMESTAMPTZ | Auto | |
| `updated_at` | TIMESTAMPTZ | Auto | |

RLS: Readable by all authenticated employees. Writable by founder, hr_manager, sales_engineer.

### 2.2 `contacts` table

Represents a person. Exists independently of any company. Never deleted.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | PK | `gen_random_uuid()` |
| `name` | TEXT | Yes | Full name of the person |
| `phone` | TEXT | No | Primary phone |
| `email` | TEXT | No | |
| `designation` | TEXT | No | Current designation (free text) |
| `notes` | TEXT | No | |
| `created_at` | TIMESTAMPTZ | Auto | |
| `updated_at` | TIMESTAMPTZ | Auto | |

RLS: Readable by all authenticated employees. Writable by all employees (anyone might add a contact during a project).

### 2.3 `contact_company_roles` table

Links a person to a company with a role title and time range. A person can have multiple rows (multiple companies over time, or multiple roles at one company).

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | PK | `gen_random_uuid()` |
| `contact_id` | UUID FK → contacts | Yes | |
| `company_id` | UUID FK → companies | Yes | |
| `role_title` | TEXT | Yes | Free text: "Purchase Head", "Owner", "Site In-charge", etc. |
| `is_primary` | BOOLEAN | Default false | Primary contact at this company |
| `started_at` | DATE | No | When they started this role |
| `ended_at` | DATE | No | NULL = still active |
| `created_at` | TIMESTAMPTZ | Auto | |

RLS: Same as contacts.

### 2.4 `entity_contacts` table

Links contacts to leads, proposals, or projects with a role label specific to that entity.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | PK | `gen_random_uuid()` |
| `contact_id` | UUID FK → contacts | Yes | |
| `entity_type` | TEXT | Yes | CHECK: 'lead', 'proposal', 'project' |
| `entity_id` | UUID | Yes | ID of the lead/proposal/project |
| `role_label` | TEXT | No | Free text: "Decision Maker", "Accounts", "Site Contact" |
| `is_primary` | BOOLEAN | Default false | Primary contact for this entity |
| `created_at` | TIMESTAMPTZ | Auto | |

Unique constraint: `(contact_id, entity_type, entity_id)` — same person can't be linked twice to same entity.

RLS: Same as contacts.

## 3. Changes to Existing Tables

### `leads` table
- Add `company_id` UUID FK → companies (nullable, for backward compatibility)
- Keep `customer_name` as-is (denormalized display field, existing data stays)

### `projects` table
- Add `company_id` UUID FK → companies (nullable)
- Keep `customer_name`, `customer_phone`, `customer_email` as-is (denormalized)

No data migration needed immediately — existing records keep their embedded customer data. New records can optionally link to companies/contacts. Over time, data cleanup links existing records to proper contacts.

## 4. UI Pages

### 4.1 `/contacts` — Contacts List
- Searchable table of all contacts (people)
- Columns: Name (linked to detail), Phone, Email, Company (current active company), Designation
- Search across name, phone, email
- Pagination (50/page, same component as leads)
- "New Contact" button

### 4.2 `/contacts/[id]` — Contact Detail
- **Person card**: Name, phone, email, designation, notes (inline editable)
- **Companies card**: Table of all company affiliations with role, dates, active/ended badge
- **Linked entities card**: Table of all leads/proposals/projects this person is linked to, with role label and link to each entity

### 4.3 `/companies` — Companies List
- Searchable table of all companies
- Columns: Name (linked to detail), Segment badge, City, GSTIN, Contact Count
- Search across name, city, GSTIN
- Pagination (50/page)
- "New Company" button

### 4.4 `/companies/[id]` — Company Detail
- **Company card**: Name, segment, GSTIN, address, website, notes (inline editable)
- **People card**: Table of contacts at this company with role, active/ended, phone, email
- **Projects card**: Table of projects linked to this company

### 4.5 Lead/Proposal/Project Detail Pages — Contacts Card
- A "Contacts" card added to each detail page
- Shows linked contacts: Name (linked to `/contacts/[id]`), Role Label, Phone
- "Add Contact" button opens a search-and-link dialog:
  - Search existing contacts by name/phone
  - Select one, assign a role label
  - Or "Create New" to add a contact inline
- "Remove" to unlink (doesn't delete the contact, just removes the entity_contacts row)

### 4.6 Lead/Proposal List Pages
- Contact info is NOT shown in the table columns
- The contact name is accessible via the detail page's Contacts card

## 5. Sidebar Navigation

Add a new "Contacts" section to the sidebar (visible to all roles):
- Contacts (people)
- Companies

## 6. Migration Strategy

### SQL Migration (new file: `supabase/migrations/016_contacts.sql`)
1. Create `companies` table
2. Create `contacts` table
3. Create `contact_company_roles` table
4. Create `entity_contacts` table
5. Add `company_id` FK to `leads` and `projects`
6. RLS policies on all 4 new tables
7. Updated_at triggers on companies and contacts

### Data Backfill (optional, later)
- Script to extract unique `customer_name` values from leads → create companies + contacts
- Link existing leads/projects to those companies
- This is data cleanup work, not part of the initial build

## 7. Build Order

1. **Migration**: Create all 4 tables + FKs + RLS
2. **Types**: Regenerate `packages/types/database.ts`
3. **Queries**: contacts-queries.ts, companies-queries.ts
4. **Server actions**: contacts-actions.ts (create, update, link, unlink)
5. **Pages**: /contacts, /contacts/[id], /companies, /companies/[id]
6. **Contact card component**: Reusable card for lead/proposal/project detail pages
7. **Sidebar**: Add Contacts section
8. **Wire contact cards** into existing lead detail, proposal detail, project detail pages
