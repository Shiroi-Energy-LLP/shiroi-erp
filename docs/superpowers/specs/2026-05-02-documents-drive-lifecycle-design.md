# Documents Index + Drive Folder Lifecycle — Design

> Date: 2026-05-02
> Reporter: Vivek
> Author: Claude (Opus, planning)
> Builds on: `docs/superpowers/specs/2026-04-03-google-drive-proposal-migration-design.md` (one-shot historical Drive→DB migration)

## Context

Files for a customer's solar journey live in three places today, with no unified index:
- **Supabase Storage** — `proposal-files` bucket (mig 013), holds generated proposal PDFs scoped to `lead_id`. Current proposals table has a single `current_pdf_storage_path` column.
- **Google Drive** — historical home of CAD, Sketchup, site survey photos, costing sheets, layouts. ~1,353 proposal folders migrated as data only (mig referenced in 2026-04-03 spec). Drive remains the team's working file system because (a) it's where Design and Site teams already live and (b) it's where files get shared with subcontractors and customers.
- **Nowhere** — site photos, AutoCAD layouts, panel datasheets that didn't make it into the proposal PDF or the Drive structure.

Three problems:

1. **Lifecycle continuity is broken.** A folder created during sales doesn't follow the customer to project execution to O&M. Files get re-uploaded or get lost when a lead converts to a proposal/project.
2. **No unified index.** Asking "show me every file for customer X" requires checking 2-3 systems by hand.
3. **AI ceiling.** To extract insights ("what was customer X's main concern", "find proposals with similar BOMs", "which projects had Sketchup revisions late in execution"), an AI agent needs queryable text + embeddings — Drive doesn't expose either at rest. Supabase can, but only for files we put there.

## Decision: hybrid storage with a `documents` table as unified index

**Recommendation: keep Drive AND Supabase, but stop letting them be the source of truth for "what files exist."** The new `documents` table is the index — every file (regardless of backend) gets exactly one row. Storage backend becomes an implementation detail.

### Why hybrid (not "move everything to Supabase")

| File type | Best home | Why |
|-----------|-----------|-----|
| AutoCAD (.dwg), Sketchup (.skp), large layout exports | **Drive** | Drive renders previews in browser, native external sharing for subs, no 50MB cap |
| Site photos (50–500 per project) | **Drive** | Cheap unlimited, easy to share with team WhatsApp links, Drive's photo gallery UX |
| Generated proposal PDF, generated invoices, BOMs | **Supabase Storage** | Lifecycle owned by the ERP, RLS aligned, sized in MBs |
| Salary slips, ID proofs, contracts | **Supabase Storage** | Sensitive — RLS in sync with DB |
| Customer-shared docs (electricity bills, KYC) | **Supabase Storage** | Auditable upload trail, RLS-controlled access |
| Costing sheets / structured Excel | **Drive** (live edit by team) → mirror text+structured-data into `documents.extracted_text` for AI | Team needs Sheets collaboration; AI reads the index |

