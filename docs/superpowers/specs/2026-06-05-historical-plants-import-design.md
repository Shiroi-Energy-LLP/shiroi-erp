# Historical Plants Import + Plant Credentials Encryption — Design

> Spec date: 2026-06-05
> Owner: Vivek (founder) — review and approve each candidate before it lands
> Status: Spec — pending implementation
> Related:
> - `2026-04-16-plant-monitoring-design.md` (the original `plant_monitoring_credentials` table)
> - migration 156 (Sungrow direct-login), migration 157 (`inverters.project_id` nullable)
> - `scripts/data/master-projects-import-plan-2026-06-05.md` (the consolidated 541-record analysis this spec acts on)

## Why

Three years of historical project data lives in three XLSX workbooks Vivek has been maintaining manually (`SE MASTER FILE.xlsx`, `Master Data Sheet (1).xlsx`, `shiroienergy (1).xlsx`) plus a chat-pasted credentials dump. None of it is in the ERP. Cross-referencing them surfaces:

- **541 unique historical plants** across all five canonical sheets.
- **166** of those already exist as `projects` rows (exact + fuzzy match).
- **192 are flagged as Completed in the canonical `shiroienergy.Projects` sheet but do not exist in the DB** — these are the actionable list.
- Many carry monitoring portal credentials, local LAN admin/user creds, Jio modem credentials, data-logger MAC + PK, inverter serial numbers, AMC schedules, financial actuals. None of this is queryable today.

Also: the existing `plant_monitoring_credentials.password` column is plaintext. Per the credential-encryption design we agreed on earlier in this session, that has to be fixed in the same migration cycle — the historical import shouldn't extend the plaintext surface, and the Growatt poller (`inverter-poll/index.ts:770-789`) needs a SECURITY DEFINER decrypt RPC anyway.

The user-facing ambition Vivek stated: _"I want all old projects in the DB and a UI to see all complete projects, so we can be a company that cares about every plant we've ever installed and ensure they all run to their best possible."_

## Goals

1. **Stage** all 541 consolidated historical-plant records in a `pending_project_imports` table that an O&M reviewer can edit, approve, or reject per row.
2. **Encrypt** every password field (portal + local admin + local user + Jio modem) at rest, with a Vault-managed symmetric key shared between this staging table and the existing `plant_monitoring_credentials` table.
3. **Add 'deye' brand** + portal→brand reclassification (`solarmanpv.com` → `deye`) so the 84 Deye/Solarman plants land with the right brand from day one.
4. **Provide an interactive review UI** (`/om/import-review`) that lists candidates, lets the user fix typos / fill gaps / confirm matches, then on Approve **cascades** the row into `projects` + `inverters` + `plant_monitoring_credentials` (+ later `om_contracts` + `om_visits` for rows with AMC data).
5. **Auto-rollup multi-inverter clusters** (Chemfab SS_110/SS_55/DP/SP/RO; Mountmeru 108+87; Schangalaya/Schakaralaya 50+25; Mrinal Mills × 4 inverters; Metal Forms Redhills × 3) so each cluster becomes 1 `projects` row + N `inverters` rows, not 5 separate projects.
6. **Update the Growatt Edge Function poller** to call a SECURITY DEFINER decrypt RPC instead of reading the plaintext password column.

## Non-goals

- **Not** a portfolio-style public-facing showcase. The review UI is internal-only; a separate `/portfolio` view is a follow-up after the data is in.
- **Not** auto-creating AMC schedules during import. The AMC fields in the staging table are stored and rendered, but the cascade only fires `om_contracts` + `om_visits` creation when the reviewer explicitly opts in (per-row checkbox). Reason: AMC data quality is uneven and would create noise in the O&M Today queue.
- **Not** importing the per-project survey sheets from `SE MASTER FILE.xlsx` (Mr Muralidharan, Adhri, Mr Chakrapani, etc. — 30+ sheets). Those are working docs for in-flight design work, not historical project records, and would pollute the import queue.
- **Not** touching the `inverter_monitoring_credentials` table's data (Sungrow direct-login config, etc.) — only an additive `'deye'` entry to its brand CHECK constraint.
- **Not** building bulk-create-without-review. Each of the 192 completed-not-in-DB rows passes through the review UI individually. The reviewer can multi-select and bulk-approve, but every row gets one click of sign-off.

## Surface

### URL + role gating

