# Contacts Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate contacts + companies system with 4 new tables, 6 new pages, and contact cards on existing lead/proposal/project detail pages.

**Architecture:** 4 new DB tables (companies, contacts, contact_company_roles, entity_contacts) with RLS. company_id FK added to leads + projects. New query/action files follow existing paginated pattern. Reusable EntityContactsCard component wired into 3 detail pages.

**Tech Stack:** Supabase PostgreSQL, Next.js 14 App Router, TypeScript, Tailwind CSS, existing @repo/ui components

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/016_contacts.sql` | Create 4 tables, RLS, triggers, FKs |
| `apps/erp/src/lib/contacts-queries.ts` | Paginated queries for contacts + companies |
| `apps/erp/src/lib/contacts-actions.ts` | Server actions: create/update/link/unlink contacts + companies |
| `apps/erp/src/app/(erp)/contacts/page.tsx` | Contacts list page |
| `apps/erp/src/app/(erp)/contacts/[id]/page.tsx` | Contact detail page |
| `apps/erp/src/app/(erp)/contacts/new/page.tsx` | New contact page |
| `apps/erp/src/app/(erp)/companies/page.tsx` | Companies list page |
| `apps/erp/src/app/(erp)/companies/[id]/page.tsx` | Company detail page |
| `apps/erp/src/app/(erp)/companies/new/page.tsx` | New company page |
| `apps/erp/src/components/contacts/entity-contacts-card.tsx` | Reusable contacts card for lead/proposal/project detail |
| `apps/erp/src/components/contacts/add-contact-dialog.tsx` | Search + link contact dialog |
| `apps/erp/src/components/contacts/contact-form.tsx` | Form for creating/editing contacts |
| `apps/erp/src/components/contacts/company-form.tsx` | Form for creating/editing companies |

### Modified Files
| File | Changes |
|------|---------|
| `apps/erp/src/lib/roles.ts` | Add contacts + companies nav items + section to all roles |
| `apps/erp/src/app/(erp)/leads/[id]/page.tsx` | Add EntityContactsCard |
| `apps/erp/src/app/(erp)/proposals/[id]/page.tsx` | Add EntityContactsCard |
| `apps/erp/src/app/(erp)/projects/[id]/page.tsx` | Add EntityContactsCard |
| `packages/types/database.ts` | Regenerate after migration |

---

## Task 1: SQL Migration

**Files:**
- Create: `supabase/migrations/016_contacts.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/016_contacts.sql`:

```sql
-- Migration 016: Contacts Database
-- Companies + Contacts (people) as separate entities
-- Linked to leads/proposals/projects via entity_contacts

BEGIN;

-- ============================================================
-- 1. companies table
-- ============================================================
CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  segment         customer_segment NOT NULL DEFAULT 'commercial',
  gstin           TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT DEFAULT 'Tamil Nadu',
  pincode         TEXT,
  website         TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_name ON companies USING gin (name gin_trgm_ops);
CREATE INDEX idx_companies_segment ON companies (segment);

CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. contacts table (a person)
-- ============================================================
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  designation     TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_name ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX idx_contacts_phone ON contacts (phone);
CREATE INDEX idx_contacts_email ON contacts (email);

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. contact_company_roles (person ↔ company with role + dates)
-- ============================================================
CREATE TABLE contact_company_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_title      TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  started_at      DATE,
  ended_at        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ccr_contact ON contact_company_roles (contact_id);
CREATE INDEX idx_ccr_company ON contact_company_roles (company_id);

-- ============================================================
-- 4. entity_contacts (contact ↔ lead/proposal/project)
-- ============================================================
CREATE TABLE entity_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('lead', 'proposal', 'project')),
  entity_id       UUID NOT NULL,
  role_label      TEXT,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, entity_type, entity_id)
);

CREATE INDEX idx_ec_entity ON entity_contacts (entity_type, entity_id);
CREATE INDEX idx_ec_contact ON entity_contacts (contact_id);

-- ============================================================
-- 5. Add company_id FK to leads and projects
-- ============================================================
ALTER TABLE leads ADD COLUMN company_id UUID REFERENCES companies(id);
ALTER TABLE projects ADD COLUMN company_id UUID REFERENCES companies(id);