Picking one backend forces a bad tradeoff. The team will not give up Drive (and shouldn't — the collab affordances are real). And Supabase Storage isn't sized or priced for hundreds of GB of CAD/Sketchup. Hybrid is honest about the system as actually used.

### Why the `documents` table beats "files columns on every table"

Today: `proposals.current_pdf_storage_path` is one column for one file. Adding "site photos", "design layouts", "BOM Excel", etc., as columns on `leads` / `proposals` / `projects` would multiply indefinitely and split the same logical artifact (e.g. a single layout file) across three tables when a lead converts.

A `documents` table with polymorphic associations (lead, proposal, project, om_ticket) lets one file row associate with as many entities as it relates to. When a proposal converts to a project, the project_id is added to the same documents row — file metadata stays in one place, the file itself doesn't move.

---

## `documents` table schema

```sql
-- Migration 109: documents index
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Polymorphic: any subset of these may be set as the customer journey progresses.
  -- At least one must be non-null (CHECK below).
  lead_id      UUID NULL REFERENCES leads(id)      ON DELETE SET NULL,
  proposal_id  UUID NULL REFERENCES proposals(id)  ON DELETE SET NULL,
  project_id   UUID NULL REFERENCES projects(id)   ON DELETE SET NULL,
  om_ticket_id UUID NULL REFERENCES om_tickets(id) ON DELETE SET NULL,

  -- Categorization
  category    TEXT NOT NULL,    -- enumerated below
  subcategory TEXT NULL,        -- free text for nuance (e.g. 'roof_layout', 'before', 'after')

  -- Storage
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('drive','supabase')),
  external_id     TEXT NULL,    -- Drive file ID (when storage_backend='drive')
  storage_path    TEXT NULL,    -- Supabase Storage path (when storage_backend='supabase')
  external_url    TEXT NULL,    -- Drive webViewLink — cached for cheap UI rendering
  parent_folder_id TEXT NULL,   -- Drive folder ID this file lives inside (Drive only)

  -- Metadata
  name       TEXT NOT NULL,
  mime_type  TEXT NULL,
  size_bytes BIGINT NULL,

  -- AI surface
  extracted_text TEXT NULL,        -- populated async by extract_document_text() job
  embedding      vector(1536) NULL,-- pgvector — populated async by embed_document() job
  tags           TEXT[] NOT NULL DEFAULT '{}',
  ai_summary     TEXT NULL,        -- short LLM-generated summary for fast UI hover

  -- Audit
  uploaded_by UUID NULL REFERENCES employees(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Storage backend integrity
  CHECK (
    (storage_backend = 'drive'    AND external_id IS NOT NULL) OR
    (storage_backend = 'supabase' AND storage_path IS NOT NULL)
  ),
  -- At least one entity association
  CHECK (
    lead_id IS NOT NULL OR proposal_id IS NOT NULL OR
    project_id IS NOT NULL OR om_ticket_id IS NOT NULL
  )
);

CREATE INDEX idx_documents_lead     ON documents(lead_id)     WHERE lead_id IS NOT NULL;
CREATE INDEX idx_documents_proposal ON documents(proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX idx_documents_project  ON documents(project_id)  WHERE project_id IS NOT NULL;
CREATE INDEX idx_documents_om       ON documents(om_ticket_id)WHERE om_ticket_id IS NOT NULL;
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_external_id ON documents(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
```

Requires: `CREATE EXTENSION IF NOT EXISTS vector;` (pgvector — already supported on Supabase).

### Categories (controlled vocabulary)

Allowed `category` values, enforced via CHECK or a separate enum table:

- `site_survey_photo`
- `site_survey_report`
- `roof_layout`
- `electrical_sld` (Single Line Diagram)
- `cad_drawing` (.dwg)
- `sketchup_model` (.skp)
- `proposal_pdf` (generated by ERP)
- `costing_sheet` (Excel/Sheets)
- `bom_excel`
- `kyc_document`
- `electricity_bill`
- `signed_proposal`
- `purchase_order`
- `invoice`
- `payment_receipt`
- `commissioning_report`
- `liaison_document`
- `as_built_drawing`
- `om_photo`
- `om_report`
- `misc`

If a file fits two categories (an Excel that's both costing sheet and BOM), pick the dominant one and use `tags[]` for the secondary classification.

### Lifecycle inheritance: the join trick

When a lead becomes a proposal, the existing `documents` rows for that lead **don't move** — we just set `proposal_id` on them. Same when a proposal becomes a project. Same when a project gets an O&M ticket.

```sql
-- Trigger on proposals INSERT: copy lead_id docs forward
CREATE OR REPLACE FUNCTION inherit_documents_to_proposal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents
  SET proposal_id = NEW.id, updated_at = NOW()
  WHERE lead_id = NEW.lead_id AND proposal_id IS NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_inherit_documents_to_proposal
  AFTER INSERT ON proposals FOR EACH ROW
  EXECUTE FUNCTION inherit_documents_to_proposal();
```

(Analogous triggers for `proposals → projects` and `projects → om_tickets`.)

This keeps "all documents for customer X" trivially queryable: `SELECT * FROM documents WHERE lead_id = $1 OR project_id IN (SELECT id FROM projects WHERE lead_id = $1)`.

### `current_pdf_storage_path` deprecation

Existing column on `proposals` is preserved (don't break anything). New PDFs create a `documents` row AND set `current_pdf_storage_path` for backwards compat. Future spec can drop the column once all readers migrate to `documents`.

---

## Drive folder lifecycle (Option C, per discussion)

### Folder structure

One folder per customer journey. Naming uses lead's customer name + a short stable identifier:

```
Shiroi Customers/
  └── 2025-26/
        └── L-{lead_short_id} — {Customer Name}/
              ├── 01-design/             ← layouts, CAD, Sketchup, photos
              ├── 02-proposals/          ← signed PDFs go here too
              ├── 03-execution/          ← site photos during installation
              ├── 04-handover/           ← commissioning, as-built, customer copy
              └── 05-om/                 ← maintenance reports, post-install issues
```

`L-{lead_short_id}` is the first 8 chars of the lead UUID (e.g., `L-01905444`). Year folder uses the financial year of lead creation. Customer Name from `leads.customer_name`, slashes/colons stripped, max 60 chars.

### Folder creation triggers (two paths)

**Path 1 — Manual button (Design-team triggered):**
- Visible on lead detail page (`/sales/[id]`) once lead status enters `design_in_progress` (Marketing→Design handoff).
- Roles: `design`, `marketing_manager`, `founder`.
- Click creates folder + sub-folders, writes `drive_folder_id` + `drive_folder_url` to `leads`, surfaces "Open in Drive ↗" link.

**Path 2 — Auto on quick quote:**
- Trigger: `leads.status` transitions to `quick_quote_sent`.
- ERP fires `lead.quick_quote_sent` event to `N8N_EVENT_BUS_URL`.
- n8n workflow creates folder + sub-folders, writes back via Supabase REST.

Both paths are idempotent: if `leads.drive_folder_id` is already set, do nothing. UI button greys out + reads "Drive folder ↗".

### `leads` columns added

```sql
ALTER TABLE leads
  ADD COLUMN drive_folder_id  TEXT NULL,
  ADD COLUMN drive_folder_url TEXT NULL;

COMMENT ON COLUMN leads.drive_folder_id  IS 'Google Drive folder ID for this customer journey. One folder per lead, inherited by proposals/projects/O&M.';
COMMENT ON COLUMN leads.drive_folder_url IS 'Cached webViewLink for the Drive folder — surfaced in UI without an extra Drive API roundtrip.';
```

Proposals and projects don't get their own folder columns — they read via the lead. (When a project's lead is null because of legacy data, the project page falls back to "no Drive folder.")

### n8n workflow `12-drive-folder-create.json` (sketch)

Nodes (left → right):
1. **Webhook trigger** — receives `{ event: 'lead.quick_quote_sent', lead_id, customer_name, status, fy }` from ERP event bus, gated by `x-webhook-secret`.
2. **Check existing** — query Supabase: `select drive_folder_id from leads where id = $lead_id`. If non-null, exit successfully.
3. **Resolve parent year folder** — lookup `Shiroi Customers/{fy}` (create if missing — first run of FY).
4. **Create folder** — Google Drive node, name = `L-{lead_id_short} — {customer_name_safe}`, parent = year folder ID.
5. **Create 5 sub-folders** in parallel — `01-design`, `02-proposals`, `03-execution`, `04-handover`, `05-om`.
6. **Set permissions** — share with `design@shiroienergy.com` group as Editor (or per `roles.ts` role-aware).
7. **Write back to Supabase** — UPDATE leads SET drive_folder_id, drive_folder_url WHERE id.
8. **Insert documents-table sentinel row** (optional) — a category=`misc`, subcategory=`folder_root` row pointing to the folder. Optional because folders aren't files; preferred for "show me everything Drive-side" queries.

### Manual button: same path

Server action `createDriveFolderForLead(leadId)` → calls the same n8n webhook with a `manual=true` flag (so n8n can log the difference). The button is just an alternate trigger for the same workflow — no duplicate Drive logic in TypeScript.

This keeps Drive credentials in n8n only (CLAUDE.md hosts the n8n event bus URL; service account creds live in n8n credential store, not in the Next.js app).

---

## File upload flow (post-folder-creation)

Two paths, both write a `documents` row:

### Path A — Drive upload (team's natural flow)

Today: a designer dropping a CAD file into Drive doesn't tell the ERP. To fix:

1. **n8n watcher workflow `13-drive-file-watcher.json`** runs every 30 minutes (cron).
2. For each lead with a `drive_folder_id`, list all files in the folder + sub-folders.
3. For each file not already in `documents` (lookup by `external_id`): insert a row, infer `category` from sub-folder (`02-proposals/x.pdf` → `proposal_pdf`), set `storage_backend='drive'`.
4. Trigger downstream extraction (Path C) for newly-indexed files.

Polling is acceptable here — Drive's push-notification API exists but adds infra complexity for marginal latency wins. 30-min lag is fine for an indexer.

### Path B — ERP upload (UI-driven)

User clicks "Upload" on a lead/proposal/project page → file goes to Supabase Storage → server action inserts `documents` row with `storage_backend='supabase'` → returns success.

This is the existing `proposal-files` flow extended to write `documents`. Don't break the existing bucket.

### Path C — Async extraction (the AI surface)

Edge function `process-document` triggered via Postgres NOTIFY when a `documents` row is inserted:

1. Pull file (download from Drive via API, or fetch from Supabase Storage).
2. Extract text:
   - PDF → `pdfjs` or `pdf-parse`.
   - Excel → `xlsx` (already a dependency from migration scripts).
   - Image → vision LLM call (Claude with image input — already an env var).
   - CAD/Sketchup → skip text extraction; tags only.
3. Update `documents.extracted_text`.
4. Generate embedding via OpenAI/Anthropic embeddings API → `documents.embedding`.
5. Generate `ai_summary` (1-2 sentence) via Claude.

Failures are logged to `system_logs` (existing table); the row stays without extracted_text and is retryable.

This is where the AI value lives. With this in place:
- "Find all proposals where the customer mentioned battery backup" — `WHERE extracted_text ILIKE '%battery%' AND category = 'signed_proposal'`.
- "Show me Sketchup files revised after project start" — `WHERE category='sketchup_model' AND uploaded_at > projects.actual_start_date`.
- "Customers with similar concerns to X" — vector similarity over embeddings.

---

## Backfill plan

### One-shot: index existing files

Two scripts (similar to the 7 Drive scripts already in `scripts/`):

1. **`scripts/index-supabase-storage.ts`** — list all files in `proposal-files` bucket, for each: find matching proposal via path → INSERT documents row.
2. **`scripts/index-drive-files.ts`** — for each lead/proposal already linked to a Drive folder (per existing notes-field URLs from migration 2026-04-03), list contents → INSERT documents rows.

Run with `--dry-run` first, persist audit CSV to `scripts/data/documents-backfill-audit.csv`.

### Async extraction backfill

After indexing, run `scripts/extract-existing-documents.ts` over all `documents` rows where `extracted_text IS NULL`. Rate-limited (Drive API quotas, embedding API costs). Report cost estimate before running on full ~1,353-folder corpus.

---

## Migration 109 — full surface

```sql
-- ============================================================================
-- Migration 109 — documents index + lifecycle inheritance + leads.drive_folder_*
-- Date: 2026-05-02
-- Why: Files for a customer journey live in Drive + Supabase + nowhere with no
--      unified index. AI insights need queryable text + embeddings. Lifecycle
--      continuity (lead → proposal → project → O&M) requires polymorphic
--      associations. Hybrid storage: Drive for collab/large, Supabase for
--      structured/sensitive, documents table as the index.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- (1) documents table (full schema above)
CREATE TABLE documents ( ... );

-- (2) lifecycle inheritance triggers
CREATE OR REPLACE FUNCTION inherit_documents_to_proposal() ...
CREATE OR REPLACE FUNCTION inherit_documents_to_project()  ...
CREATE OR REPLACE FUNCTION inherit_documents_to_om_ticket() ...

-- (3) leads.drive_folder_id, leads.drive_folder_url
ALTER TABLE leads
  ADD COLUMN drive_folder_id TEXT NULL,
  ADD COLUMN drive_folder_url TEXT NULL;

-- (4) RLS on documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
-- Read: same role rules as the parent entity (lead/proposal/project/om_ticket)
-- Write: insert by anyone with role 'sales' / 'design' / 'marketing_manager' / 'founder'
-- Delete: restricted to founder + the original uploaded_by

-- (5) Indexes (already in schema above)
```

---

## Files

**New (this spec — phase 1):**
- `supabase/migrations/109_documents_and_drive_folders.sql`
- `apps/erp/src/lib/documents-queries.ts`
- `apps/erp/src/lib/documents-actions.ts`
- `apps/erp/src/components/documents/document-list.tsx` — renders `documents` rows for a given entity
- `apps/erp/src/components/documents/upload-button.tsx` — Path B (ERP-side upload to Supabase)
- `apps/erp/src/components/leads/drive-folder-button.tsx` — Path 1 (manual create)
- `apps/erp/src/lib/events/emit-erp-event.ts` extension — add `lead.quick_quote_sent` event payload
- `infrastructure/n8n/workflows/12-drive-folder-create.json`
- `infrastructure/n8n/workflows/13-drive-file-watcher.json`

**New (phase 2 — async extraction, separate spec):**
- `supabase/functions/process-document/`
- Backfill scripts: `scripts/index-supabase-storage.ts`, `scripts/index-drive-files.ts`, `scripts/extract-existing-documents.ts`

**Edited:**
- `apps/erp/src/lib/auth/roles.ts` — `documents.read|write` permissions per role.
- `apps/erp/src/app/(erp)/sales/[id]/page.tsx` — render `<DocumentList>` + `<DriveFolderButton>` + `<UploadButton>`.
- `apps/erp/src/app/(erp)/proposals/[id]/page.tsx` — same.
- `apps/erp/src/app/(erp)/projects/[id]/page.tsx` — same.
- `apps/erp/src/app/(erp)/om/[ticketId]/page.tsx` — same.

After migration: regenerate `packages/types/database.ts`.

---

## Acceptance criteria (phase 1 — index + folder creation)

1. Migration 109 applied on dev, types regenerated.
2. New lead with status moved to `quick_quote_sent` → n8n creates Drive folder + 5 sub-folders → `leads.drive_folder_id` populated within 30s.
3. Manual button on `/sales/[id]` (visible to design + marketing_manager + founder) creates folder when status is `design_in_progress`; greyed out when folder already exists.
4. Uploading a file via the ERP UI → file in Supabase Storage AND `documents` row exists with `storage_backend='supabase'`, `storage_path` set, `lead_id` set.
5. Inserting a proposal for a lead with existing `documents` rows: those rows now have `proposal_id` set (lifecycle inheritance trigger).
6. Querying `SELECT * FROM documents WHERE lead_id = $1 OR proposal_id IN (...) OR project_id IN (...)` returns the full file index for a customer journey.
7. UI: lead/proposal/project/O&M page renders a "Files" section listing all related `documents` rows with name + category + "Open" link (Drive webViewLink or Supabase signed URL).
8. `pnpm check-types` clean. `pnpm lint` clean. Forbidden-pattern gate clean.

## Acceptance criteria (phase 2 — async extraction, deferred)

9. Drive watcher workflow runs every 30 min, indexes new files into `documents`.
10. `process-document` edge function populates `extracted_text`, `embedding`, `ai_summary` for each new row within 5 min.
11. Vector similarity query: `SELECT id, name FROM documents ORDER BY embedding <=> '<query_embedding>' LIMIT 10` returns plausible matches.
12. Backfill scripts complete on full corpus, audit CSV produced.

---

## Risks / open questions

1. **Drive API quotas** — Drive's per-user quota is 1,000 requests/100s. Watcher polling 1,353+ folders every 30 min could hit it during burst windows. Mitigation: watcher iterates in chunks of 50 folders/poll, full sweep takes ~14 minutes — well under the cron interval.
2. **Service account permissions** — existing service account (`shiroi-migration-key.json` per 2026-04-03 spec) has Drive read; needs write for folder creation. Verify scopes and re-issue key if needed.
3. **Folder collision** — two leads with identical customer names create folders with the same display name (different IDs). Acceptable — Drive disambiguates by ID; the human-readable suffix is just hint.
4. **pgvector index size** — for 1,353 documents this is trivial. At 100k+ documents the IVFFlat index needs tuning (`lists` parameter); revisit when corpus grows.
5. **Drive folder permissions drift** — if a designer changes folder sharing manually, ERP's view may go stale. Acceptable: ERP only stores the URL, doesn't mirror permissions. Drive remains source of truth for sharing.
6. **Cost: AI extraction** — 1,353 backfill documents × avg embedding cost ≈ $5–15 one-time. Ongoing: ~$0.10/day. Acceptable. Confirm before running phase 2 backfill.
7. **Quick-quote auto-trigger could fire prematurely** — if a sales rep accidentally clicks `quick_quote_sent`, the folder is already created. Cleanup: idempotent re-create is a no-op; abandoned folders are visually noisy in Drive. Consider a "delete folder if lead reverts to earlier status within 1h" cleanup, but defer — likely a real edge case.
8. **Supabase pgvector availability** — verified available on Supabase managed Postgres; confirm extension installs cleanly via `apply_migration` MCP.

---

## Out of scope (for this spec)

- Phase 2 (async extraction, embeddings, AI summary) — deferred to a follow-up spec once phase 1 ships and the `documents` table has a stable shape.
- Migrating the existing `proposal-files` bucket structure or deprecating `proposals.current_pdf_storage_path`.
- WhatsApp file ingestion (drop a photo into a customer chat, route to documents). Future spec.
- Mobile photo upload from Site Survey (WatermelonDB sync of `documents` rows). Future spec, depends on mobile app build.
- Customer-facing portal showing files. Future spec.
- Auto-tagging / auto-categorization beyond folder-path inference. Future spec, in phase 2.

---

## Why this approach is AI-friendly long-term

The user's question — *"is the drive a good idea or should we just use supabase?"* — is the wrong frame. The right answer is **storage-agnostic indexing**: pick the storage backend per file type's needs, but always index in `documents`. AI agents query the index, not the storage backend.

Concrete payoff:
- An MCP server `query_customer_documents(customer_name)` returns rows from `documents` joined to leads/projects — works identically whether the file's in Drive or Supabase.
- Vector search on `embedding` column finds semantic matches across the entire corpus regardless of storage.
- New tools (CAD parsers, Sketchup metadata extractors) plug into Path C without changing where files live.
- If we ever want to fully migrate to Supabase: write a migrator that reads `documents WHERE storage_backend='drive'`, downloads, re-uploads to Supabase, flips the row's `storage_backend` + `storage_path`. The rest of the system doesn't notice.

Drive vs Supabase becomes a routing decision per file type, not a strategic bet. The strategic bet is on the `documents` index.

---

## Dependencies

- pgvector extension on Supabase (managed, available).
- Existing `googleapis` setup (already in `package.json` per 7 Drive scripts).
- n8n service account with Drive write scope (verify before phase 1 ship).
- `N8N_EVENT_BUS_URL` env var (already configured).
- No Anthropic / OpenAI extraction in phase 1 — phase 2 only.