- **Page:** `/om/import-review`
- **Section:** new entry under the existing O&M nav.
- **Roles:** `founder`, `om_technician`, `project_manager`. Other roles redirect to `/dashboard?notice=import-review-forbidden`.
- **RLS:** the new `pending_project_imports` table grants the same three roles SELECT + UPDATE; only `founder` can call the `approve_pending_import(p_id)` RPC that cascades the row into live tables.

### Layout

```
┌─ Tabs ──────────────────────────────────────────────────────────────────────────────┐
│ [Pending · 375]  [Approved · 0]  [Rejected · 0]  [Imported · 0]  [Errors · 0]       │
│                                                                                     │
│ Default view = Pending, default sort = match_confidence ASC then completed first    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Filters:  [Match ▼ all/exact/fuzzy/none]  [Status ▼ all/Completed/Running]          │
│          [Year ▼]  [Brand ▼]  [Has portal cred ▼]  [Search by name/email/phone]     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ KPI strip:  192 completed-no-match · 120 completed-already-in-DB · 24 fuzzy review  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ☐  Project Name              Year  Size   Status      Match           Action       │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ ☐  Ceebros Boulevard         2024  82kWp  Completed   none            [Review →]   │
│    ├ HW: Longi 550Wp×151 · Growatt MAC 50KTL3-X LV + MID 33KTL3-X · 8 strings       │
│    ├ Address: Thuraipakkam, Chennai                                                 │
│    ├ Contact: Vinayagam / 7373835519 / fm.boulevard@gmail.com                       │
│    ├ Portal: Growatt · Cbfoasolar / Solar123 (encrypted at rest)                    │
│    ├ AMC: Free AMC · 4 visits scheduled 2024-07-16 → 2025-04-12                     │
│    ├ Sources: Project details · shiroienergy.Projects · shiroienergy.Budgets · …    │
│    └ [Approve & Import]  [Reject]  [Edit Inline]                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Click row to expand into edit-inline form. All consolidated fields are editable (project name, system size, system type, panel/inverter make+model+qty, address, contact, portal brand/user/pass, local admin/user creds, Jio password, data logger MAC+PK, AMC schedule).

### Edit-inline behaviour

- Inline edits autosave to `pending_project_imports` on blur (no commit-then-rollback).
- Password fields show masked (•••••) with click-to-reveal + 30s re-mask, same as `PlantMonitoringPasswordCell`.
- The 5 multi-inverter clusters appear as a **single parent row** with a child-inverter expansion (Chemfab Alkalis with 5 children, etc.). Approving the parent cascades to 1 project + 5 inverters.
- Match-confidence column shows the candidate DB project_id; clicking it opens that project in a new tab so the reviewer can confirm visually before approving.
- A "Why this match?" tooltip on fuzzy matches lists the token-overlap evidence.

### Bulk approve

- Select rows via checkbox + a "Bulk approve N rows" button at the top.
- Bulk approve runs the same cascade per row sequentially (no parallel — keeps `projects.project_number` generation safe). Failures park the row in the Errors tab with the error message.

### Approval cascade — what actually happens

For each approved row:
1. Generate `project_number` as `SHIROI/PROJ/LEGACY/{4-digit sequence}` (separate sequence from the live `SHIROI/PROJ/YYYY-YY/NNNN` pattern — flags these as backfill rather than new orders).
2. Insert `projects` row with: `customer_name`, `customer_phone`, `customer_email`, `site_address_line1`, `site_city`, `site_state` (defaults to `'Tamil Nadu'` if address mentions Chennai/Coimbatore/etc.), `system_size_kwp`, `system_type` (mapped: `on_grid` / `off_grid` / `hybrid`), `panel_brand`, `panel_wattage`, `panel_count`, `inverter_brand`, `inverter_capacity_kw`, `commissioned_date`, `status = 'completed'`, `actual_end_date = commissioning_date`.
3. For each child-inverter sub-row (multi-inverter cluster), insert `inverters` row with `project_id = new project.id`, `brand`, `model`, `rated_capacity_kw`, `serial_number`. `project_id` is nullable per migration 157 — but for these cascade-inserts we know the parent, so always populate it.
4. If portal cred fields are present, insert `plant_monitoring_credentials` row with `project_id`, `portal_url`, `username`, `password_encrypted` (encrypt via the same Vault key the existing credentials use).
5. If local LAN admin/user creds + datalogger MAC are present, insert into the new `plant_local_setup` table (see Schema §3 below).
6. If "create AMC contract" checkbox is ticked AND AMC fields are populated, insert `om_contracts` + 4 `om_visits` rows mirroring the AMC schedule.
7. Set `pending_project_imports.status_review = 'imported'`, `imported_project_id = new project.id`, `reviewed_by = auth.uid()`, `reviewed_at = NOW()`.

Failures at any step rollback the whole cascade (`BEGIN`/`EXCEPTION`/`ROLLBACK`) and set `pending_project_imports.status_review = 'error'` + `import_error = <message>`.

## Schema

### Migration 158: encryption + Deye brand + Growatt poller RPC

Same as the encryption design we already agreed on (§3 of the brainstorm earlier in this session). Recap:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Vault secret bootstrap
INSERT INTO vault.secrets (name, secret, description)
SELECT 'plant_credentials_key', encode(gen_random_bytes(32), 'base64'),
       'AES-256 sym key for plant_monitoring_credentials + pending_project_imports + plant_local_setup'
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'plant_credentials_key');

-- 2. Key helper (SECURITY DEFINER, REVOKE PUBLIC)
CREATE OR REPLACE FUNCTION public.fn_plant_creds_key() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = 'plant_credentials_key' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_plant_creds_key() FROM PUBLIC, authenticated, anon;

-- 3. Add encrypted password column + backfill + drop plaintext
ALTER TABLE plant_monitoring_credentials ADD COLUMN password_encrypted BYTEA;
UPDATE plant_monitoring_credentials
SET password_encrypted = pgp_sym_encrypt(password, public.fn_plant_creds_key())
WHERE password_encrypted IS NULL;
ALTER TABLE plant_monitoring_credentials ALTER COLUMN password_encrypted SET NOT NULL;
ALTER TABLE plant_monitoring_credentials DROP COLUMN password;

-- 4. Add 'deye' brand to CHECKs (plant_monitoring_credentials, inverters, inverter_monitoring_credentials)
-- (drop + recreate; preserve 'solarman' for back-compat)

-- 5. Detect-brand helper: solarmanpv.com → 'deye'
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT) ... ;

-- 6. Reclassify the 2 existing dev rows currently solarman/other → deye
UPDATE plant_monitoring_credentials SET inverter_brand = 'deye'
  WHERE inverter_brand IN ('solarman','other')
    AND portal_url ILIKE '%solarmanpv%';

-- 7. Update fn_sync_plant_monitoring_from_commissioning to encrypt on insert
-- (replaces password = NEW.monitoring_password with password_encrypted = pgp_sym_encrypt(...))

-- 8. New RPC for Growatt poller
CREATE OR REPLACE FUNCTION public.get_growatt_creds_for_project(p_project_id UUID)
RETURNS TABLE (username TEXT, password TEXT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT username, pgp_sym_decrypt(password_encrypted, public.fn_plant_creds_key())::TEXT
  FROM plant_monitoring_credentials
  WHERE project_id = p_project_id AND inverter_brand IN ('growatt') AND deleted_at IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_growatt_creds_for_project(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_growatt_creds_for_project(UUID) TO service_role;

-- 9. Update search_plant_monitoring_credentials RPC to return decrypted password
-- 10. Extend get_plant_monitoring_summary with brand_deye field

COMMIT;
```