CREATE INDEX idx_leads_company ON leads (company_id);
CREATE INDEX idx_projects_company ON projects (company_id);

-- ============================================================
-- 6. RLS policies — use get_my_role() to avoid recursion
-- ============================================================

-- companies: all authenticated can read, most roles can write
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_read"
  ON companies FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "companies_insert"
  ON companies FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "companies_update"
  ON companies FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- contacts: all authenticated can read and write
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_read"
  ON contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "contacts_insert"
  ON contacts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "contacts_update"
  ON contacts FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- contact_company_roles: all authenticated
ALTER TABLE contact_company_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccr_read"
  ON contact_company_roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_insert"
  ON contact_company_roles FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_update"
  ON contact_company_roles FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_delete"
  ON contact_company_roles FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- entity_contacts: all authenticated
ALTER TABLE entity_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ec_read"
  ON entity_contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ec_insert"
  ON entity_contacts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ec_delete"
  ON entity_contacts FOR DELETE
  USING (auth.uid() IS NOT NULL);

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && git add supabase/migrations/016_contacts.sql && git commit -m "feat: migration 016 — contacts database (companies, contacts, entity_contacts, RLS)"
```

**NOTE:** This migration must be applied manually by pasting into Supabase SQL Editor (DEV). After applying, regenerate types:

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

---

## Task 2: Contacts Queries

**Files:**
- Create: `apps/erp/src/lib/contacts-queries.ts`

- [ ] **Step 1: Create the queries file**

Create `apps/erp/src/lib/contacts-queries.ts`:

```typescript
import { createClient } from '@repo/supabase/server';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Contacts ──

export interface ContactFilters {
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function getContacts(filters: ContactFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getContacts]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('contacts')
    .select(
      'id, name, phone, email, designation, created_at, contact_company_roles(company_id, role_title, is_primary, ended_at, companies(name))',
      { count: 'exact' }
    )
    .order('name', { ascending: true });

  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load contacts: ${error.message}`);
  }

  const total = count ?? 0;
  return { data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getContact(id: string) {
  const op = '[getContact]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*, contact_company_roles(*, companies(name, segment))')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load contact: ${error.message}`);
  }
  return data;
}

export async function getEntityContacts(entityType: string, entityId: string) {
  const op = '[getEntityContacts]';
  console.log(`${op} Starting for: ${entityType}/${entityId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('entity_contacts')
    .select('id, role_label, is_primary, contacts(id, name, phone, email, designation)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('is_primary', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load entity contacts: ${error.message}`);
  }
  return data ?? [];
}

export async function getContactEntities(contactId: string) {
  const op = '[getContactEntities]';
  console.log(`${op} Starting for: ${contactId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('entity_contacts')
    .select('id, entity_type, entity_id, role_label, is_primary, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load contact entities: ${error.message}`);
  }
  return data ?? [];
}

export async function searchContacts(query: string) {
  const op = '[searchContacts]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, email, designation')
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
    .order('name')
    .limit(20);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to search contacts: ${error.message}`);
  }
  return data ?? [];
}

// ── Companies ──

export interface CompanyFilters {
  search?: string;
  segment?: string;
  page?: number;
  pageSize?: number;
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getCompanies]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('companies')
    .select('id, name, segment, gstin, city, state, created_at', { count: 'exact' })
    .order('name', { ascending: true });

  if (filters.segment) query = query.eq('segment', filters.segment);
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,gstin.ilike.%${filters.search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load companies: ${error.message}`);
  }

  const total = count ?? 0;
  return { data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getCompany(id: string) {
  const op = '[getCompany]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('companies')
    .select('*, contact_company_roles(*, contacts(id, name, phone, email, designation))')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load company: ${error.message}`);
  }
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/contacts-queries.ts && git commit -m "feat: add contacts and companies query functions"
```

---

## Task 3: Contacts Server Actions

**Files:**
- Create: `apps/erp/src/lib/contacts-actions.ts`

- [ ] **Step 1: Create the server actions file**

Create `apps/erp/src/lib/contacts-actions.ts`:

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Contacts ──

export async function createContact(input: {
  name: string;
  phone?: string;
  email?: string;
  designation?: string;
  notes?: string;
}): Promise<{ success: boolean; contactId?: string; error?: string }> {
  const op = '[createContact]';
  console.log(`${op} Starting for: ${input.name}`);

  if (!input.name.trim()) return { success: false, error: 'Name is required' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim()?.toLowerCase() || null,
      designation: input.designation?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  return { success: true, contactId: data.id };
}

export async function updateContact(id: string, input: {
  name?: string;
  phone?: string;
  email?: string;
  designation?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateContact]';
  console.log(`${op} Starting for: ${id}`);

  const supabase = await createClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.phone !== undefined) updates.phone = input.phone.trim() || null;
  if (input.email !== undefined) updates.email = input.email.trim().toLowerCase() || null;
  if (input.designation !== undefined) updates.designation = input.designation.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('contacts').update(updates).eq('id', id);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  revalidatePath(`/contacts/${id}`);
  return { success: true };
}

// ── Companies ──

export async function createCompany(input: {
  name: string;
  segment: string;
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  website?: string;
  notes?: string;
}): Promise<{ success: boolean; companyId?: string; error?: string }> {
  const op = '[createCompany]';
  console.log(`${op} Starting for: ${input.name}`);

  if (!input.name.trim()) return { success: false, error: 'Company name is required' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('companies')
    .insert({
      name: input.name.trim(),
      segment: input.segment as any,
      gstin: input.gstin?.trim() || null,
      address_line1: input.addressLine1?.trim() || null,
      address_line2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || 'Tamil Nadu',
      pincode: input.pincode?.trim() || null,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/companies');
  return { success: true, companyId: data.id };
}

export async function updateCompany(id: string, input: {
  name?: string;
  segment?: string;
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  website?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCompany]';
  console.log(`${op} Starting for: ${id}`);

  const supabase = await createClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.segment !== undefined) updates.segment = input.segment;
  if (input.gstin !== undefined) updates.gstin = input.gstin.trim() || null;
  if (input.addressLine1 !== undefined) updates.address_line1 = input.addressLine1.trim() || null;
  if (input.addressLine2 !== undefined) updates.address_line2 = input.addressLine2.trim() || null;
  if (input.city !== undefined) updates.city = input.city.trim() || null;
  if (input.state !== undefined) updates.state = input.state.trim() || null;
  if (input.pincode !== undefined) updates.pincode = input.pincode.trim() || null;
  if (input.website !== undefined) updates.website = input.website.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('companies').update(updates).eq('id', id);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
  return { success: true };
}

// ── Link/Unlink Contacts to Entities ──

export async function linkContactToEntity(input: {
  contactId: string;
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  roleLabel?: string;
  isPrimary?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[linkContactToEntity]';
  console.log(`${op} Linking contact ${input.contactId} to ${input.entityType}/${input.entityId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('entity_contacts')
    .insert({
      contact_id: input.contactId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      role_label: input.roleLabel?.trim() || null,
      is_primary: input.isPrimary ?? false,
    });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    if (error.code === '23505') return { success: false, error: 'This contact is already linked' };
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads`);
  revalidatePath(`/proposals`);
  revalidatePath(`/projects`);
  return { success: true };
}

export async function unlinkContactFromEntity(entityContactId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[unlinkContactFromEntity]';
  console.log(`${op} Unlinking: ${entityContactId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('entity_contacts')
    .delete()
    .eq('id', entityContactId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads`);
  revalidatePath(`/proposals`);
  revalidatePath(`/projects`);
  return { success: true };
}

// ── Contact-Company Role ──

export async function addContactToCompany(input: {
  contactId: string;
  companyId: string;
  roleTitle: string;
  isPrimary?: boolean;
  startedAt?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addContactToCompany]';
  console.log(`${op} Adding contact ${input.contactId} to company ${input.companyId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('contact_company_roles')
    .insert({
      contact_id: input.contactId,
      company_id: input.companyId,
      role_title: input.roleTitle.trim(),
      is_primary: input.isPrimary ?? false,
      started_at: input.startedAt || null,
    });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/contacts/${input.contactId}`);
  revalidatePath(`/companies/${input.companyId}`);
  return { success: true };
}

export async function endContactCompanyRole(roleId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[endContactCompanyRole]';
  console.log(`${op} Ending role: ${roleId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('contact_company_roles')
    .update({ ended_at: new Date().toISOString().split('T')[0] })
    .eq('id', roleId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  revalidatePath('/companies');
  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/contacts-actions.ts && git commit -m "feat: add contacts server actions (create/update/link/unlink contacts + companies)"
```

---

## Task 4: Contact Form + Company Form Components

**Files:**
- Create: `apps/erp/src/components/contacts/contact-form.tsx`
- Create: `apps/erp/src/components/contacts/company-form.tsx`

- [ ] **Step 1: Create contact form**

Create `apps/erp/src/components/contacts/contact-form.tsx`:

```typescript
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createContact } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

export function ContactForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await createContact({
      name: form.get('name') as string,
      phone: form.get('phone') as string,
      email: form.get('email') as string,
      designation: form.get('designation') as string,
      notes: form.get('notes') as string,
    });

    setLoading(false);
    if (res.success && res.contactId) {
      router.push(`/contacts/${res.contactId}`);
    } else {
      setError(res.error ?? 'Failed to create contact');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>New Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name *</Label>
              <Input id="name" name="name" required placeholder="e.g., Rajesh Kumar" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" placeholder="10-digit mobile" maxLength={10} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" name="designation" placeholder="e.g., Purchase Head" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="flex w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-2 text-[13px] text-[#1A1D24] focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)]"
              placeholder="Any notes about this contact..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/contacts')} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Contact'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
```

- [ ] **Step 2: Create company form**

Create `apps/erp/src/components/contacts/company-form.tsx`:

```typescript
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createCompany } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

const SEGMENT_OPTIONS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

export function CompanyForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await createCompany({
      name: form.get('name') as string,
      segment: form.get('segment') as string,
      gstin: form.get('gstin') as string,
      addressLine1: form.get('addressLine1') as string,
      city: form.get('city') as string,
      state: form.get('state') as string,
      pincode: form.get('pincode') as string,
      website: form.get('website') as string,
      notes: form.get('notes') as string,
    });

    setLoading(false);
    if (res.success && res.companyId) {
      router.push(`/companies/${res.companyId}`);
    } else {
      setError(res.error ?? 'Failed to create company');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>New Company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input id="name" name="name" required placeholder="e.g., ABC Builders Pvt Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="segment">Segment *</Label>
              <Select id="segment" name="segment" required defaultValue="commercial">
                {SEGMENT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" name="gstin" placeholder="e.g., 33AABCU9603R1ZZ" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="e.g., Chennai" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="addressLine1">Address</Label>
              <Input id="addressLine1" name="addressLine1" placeholder="Street address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue="Tamil Nadu" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pincode">Pincode</Label>
              <Input id="pincode" name="pincode" placeholder="600001" maxLength={6} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="https://..." />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/companies')} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Company'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/contacts/ && git commit -m "feat: add ContactForm and CompanyForm components"
```

---

## Task 5: Contacts List + Detail + New Pages

**Files:**
- Create: `apps/erp/src/app/(erp)/contacts/page.tsx`
- Create: `apps/erp/src/app/(erp)/contacts/[id]/page.tsx`
- Create: `apps/erp/src/app/(erp)/contacts/new/page.tsx`

- [ ] **Step 1: Create contacts list page**

Create `apps/erp/src/app/(erp)/contacts/page.tsx`:

```typescript
import Link from 'next/link';
import { getContacts } from '@/lib/contacts-queries';
import {
  Card, CardContent, Button, Input, Pagination,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

interface ContactsPageProps {
  searchParams: Promise<{ search?: string; page?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getContacts({
    search: params.search || undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.search) filterParams.search = params.search;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Contacts</h1>
        <Link href="/contacts/new">
          <Button>New Contact</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-3">
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, phone, or email..."
              className="w-80"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
            {params.search && (
              <Link href="/contacts">
                <Button type="button" variant="ghost" size="sm">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Company</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-[#9CA0AB] py-8">
                    No contacts found.
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((contact: any) => {
                  const activeRole = contact.contact_company_roles?.find(
                    (r: any) => !r.ended_at
                  );
                  return (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Link href={`/contacts/${contact.id}`} className="text-[#00B050] hover:underline font-medium">
                          {contact.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{contact.phone ?? '—'}</TableCell>
                      <TableCell className="text-sm">{contact.email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{contact.designation ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {activeRole?.companies?.name ?? '—'}
                        {activeRole?.role_title && (
                          <span className="text-[#9CA0AB] ml-1">({activeRole.role_title})</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/contacts"
            searchParams={filterParams}
            entityName="contacts"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create contact detail page**

Create `apps/erp/src/app/(erp)/contacts/[id]/page.tsx`:

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContact, getContactEntities } from '@/lib/contacts-queries';
import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, entities] = await Promise.all([
    getContact(id),
    getContactEntities(id),
  ]);

  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contacts" className="text-sm text-[#00B050] hover:underline">&larr; Back to Contacts</Link>
        <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">{contact.name}</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Details */}
        <div className="col-span-2 space-y-6">
          {/* Person Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[#7C818E]">Phone</span>
                  <p className="font-mono mt-0.5">{contact.phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Email</span>
                  <p className="mt-0.5">{contact.email ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Designation</span>
                  <p className="mt-0.5">{contact.designation ?? '—'}</p>
                </div>
                {contact.notes && (
                  <div className="col-span-2">
                    <span className="text-[#7C818E]">Notes</span>
                    <p className="mt-0.5">{contact.notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Linked Entities */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Linked Leads / Proposals / Projects</CardTitle>
            </CardHeader>
            <CardContent>
              {entities.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">Not linked to any entities yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Primary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((ec: any) => (
                      <TableRow key={ec.id}>
                        <TableCell>
                          <Link
                            href={`/${ec.entity_type}s/${ec.entity_id}`}
                            className="text-[#00B050] hover:underline font-medium capitalize"
                          >
                            {ec.entity_type}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ec.role_label ?? '—'}</TableCell>
                        <TableCell>
                          {ec.is_primary && <Badge variant="success">Primary</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Companies */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Companies</CardTitle>
            </CardHeader>
            <CardContent>
              {(!contact.contact_company_roles || contact.contact_company_roles.length === 0) ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">No company affiliations.</p>
              ) : (
                <div className="space-y-3">
                  {contact.contact_company_roles.map((ccr: any) => (
                    <div key={ccr.id} className="rounded-md border border-[#DFE2E8] p-3">
                      <Link href={`/companies/${ccr.company_id}`} className="text-sm font-medium text-[#00B050] hover:underline">
                        {ccr.companies?.name}
                      </Link>
                      <p className="text-xs text-[#7C818E] mt-0.5">{ccr.role_title}</p>
                      {ccr.ended_at ? (
                        <Badge variant="neutral" className="mt-1 text-[9px]">Ended {ccr.ended_at}</Badge>
                      ) : (
                        <Badge variant="success" className="mt-1 text-[9px]">Active</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create new contact page**

Create `apps/erp/src/app/(erp)/contacts/new/page.tsx`:

```typescript
import { ContactForm } from '@/components/contacts/contact-form';

export default function NewContactPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">New Contact</h1>
      <ContactForm />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/contacts/ && git commit -m "feat: add contacts list, detail, and new pages"
```

---

## Task 6: Companies List + Detail + New Pages

**Files:**
- Create: `apps/erp/src/app/(erp)/companies/page.tsx`
- Create: `apps/erp/src/app/(erp)/companies/[id]/page.tsx`
- Create: `apps/erp/src/app/(erp)/companies/new/page.tsx`

- [ ] **Step 1: Create companies list page**

Create `apps/erp/src/app/(erp)/companies/page.tsx`:

```typescript
import Link from 'next/link';
import { getCompanies } from '@/lib/contacts-queries';
import {
  Card, CardContent, Button, Input, Select, Pagination, Badge,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

interface CompaniesPageProps {
  searchParams: Promise<{ search?: string; segment?: string; page?: string }>;
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getCompanies({
    search: params.search || undefined,
    segment: params.segment || undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.search) filterParams.search = params.search;
  if (params.segment) filterParams.segment = params.segment;
  const hasFilters = Object.keys(filterParams).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Companies</h1>
        <Link href="/companies/new">
          <Button>New Company</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-3">
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-40">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search by name, city, or GSTIN..."
              className="w-72"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
            {hasFilters && (
              <Link href="/companies">
                <Button type="button" variant="ghost" size="sm">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company Name</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>City</TableHead>
                <TableHead>GSTIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-[#9CA0AB] py-8">
                    No companies found.
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((company: any) => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <Link href={`/companies/${company.id}`} className="text-[#00B050] hover:underline font-medium">
                        {company.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={company.segment === 'residential' ? 'info' : company.segment === 'commercial' ? 'pending' : 'warning'} className="capitalize">
                        {company.segment}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{company.city ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{company.gstin ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/companies"
            searchParams={filterParams}
            entityName="companies"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create company detail page**

Create `apps/erp/src/app/(erp)/companies/[id]/page.tsx`:

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCompany } from '@/lib/contacts-queries';
import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getCompany(id);
  if (!company) notFound();

  const activeContacts = company.contact_company_roles?.filter((r: any) => !r.ended_at) ?? [];
  const pastContacts = company.contact_company_roles?.filter((r: any) => r.ended_at) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-[#00B050] hover:underline">&larr; Back to Companies</Link>
        <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">{company.name}</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Company Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Company Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[#7C818E]">Segment</span>
                  <p className="mt-0.5 capitalize">{company.segment}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">GSTIN</span>
                  <p className="font-mono mt-0.5">{company.gstin ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">City</span>
                  <p className="mt-0.5">{company.city ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">State</span>
                  <p className="mt-0.5">{company.state ?? '—'}</p>
                </div>
                {company.address_line1 && (
                  <div className="col-span-2">
                    <span className="text-[#7C818E]">Address</span>
                    <p className="mt-0.5">{company.address_line1}{company.address_line2 ? `, ${company.address_line2}` : ''}{company.pincode ? ` - ${company.pincode}` : ''}</p>
                  </div>
                )}
                {company.website && (
                  <div>
                    <span className="text-[#7C818E]">Website</span>
                    <p className="mt-0.5 text-[#00B050]">{company.website}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Contacts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">People at {company.name}</CardTitle>
            </CardHeader>
            <CardContent>
              {activeContacts.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">No contacts linked yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeContacts.map((ccr: any) => (
                      <TableRow key={ccr.id}>
                        <TableCell>
                          <Link href={`/contacts/${ccr.contacts?.id}`} className="text-[#00B050] hover:underline font-medium">
                            {ccr.contacts?.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ccr.role_title}</TableCell>
                        <TableCell className="font-mono text-sm">{ccr.contacts?.phone ?? '—'}</TableCell>
                        <TableCell className="text-sm">{ccr.contacts?.email ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Past Contacts */}
          {pastContacts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#7C818E]">Past Contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastContacts.map((ccr: any) => (
                      <TableRow key={ccr.id}>
                        <TableCell>
                          <Link href={`/contacts/${ccr.contacts?.id}`} className="text-[#00B050] hover:underline font-medium">
                            {ccr.contacts?.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ccr.role_title}</TableCell>
                        <TableCell className="text-sm text-[#7C818E]">{ccr.ended_at}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right sidebar - notes */}
        <div>
          {company.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#3F424D]">{company.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create new company page**

Create `apps/erp/src/app/(erp)/companies/new/page.tsx`:

```typescript
import { CompanyForm } from '@/components/contacts/company-form';

export default function NewCompanyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">New Company</h1>
      <CompanyForm />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/companies/ && git commit -m "feat: add companies list, detail, and new pages"
```

---

## Task 7: EntityContactsCard + AddContactDialog

**Files:**
- Create: `apps/erp/src/components/contacts/entity-contacts-card.tsx`
- Create: `apps/erp/src/components/contacts/add-contact-dialog.tsx`

- [ ] **Step 1: Create add-contact-dialog**

Create `apps/erp/src/components/contacts/add-contact-dialog.tsx`:

```typescript
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { linkContactToEntity, createContact } from '@/lib/contacts-actions';
import { Button, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@repo/ui';
import { Search, Plus, UserPlus } from 'lucide-react';

interface AddContactDialogProps {
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ entityType, entityId, open, onOpenChange }: AddContactDialogProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'search' | 'create'>('search');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [roleLabel, setRoleLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // New contact fields
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      setError('Search failed');
    }
    setLoading(false);
  }

  async function handleLink(contactId: string) {
    setLoading(true);
    const result = await linkContactToEntity({
      contactId,
      entityType,
      entityId,
      roleLabel: roleLabel.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to link contact');
    }
  }

  async function handleCreateAndLink() {
    if (!newName.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError(null);

    const createResult = await createContact({
      name: newName.trim(),
      phone: newPhone.trim() || undefined,
      email: newEmail.trim() || undefined,
    });

    if (!createResult.success || !createResult.contactId) {
      setLoading(false);
      setError(createResult.error ?? 'Failed to create contact');
      return;
    }

    const linkResult = await linkContactToEntity({
      contactId: createResult.contactId,
      entityType,
      entityId,
      roleLabel: roleLabel.trim() || undefined,
    });

    setLoading(false);
    if (linkResult.success) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(linkResult.error ?? 'Contact created but linking failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact to {entityType}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Role label — shared between search and create */}
          <div className="space-y-1.5">
            <Label>Role (optional)</Label>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="e.g., Purchase Head, Site Contact"
            />
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'search' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('search')}
              className="gap-1"
            >
              <Search className="h-3.5 w-3.5" /> Search Existing
            </Button>
            <Button
              variant={mode === 'create' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('create')}
              className="gap-1"
            >
              <UserPlus className="h-3.5 w-3.5" /> Create New
            </Button>
          </div>

          {mode === 'search' && (
            <>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or phone..."
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
                />
                <Button variant="outline" size="sm" onClick={handleSearch} disabled={loading}>
                  Search
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {searchResults.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleLink(c.id)}
                      disabled={loading}
                      className="w-full text-left rounded-md border border-[#DFE2E8] p-2 hover:bg-[#F8F9FB] transition-colors"
                    >
                      <p className="text-sm font-medium text-[#1A1D24]">{c.name}</p>
                      <p className="text-xs text-[#7C818E]">
                        {[c.phone, c.email, c.designation].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'create' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" />
                </div>
              </div>
              <Button onClick={handleCreateAndLink} disabled={loading} className="w-full gap-1">
                <Plus className="h-4 w-4" />
                {loading ? 'Creating...' : 'Create & Link'}
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-[#991B1B]">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create entity contacts card**

Create `apps/erp/src/components/contacts/entity-contacts-card.tsx`:

```typescript
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { unlinkContactFromEntity } from '@/lib/contacts-actions';
import { AddContactDialog } from './add-contact-dialog';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@repo/ui';
import { Plus, X, Users } from 'lucide-react';

interface EntityContact {
  id: string;
  role_label: string | null;
  is_primary: boolean;
  contacts: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    designation: string | null;
  } | null;
}

interface EntityContactsCardProps {
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  contacts: EntityContact[];
}

export function EntityContactsCard({ entityType, entityId, contacts }: EntityContactsCardProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = React.useState(false);

  async function handleUnlink(entityContactId: string) {
    const result = await unlinkContactFromEntity(entityContactId);
    if (result.success) router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-[#7C818E]" />
            Contacts
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="h-7 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-[#9CA0AB] py-2 text-center">No contacts linked.</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((ec) => (
                <div key={ec.id} className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <div>
                    <Link
                      href={`/contacts/${ec.contacts?.id}`}
                      className="text-sm font-medium text-[#00B050] hover:underline"
                    >
                      {ec.contacts?.name}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ec.role_label && (
                        <span className="text-xs text-[#7C818E]">{ec.role_label}</span>
                      )}
                      {ec.contacts?.phone && (
                        <span className="text-xs text-[#9CA0AB] font-mono">{ec.contacts.phone}</span>
                      )}
                      {ec.is_primary && <Badge variant="success" className="text-[8px]">Primary</Badge>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnlink(ec.id)}
                    className="text-[#9CA0AB] hover:text-[#991B1B] transition-colors"
                    title="Remove contact"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddContactDialog
        entityType={entityType}
        entityId={entityId}
        open={showAdd}
        onOpenChange={setShowAdd}
      />
    </>
  );
}
```

- [ ] **Step 3: Create search API route (needed by AddContactDialog)**

Create `apps/erp/src/app/api/contacts/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/lib/contacts-queries';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json([]);

  try {
    const results = await searchContacts(q);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/contacts/entity-contacts-card.tsx apps/erp/src/components/contacts/add-contact-dialog.tsx apps/erp/src/app/api/contacts/ && git commit -m "feat: add EntityContactsCard, AddContactDialog, and contacts search API"
```

---

## Task 8: Add Sidebar Navigation

**Files:**
- Modify: `apps/erp/src/lib/roles.ts`

- [ ] **Step 1: Add contacts + companies nav items and sections**

In `apps/erp/src/lib/roles.ts`, add two new items to the `ITEMS` object (before `} as const`):

```typescript
  contacts:       { label: 'Contacts',          href: '/contacts',           icon: 'Users' },
  companies:      { label: 'Companies',         href: '/companies',          icon: 'Building2' },
```

Then add a `Contacts` section to each role that should see it. For `founder`:

```typescript
  { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
```

Add this section to: `founder`, `sales_engineer`, `project_manager`, `purchase_officer`, `finance`.

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/roles.ts && git commit -m "feat: add Contacts + Companies to sidebar navigation"
```

---

## Task 9: Wire EntityContactsCard into Detail Pages

**Files:**
- Modify: `apps/erp/src/app/(erp)/leads/[id]/page.tsx`
- Modify: `apps/erp/src/app/(erp)/proposals/[id]/page.tsx`
- Modify: `apps/erp/src/app/(erp)/projects/[id]/page.tsx`

- [ ] **Step 1: Add to lead detail page**

In `apps/erp/src/app/(erp)/leads/[id]/page.tsx`:
- Import `getEntityContacts` from `@/lib/contacts-queries`
- Import `EntityContactsCard` from `@/components/contacts/entity-contacts-card`
- Add `getEntityContacts('lead', id)` to the `Promise.all` data fetch
- Add `<EntityContactsCard entityType="lead" entityId={id} contacts={entityContacts} />` to the right sidebar column

- [ ] **Step 2: Add to proposal detail page**

Same pattern in `apps/erp/src/app/(erp)/proposals/[id]/page.tsx`:
- Import and fetch `getEntityContacts('proposal', id)`
- Add `<EntityContactsCard entityType="proposal" entityId={id} contacts={entityContacts} />`

- [ ] **Step 3: Add to project detail page**

Same pattern in `apps/erp/src/app/(erp)/projects/[id]/page.tsx`:
- Import and fetch `getEntityContacts('project', id)`
- Add `<EntityContactsCard entityType="project" entityId={id} contacts={entityContacts} />`

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/leads/\[id\]/page.tsx apps/erp/src/app/\(erp\)/proposals/\[id\]/page.tsx apps/erp/src/app/\(erp\)/projects/\[id\]/page.tsx && git commit -m "feat: wire EntityContactsCard into lead, proposal, and project detail pages"
```

---

## Task 10: Type Check + Build + Push

- [ ] **Step 1: Regenerate types (after migration is applied)**

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 2: Run type check**

```bash
pnpm --filter @repo/erp check-types
```

Fix any type errors.

- [ ] **Step 3: Commit and push**

```bash
git add -A && git commit -m "feat: contacts database complete — types, build verification" && git push origin main
```

---

## Task 11: Update CLAUDE.md

- [ ] **Step 1: Update current state table**

Add entries:
- `Migration 016 | ✅ Applied (dev) | contacts, companies, contact_company_roles, entity_contacts + RLS`
- `Contacts system | ✅ Complete | /contacts, /companies pages, EntityContactsCard on leads/proposals/projects`

- [ ] **Step 2: Commit and push**

```bash
git add CLAUDE.md && git commit -m "docs: update CLAUDE.md — contacts system complete" && git push origin main
```