**Coordinated code change in same commit:** [supabase/functions/inverter-poll/index.ts:770-789](supabase/functions/inverter-poll/index.ts:770) swaps `.from('plant_monitoring_credentials').select('username, password').eq(...)` for `.rpc('get_growatt_creds_for_project', { p_project_id: inv.project_id })`. No `packages/inverter-adapters/src/growatt.ts` change — adapter still receives `(username, password)` strings.

### Migration 159: pending_project_imports staging table

```sql
BEGIN;

CREATE TABLE pending_project_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  project_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_sheets JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- e.g. [{"sheet":"shiroienergy.Projects","raw":"Mr Anandan"},
    --       {"sheet":"shiroienergy.Plant Monitoring","raw":"Mr Anandan"}]
  is_multi_inverter_parent BOOLEAN NOT NULL DEFAULT false,
  parent_import_id UUID REFERENCES pending_project_imports(id) ON DELETE CASCADE,
    -- For child-inverter rows of a multi-inverter cluster.

  -- Match outcome
  matched_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  matched_customer_name TEXT,
  match_confidence TEXT NOT NULL CHECK (match_confidence IN ('exact','fuzzy','none')),
  match_score NUMERIC(4,3) NOT NULL DEFAULT 0,

  -- Review lifecycle
  status_review TEXT NOT NULL DEFAULT 'pending'
    CHECK (status_review IN ('pending','approved','rejected','imported','error')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  imported_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ,
  import_error TEXT,
  rejection_reason TEXT,
  create_amc_contract BOOLEAN NOT NULL DEFAULT false,

  -- Project facts
  source_status TEXT,             -- 'Completed' / 'Running' / etc.
  source_year INT,
  system_size_kwp NUMERIC(8,2),
  system_type TEXT,               -- on_grid / off_grid / hybrid
  net_meter TEXT,
  rooftop_sqft NUMERIC,
  industry TEXT,
  category TEXT,                  -- Residential / Commercial / Industrial
  mounting_type TEXT,
  cable_make TEXT,
  la_scope TEXT,
  lifetime_kwh NUMERIC,
  project_cost NUMERIC(14,2),
  actual_cost NUMERIC(14,2),
  profit_inr NUMERIC(14,2),

  -- Hardware
  panel_make TEXT,
  panel_model TEXT,
  panel_wattage NUMERIC,
  panel_qty INT,
  inverter_make TEXT,
  inverter_model TEXT,
  inverter_capacity_kw NUMERIC(8,2),
  inverter_qty INT,
  inverter_serial_number TEXT,
  inverter_power_module_sn TEXT,
  acdb_sn TEXT,
  dcdb_sn TEXT,

  -- Location + contact
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT DEFAULT 'Tamil Nadu',
  pincode TEXT,
  google_maps_url TEXT,
  folder_link TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  commissioning_date DATE,

  -- Online monitoring credentials (encrypted)
  portal_brand TEXT,
  portal_url TEXT,
  portal_username TEXT,
  portal_password_encrypted BYTEA,

  -- Local LAN credentials (encrypted)
  local_login_ip TEXT,
  local_admin_user TEXT,
  local_admin_password_encrypted BYTEA,
  local_user TEXT,
  local_user_password_encrypted BYTEA,

  -- Internet connectivity (encrypted)
  internet_type TEXT,             -- Jio Modem / Wifi / LAN / Router
  jio_password_encrypted BYTEA,
  jio_primary_sim TEXT,
  jio_backup_sim TEXT,

  -- Data logger
  datalogger_mac TEXT,
  datalogger_pk TEXT,

  -- AMC (optional cascade — gated by create_amc_contract)
  amc_type TEXT,
  amc_visits JSONB DEFAULT '[]'::jsonb,
    -- [{"scheduled":"2024-07-16","completed":null},{"scheduled":"2024-10-14","completed":"2024-10-15"},…]

  -- Audit
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_pending_imports_status ON pending_project_imports (status_review);
CREATE INDEX idx_pending_imports_match ON pending_project_imports (match_confidence) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_year ON pending_project_imports (source_year) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_brand ON pending_project_imports (portal_brand) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_parent ON pending_project_imports (parent_import_id) WHERE parent_import_id IS NOT NULL;
CREATE UNIQUE INDEX idx_pending_imports_normalized_active
  ON pending_project_imports (normalized_name)
  WHERE status_review IN ('pending','approved') AND parent_import_id IS NULL;

ALTER TABLE pending_project_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_imports_select ON pending_project_imports FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role,'project_manager'::app_role,'om_technician'::app_role]));

CREATE POLICY pending_imports_update ON pending_project_imports FOR UPDATE TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role,'project_manager'::app_role,'om_technician'::app_role]));

-- INSERT only via seed script (service_role) — no policy needed.
-- DELETE not allowed (preserve audit trail).

-- Updated-at trigger (same pattern as other tables)
CREATE TRIGGER trg_pending_imports_updated_at
  BEFORE UPDATE ON pending_project_imports
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── approve_pending_import RPC ────────────────────────────────────────
-- Cascades a row into projects + inverters + plant_monitoring_credentials
-- + plant_local_setup (+ optionally om_contracts + om_visits).
-- Founder-only. Atomic — full rollback on any sub-insert failure.
CREATE OR REPLACE FUNCTION public.approve_pending_import(p_id UUID)
RETURNS UUID  -- the new projects.id
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row pending_project_imports%ROWTYPE;
  v_project_id UUID;
  v_seq INT;
  v_child pending_project_imports%ROWTYPE;
  v_role TEXT;
BEGIN
  -- Founder gate
  SELECT public.get_my_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'founder'::app_role::text AND v_role IS DISTINCT FROM 'founder' THEN
    RAISE EXCEPTION 'approve_pending_import: founder role required, got %', v_role;
  END IF;

  SELECT * INTO v_row FROM pending_project_imports WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_pending_import: row % not found', p_id;
  END IF;
  IF v_row.status_review NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'approve_pending_import: row % is %, cannot import', p_id, v_row.status_review;
  END IF;
  IF v_row.parent_import_id IS NOT NULL THEN
    RAISE EXCEPTION 'approve_pending_import: row % is a child-inverter row; approve its parent (%) instead', p_id, v_row.parent_import_id;
  END IF;

  -- Generate legacy project_number
  SELECT COALESCE(MAX(SUBSTRING(project_number FROM 'LEGACY/(\d+)')::INT), 0) + 1
  INTO v_seq FROM projects WHERE project_number LIKE 'SHIROI/PROJ/LEGACY/%';

  -- Insert parent project
  INSERT INTO projects (
    project_number, customer_name, customer_phone, customer_email,
    site_address_line1, site_city, site_state, site_pincode,
    system_size_kwp, system_type, panel_brand, panel_wattage, panel_count,
    inverter_brand, inverter_capacity_kw, commissioned_date,
    status, actual_end_date, notes, created_at
  ) VALUES (
    'SHIROI/PROJ/LEGACY/' || LPAD(v_seq::TEXT, 4, '0'),
    v_row.project_name, v_row.contact_phone, v_row.contact_email,
    v_row.address_line1, v_row.city, COALESCE(v_row.state, 'Tamil Nadu'), v_row.pincode,
    v_row.system_size_kwp, v_row.system_type::project_system_type,
    v_row.panel_make, v_row.panel_wattage, v_row.panel_qty,
    v_row.inverter_make, v_row.inverter_capacity_kw, v_row.commissioning_date,
    'completed'::project_status,
    v_row.commissioning_date,
    NULLIF(CONCAT_WS(E'\n',
      v_row.remarks,
      CASE WHEN v_row.source_year IS NOT NULL THEN 'Legacy backfill (commissioned ' || v_row.source_year || ')' END
    ), ''),
    COALESCE(v_row.commissioning_date, NOW())
  ) RETURNING id INTO v_project_id;

  -- Inverters: this row + every child
  INSERT INTO inverters (project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at)
  VALUES (v_project_id, COALESCE(v_row.portal_brand, v_row.inverter_make), v_row.inverter_model,
          v_row.inverter_capacity_kw, v_row.inverter_serial_number, v_row.commissioning_date);

  FOR v_child IN SELECT * FROM pending_project_imports WHERE parent_import_id = p_id LOOP
    INSERT INTO inverters (project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at)
    VALUES (v_project_id, COALESCE(v_child.portal_brand, v_child.inverter_make), v_child.inverter_model,
            v_child.inverter_capacity_kw, v_child.inverter_serial_number, v_child.commissioning_date);
  END LOOP;

  -- Plant monitoring credentials (if portal info present)
  IF v_row.portal_url IS NOT NULL AND v_row.portal_username IS NOT NULL THEN
    INSERT INTO plant_monitoring_credentials (
      project_id, portal_url, username, password_encrypted, inverter_brand
    ) VALUES (
      v_project_id, v_row.portal_url, v_row.portal_username,
      v_row.portal_password_encrypted, v_row.portal_brand
    )
    ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING;
  END IF;

  -- Local setup (if local creds OR datalogger info present)
  IF v_row.local_login_ip IS NOT NULL OR v_row.datalogger_mac IS NOT NULL THEN
    INSERT INTO plant_local_setup (
      project_id, local_login_ip,
      local_admin_user, local_admin_password_encrypted,
      local_user, local_user_password_encrypted,
      internet_type, jio_password_encrypted, jio_primary_sim, jio_backup_sim,
      datalogger_mac, datalogger_pk
    ) VALUES (
      v_project_id, v_row.local_login_ip,
      v_row.local_admin_user, v_row.local_admin_password_encrypted,
      v_row.local_user, v_row.local_user_password_encrypted,
      v_row.internet_type, v_row.jio_password_encrypted, v_row.jio_primary_sim, v_row.jio_backup_sim,
      v_row.datalogger_mac, v_row.datalogger_pk
    )
    ON CONFLICT (project_id) DO NOTHING;
  END IF;

  -- AMC cascade (gated)
  IF v_row.create_amc_contract AND v_row.amc_visits IS NOT NULL AND jsonb_array_length(v_row.amc_visits) > 0 THEN
    -- om_contracts + om_visits insertion (delegate to existing om_contracts_seed helper if it exists,
    -- else inline. Details TBD when O&M module is reviewed.)
    PERFORM 1; -- placeholder
  END IF;

  -- Mark imported
  UPDATE pending_project_imports SET
    status_review = 'imported',
    imported_project_id = v_project_id,
    imported_at = NOW(),
    reviewed_by = auth.uid(),
    reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE id = p_id;

  -- Also mark children imported
  UPDATE pending_project_imports SET
    status_review = 'imported',
    imported_at = NOW(),
    reviewed_by = auth.uid(),
    reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE parent_import_id = p_id;

  RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_import(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_import(UUID) TO authenticated;

COMMIT;
```

### Migration 160: plant_local_setup table

```sql
BEGIN;

CREATE TABLE plant_local_setup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  local_login_ip TEXT,
  local_admin_user TEXT,
  local_admin_password_encrypted BYTEA,
  local_user TEXT,
  local_user_password_encrypted BYTEA,
  internet_type TEXT,
  jio_password_encrypted BYTEA,
  jio_primary_sim TEXT,
  jio_backup_sim TEXT,
  datalogger_mac TEXT,
  datalogger_pk TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_plant_local_setup_datalogger_mac
  ON plant_local_setup (datalogger_mac)
  WHERE deleted_at IS NULL AND datalogger_mac IS NOT NULL;

ALTER TABLE plant_local_setup ENABLE ROW LEVEL SECURITY;

CREATE POLICY plant_local_setup_select ON plant_local_setup FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role,'project_manager'::app_role,'om_technician'::app_role]));

CREATE POLICY plant_local_setup_update ON plant_local_setup FOR ALL TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role,'project_manager'::app_role]));

-- Updated-at trigger
CREATE TRIGGER trg_plant_local_setup_updated_at
  BEFORE UPDATE ON plant_local_setup
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
```

## Data flow

```
┌──────────────────────────┐
│  3 XLSX workbooks        │
│  + chat-pasted creds     │
└────────────┬─────────────┘
             │  scripts/consolidate-master-projects.ts (already exists)
             ▼
┌──────────────────────────┐
│ consolidated records     │  541 unique plants, in-memory
│ (ConsolidatedRecord[])   │
└────────────┬─────────────┘
             │  scripts/seed-pending-imports.ts  (NEW)
             │  - Encrypts password fields via pgcrypto
             │  - Detects multi-inverter clusters
             │  - Sets parent_import_id on child rows
             │  - INSERTs to pending_project_imports
             ▼
┌──────────────────────────┐
│  pending_project_imports │  staging table, encrypted at rest
└────────────┬─────────────┘
             │  /om/import-review UI
             │  - reviewer edits fields inline
             │  - clicks Approve / Reject per row
             │  - server action calls approve_pending_import(p_id) RPC
             ▼
┌──────────────────────────┐
│  projects + inverters    │  live ERP tables
│  + plant_monitoring_creds│
│  + plant_local_setup     │
│  + om_contracts/visits   │
└──────────────────────────┘
```

### Multi-inverter cluster detection (in seed script)

A cluster is a group of rows whose `project_name` matches one of these patterns and shares the same base label after stripping:

| Pattern | Example | Stripped to |
|---|---|---|
| `SS_NNN KWp`, `DP_NN.N KWp`, `SP_NN.N KWp`, `RO_NN KWp` | `Chemfab Alkalis SS_110 KWp` | `Chemfab Alkalis` |
| `_NNKwp_Inverter_N(NNNKwp)` | `Mrinal_mills_507Kwp_Inverter_1(125Kwp)` | `Mrinal_mills_507Kwp` |
| `-NNNKw-Inv-N(NNNKw)` | `Metal forms-Redhills-110Kw-Inv-1(330Kw)` | `Metal forms-Redhills-330Kw` |
| `-NNN.NKw-Inv-N` | `SVA syntex pvt.ltd-126.5Kw-Inv-1` | `SVA syntex pvt.ltd` |
| `_NNNKWp` and `_NNN KWp` variants at one location with identical username | `Mountmeru _108KWp` + `Mountmeru _87KWp` | `Mountmeru` |

For each cluster: pick one row as parent (highest system_size, else first paste-order), set its `is_multi_inverter_parent = true`, set every other row's `parent_import_id = parent.id`, sum `system_size_kwp` from all children into the parent (parent stores the cluster total; each child stores its individual capacity in `inverter_capacity_kw`).

Edge case: the 192 completed-not-in-DB list expands to ~210 staging rows after cluster expansion (parent + N children for each of the 6 clusters). Reviewer sees them as a parent expandable into children.

## Files to land

| Layer | File | New/Modified |
|---|---|---|
| Migration | `supabase/migrations/158_2026-06-05-plant-credentials-encryption-and-deye.sql` | NEW |
| Migration | `supabase/migrations/159_2026-06-05-pending-project-imports.sql` | NEW |
| Migration | `supabase/migrations/160_2026-06-05-plant-local-setup.sql` | NEW |
| Edge Function | `supabase/functions/inverter-poll/index.ts` | MODIFIED (lines 770-789: use RPC) |
| Script | `scripts/consolidate-master-projects.ts` | EXISTS (used as input) |
| Script | `scripts/seed-pending-imports.ts` | NEW — reads consolidator output, encrypts passwords, seeds staging table |
| Script | `scripts/count-plant-credentials.ts` | EXISTS (delivered brand counts) |
| Types | `packages/types/database.ts` | REGEN |
| Page | `apps/erp/src/app/(erp)/om/import-review/page.tsx` | NEW |
| Page | `apps/erp/src/app/(erp)/om/import-review/_components/import-row-card.tsx` | NEW |
| Page | `apps/erp/src/app/(erp)/om/import-review/_components/inline-edit-form.tsx` | NEW |
| Page | `apps/erp/src/app/(erp)/om/import-review/_components/bulk-approve-bar.tsx` | NEW |
| Server | `apps/erp/src/lib/import-review-queries.ts` | NEW |
| Server | `apps/erp/src/lib/import-review-actions.ts` | NEW (approve, reject, inline-edit save) |
| Doc | `docs/modules/om.md` | MODIFIED — new section "Plant master-data import" |
| Doc | `docs/CHANGELOG.md` | one line per migration |
| Doc | `docs/CURRENT_STATUS.md` | unblock items if any |

## Rollout

1. **Migration 158** → apply to dev → regen types → verify the 3 existing `plant_monitoring_credentials` rows are encrypted + still readable via RPC → update `inverter-poll/index.ts` → smoke test the Growatt branch in Edge Function logs.
2. **Migration 159 + 160** → apply to dev → regen types.
3. **Run `scripts/seed-pending-imports.ts --dry-run`** → review the SQL it would emit → run for-real. ~210 rows land in `pending_project_imports`.
4. **Build review UI** → ship `/om/import-review` → Vivek manually approves 5–10 rows as a sanity check → verify the cascade lands `projects + inverters + plant_monitoring_credentials + plant_local_setup`.
5. **Vivek does the 192-completed-not-in-DB sweep** at his own pace via the UI. Each approval grows the legitimate project base.
6. **Apply same sequence to prod** once dev is verified clean.
7. **(Later)** Build `/portfolio` view as a follow-up — read-only card grid of completed projects.

## Open questions deferred to implementation

- Project_number scheme: `SHIROI/PROJ/LEGACY/NNNN` proposed above. Alt: include `source_year` (`SHIROI/PROJ/LEGACY/YYYY-NNNN`). Defer to seed script.
- AMC contract auto-creation: deferred per non-goal #2 — keep `create_amc_contract` checkbox gated, populate `om_contracts` + `om_visits` only when ticked. Schema is ready; cascade body is a TBD placeholder in the RPC.
- Portfolio view: not in scope for this spec. Will be a follow-up spec once import lands and the data shape is real.
- Bulk-edit operations in the UI (e.g. "set Year=2024 on all selected"): not in v1. Single-row edits + bulk-approve only.

## Why this is safe to ship in pieces

- Migration 158 (encryption) lands independently of the import work. Pollster + UI changes for the encryption-only path are minimal and already designed. If the import UI slips, encryption still ships.
- Migration 159 + 160 + seed script land without UI. The data is staged but invisible to users. Reviewer-side UI can ship next.
- Each approval is atomic per row. No multi-row transactions, no all-or-nothing failure mode.
- All cred fields are encrypted before they leave the seed script — staging table never holds plaintext.
