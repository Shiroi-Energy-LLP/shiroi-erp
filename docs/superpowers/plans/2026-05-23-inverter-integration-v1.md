# Inverter Integration V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire live inverter telemetry into the ERP for the three vendor families where we have a viable API path (Sungrow, Growatt, Deye/SolarMan), reading from Shiroi master accounts that Manivel has already linked, with all customer monitoring credentials stored in the ERP for O&M reference.

**Architecture:**
- **Two credential tables, two purposes.** `plant_monitoring_credentials` (existing) stores per-customer portal logins for human O&M lookup; `inverter_monitoring_credentials` (existing, from mig 050) stores Shiroi master account creds + vendor API tokens for automated polling. The polling pipeline reads only the latter.
- **Master-account model, not per-customer OAuth.** Customer plants are already linked to Shiroi master accounts (`manivel@shiroienergy.com` for Sungrow & SolarMan; `EEVUWE001` for Growatt). The polling adapter authenticates as the Shiroi master and enumerates all plants visible to it.
- **One exception: Sungrow.** The new Sungrow developer app (appkey+secret) is a separate account from `manivel@`. To bridge them we run the OAuth2 authorize flow exactly once — Manivel clicks Allow, we store the resulting access_token + refresh_token against the Shiroi master credential row, and the refresh-token cron keeps it alive.
- **No new architecture for the rest.** Migration 050 already shipped the partitioned readings tables, hourly/daily rollups, retention, auto-ticket scan, and Edge Function shell. This plan fills in the credential rows, replaces NotImplementedError in the adapter stubs with real HTTP calls, and adds an `/om/inverters` management UI.

**Tech Stack:** Next.js 14 App Router · Supabase Postgres + Edge Functions (Deno) · `@repo/inverter-adapters` workspace package · n8n self-hosted at `n8n.shiroienergy.com` · Vitest for adapter unit tests · Playwright for UI smoke tests · `decimal.js` for any kWh math · `crypto.subtle` for the Sungrow RSA encryption.

---

## Scope and Phasing

| Phase | Deliverable | Independently testable? | Blocked by |
|---|---|---|---|
| 1 | Migration 103 + regenerated types | ✅ verify constraint + RLS | nothing |
| 2 | Bulk credential import script + populated `plant_monitoring_credentials` | ✅ verify row count + spot-check | Phase 1 |
| 3 | 4 Shiroi master credential rows in `inverter_monitoring_credentials` | ✅ RLS reads correctly per role | Phase 1 |
| 4 | Growatt OpenAPI real adapter | ✅ vitest mocks + smoke against EEVUWE001 | Phase 3, Growatt support email reply |
| 5 | Sungrow OAuth2 callback route + adapter | ✅ Manivel completes one-click flow → token stored | Phase 3 |
| 6 | SolarMan/Deye + Goodwe adapter stubs (synthetic-mode only) | ✅ vitest unit tests | Phase 3 |
| 7 | `/om/inverters` management UI | ✅ Playwright smoke | Phase 3 |
| 8 | Edge Function wired + n8n schedule live | ✅ end-to-end smoke | Phases 4-6 |
| 9 | Docs (CHANGELOG, modules/om.md, CURRENT_STATUS.md) | ✅ docs reflect new state | Phases 1-8 |

**External blockers** (not on the build critical path):
- Growatt: `service@growatt.com` email to merge OpenAPI token → EEVUWE001 installer. ~2-5 working days.
- SolarMan: paid Basic plan activation against `manivel@shiroienergy.com` Smart account. ~1 week after payment confirms.
- Goodwe: SEMS Portal API access via Goodwe India sales. ~2-6 weeks.

Phases 1-3 + 5-9 ship before any external blocker resolves. Phase 4 ships with synthetic-mode fallback active until Growatt responds.

---

## File Structure

### Files created

| Path | Responsibility |
|---|---|
| `supabase/migrations/103_inverter_integration_v1.sql` | Extend brand CHECK constraints; add OAuth2 token columns; add `inverter_oauth_states` table for CSRF tokens; index updates |
| `scripts/import-plant-monitoring-credentials.ts` | Parse credentials dump, fuzzy-match to projects by customer_name, insert into plant_monitoring_credentials (idempotent, supports `--dry-run`) |
| `scripts/import-plant-monitoring-credentials.test.ts` | Vitest unit tests for the parser + matcher (no DB calls in unit tests) |
| `scripts/import-plant-monitoring-credentials.fixtures.ts` | Test fixtures (anonymized credential rows) |
| `apps/erp/src/app/api/integrations/sungrow/authorize/route.ts` | GET handler that generates state token, stores in `inverter_oauth_states`, redirects to Sungrow authorize URL |
| `apps/erp/src/app/api/integrations/sungrow/callback/route.ts` | GET handler that validates state, exchanges auth code → access_token + refresh_token, persists to `inverter_monitoring_credentials.config` |
| `apps/erp/src/lib/sungrow-rsa.ts` | RSA-OAEP encryption helper for Sungrow OpenAPI v2 login payload (uses `crypto.subtle`) |
| `apps/erp/src/lib/sungrow-oauth.ts` | OAuth2 token exchange + refresh utilities, no React imports |
| `apps/erp/src/app/(erp)/om/inverters/page.tsx` | Inverter master list page (founder + om_technician + project_manager) |
| `apps/erp/src/app/(erp)/om/inverters/_components/inverter-table.tsx` | Table with brand + project + status + last_poll columns |
| `apps/erp/src/app/(erp)/om/inverters/_components/add-inverter-dialog.tsx` | Manual add: project picker, brand select, serial, model, rated kWp, site_id, device_sn, polling interval |
| `apps/erp/src/app/(erp)/om/inverters/_components/healthcheck-button.tsx` | Calls `adapter.healthCheck()` against the inverter's credential row, shows result |
| `apps/erp/src/app/(erp)/om/inverters/_components/connect-sungrow-button.tsx` | Single button on the page header that links to `/api/integrations/sungrow/authorize` to kick off OAuth |
| `apps/erp/src/lib/inverters-actions.ts` | Server actions: createInverter, updateInverter, healthCheckInverter, runManualPoll |
| `apps/erp/src/lib/inverters-queries.ts` | Read queries: listInverters, getInverterById, listRecentPollFailures, listInvertersByProject |
| `packages/inverter-adapters/src/growatt.test.ts` | Vitest unit tests for Growatt adapter (mocked HTTP via `vi.fn` on global fetch) |
| `packages/inverter-adapters/src/sungrow.test.ts` | Vitest unit tests for Sungrow adapter (mocked HTTP + mocked RSA) |
| `packages/inverter-adapters/src/solarman.ts` | Deye/SolarMan adapter stub — synthetic-mode end-to-end, real impl blocked on API keys |
| `packages/inverter-adapters/src/goodwe.ts` | Goodwe SEMS adapter stub — synthetic-mode end-to-end, real impl blocked on API access |
| `infrastructure/n8n/workflows/60-inverter-poll-cron.json` | n8n cron @ */5 * * * *  → POST to Edge Function URL |
| `infrastructure/n8n/workflows/61-sungrow-token-refresh.json` | n8n cron @ 0 4 * * * → refresh Sungrow access_tokens within 5 days of expiry |
| `e2e/inverters.spec.ts` | Playwright: founder visits /om/inverters, adds an inverter, healthchecks it, sees it in the list |

### Files modified

| Path | What changes |
|---|---|
| `packages/inverter-adapters/src/growatt.ts` | Replace `NotImplementedError` with real HTTP impl against `openapi.growatt.com/v1/...` |
| `packages/inverter-adapters/src/sungrow.ts` | Replace `NotImplementedError` with real HTTP impl using RSA-encrypted login + access_token from OAuth2 |
| `packages/inverter-adapters/src/factory.ts` | Register `solarman` and `goodwe` adapters; update brand union |
| `packages/inverter-adapters/src/base.ts` | Extend `InverterBrand` union to add `solarman, goodwe, fimer, polycab, havells, flin_energy` |
| `packages/inverter-adapters/src/index.ts` | Re-export new adapter symbols |
| `packages/types/database.ts` | Regenerated after migration 103 (run strip-view-fk-entries.mjs post-regen) |
| `supabase/functions/inverter-poll/index.ts` | Add credential resolution (look up by inverters.monitoring_credentials_id), call real adapter via dynamic import or inline switch, handle Sungrow access_token refresh on 401 |
| `apps/erp/src/app/(erp)/om/page.tsx` (or layout) | Add "Inverters" link in O&M sub-navigation |
| `docs/CHANGELOG.md` | One-line entry per phase |
| `docs/modules/om.md` | Update Inverter Telemetry section with the live-data state |
| `docs/CURRENT_STATUS.md` | Strike "Inverter live polling — awaiting Sungrow/Growatt API registration" |

---

# Phase 1 — Schema (Migration 103)

### Task 1.1: Write migration 103

**Files:**
- Create: `supabase/migrations/103_inverter_integration_v1.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 103: Inverter integration V1
--
-- Extends migration 050 to support:
--   1. Six additional inverter brands seen in real Shiroi installs that
--      were not in the original CHECK constraint (deye/solarman, goodwe,
--      fimer, polycab, havells, flin_energy). Without this extension the
--      bulk-import in Phase 2 cannot land most rows.
--   2. OAuth2 token storage for Sungrow (and any future OAuth vendor).
--      Tokens live in inverter_monitoring_credentials.config JSONB so we
--      don't need a per-vendor column.
--   3. inverter_oauth_states — short-lived (15 min) state tokens to
--      defend the OAuth2 callback against CSRF.

BEGIN;

-- ── Extend brand CHECK on inverters table ────────────────────────────
ALTER TABLE inverters
  DROP CONSTRAINT IF EXISTS inverters_brand_check;
ALTER TABLE inverters
  ADD CONSTRAINT inverters_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand CHECK on inverter_monitoring_credentials ────────────
ALTER TABLE inverter_monitoring_credentials
  DROP CONSTRAINT IF EXISTS inverter_monitoring_credentials_brand_check;
ALTER TABLE inverter_monitoring_credentials
  ADD CONSTRAINT inverter_monitoring_credentials_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand CHECK on plant_monitoring_credentials ───────────────
-- This was added by migration 059 with a narrower list. We need the same
-- expanded list so the Phase 2 bulk import can succeed.
ALTER TABLE plant_monitoring_credentials
  DROP CONSTRAINT IF EXISTS plant_monitoring_credentials_inverter_brand_check;
ALTER TABLE plant_monitoring_credentials
  ADD CONSTRAINT plant_monitoring_credentials_inverter_brand_check
  CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand auto-detect helper to cover new portal URLs ─────────
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN portal_url IS NULL OR portal_url = '' THEN 'other'
    WHEN lower(portal_url) LIKE '%isolarcloud%' THEN 'sungrow'
    WHEN lower(portal_url) LIKE '%growatt%' THEN 'growatt'
    WHEN lower(portal_url) LIKE '%solarmanpv%' OR lower(portal_url) LIKE '%solarman%' THEN 'solarman'
    WHEN lower(portal_url) LIKE '%semsportal%' OR lower(portal_url) LIKE '%goodwe%' THEN 'goodwe'
    WHEN lower(portal_url) LIKE '%auroravision%' OR lower(portal_url) LIKE '%fimer%' THEN 'fimer'
    WHEN lower(portal_url) LIKE '%polycabmonitoring%' THEN 'polycab'
    WHEN lower(portal_url) LIKE '%havells%' THEN 'havells'
    WHEN lower(portal_url) LIKE '%power-datacenter%' OR lower(portal_url) LIKE '%flinenergy%' THEN 'flin_energy'
    WHEN lower(portal_url) LIKE '%fronius%' OR lower(portal_url) LIKE '%solarweb%' THEN 'fronius'
    WHEN lower(portal_url) LIKE '%soliscloud%' OR lower(portal_url) LIKE '%solis%' THEN 'solis'
    WHEN lower(portal_url) LIKE '%sma%' OR lower(portal_url) LIKE '%sunnyportal%' THEN 'sma'
    WHEN lower(portal_url) LIKE '%fusionsolar%' OR lower(portal_url) LIKE '%huawei%' THEN 'huawei'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION public.plant_monitoring_detect_brand(TEXT) IS
  'Classifies monitoring portal URL into one of 13 known brands. Used by trigger + server actions so classification is consistent.';

-- ── inverter_oauth_states table — anti-CSRF for OAuth2 callback ──────
CREATE TABLE IF NOT EXISTS inverter_oauth_states (
  state_token TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  credentials_id UUID NOT NULL REFERENCES inverter_monitoring_credentials(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inverter_oauth_states_created
  ON inverter_oauth_states (created_at);

ALTER TABLE inverter_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_oauth_states_rw_founder ON inverter_oauth_states
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('founder', 'om_technician'))
  );

-- The service role (Edge Function) can write to clear stale states.
CREATE POLICY inverter_oauth_states_service ON inverter_oauth_states
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE inverter_oauth_states IS
  'Short-lived state tokens used to defend OAuth2 callbacks against CSRF. Created when /api/integrations/<brand>/authorize is hit; consumed by the callback. Rows older than 15 minutes are considered expired.';

-- ── Cleanup: drop expired OAuth states nightly ───────────────────────
CREATE OR REPLACE FUNCTION drop_expired_inverter_oauth_states()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted INT;
BEGIN
  WITH expired AS (
    DELETE FROM inverter_oauth_states
    WHERE created_at < NOW() - interval '15 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted FROM expired;
  RETURN deleted;
END;
$$;

SELECT cron.schedule(
  'inverter-oauth-states-cleanup',
  '17 * * * *',  -- :17 past every hour
  'SELECT drop_expired_inverter_oauth_states();'
);

-- ── Verification stubs ───────────────────────────────────────────────
-- After applying:
--   SELECT conname FROM pg_constraint
--     WHERE conname = 'inverters_brand_check';                    -- 1 row
--   SELECT plant_monitoring_detect_brand('https://home.solarmanpv.com/login');  -- 'solarman'
--   SELECT plant_monitoring_detect_brand('https://pv.polycabmonitoring.com');   -- 'polycab'
--   SELECT * FROM inverter_oauth_states;                          -- empty
--   SELECT cron.job FROM cron.job WHERE jobname = 'inverter-oauth-states-cleanup'; -- 1 row

COMMIT;
```

- [ ] **Step 2: Apply migration to dev via Supabase MCP**

Use `mcp__supabase__apply_migration` with `name='103_inverter_integration_v1'` and the SQL body above. Project: `actqtzoxjilqnldnacqz`.

Expected: no errors. If the CHECK rebuild fails on `plant_monitoring_credentials`, that's because existing rows violate the narrower constraint — drop the OLD constraint first, query for rows with brands outside the new union, fix them in a same-migration UPDATE, then add the new constraint.

- [ ] **Step 3: Verify constraints + helper function**

Run via MCP:

```sql
-- Should return 'solarman', 'polycab', 'fimer' respectively:
SELECT
  plant_monitoring_detect_brand('https://home.solarmanpv.com/login') AS deye,
  plant_monitoring_detect_brand('https://pv.polycabmonitoring.com/dist/#/login') AS polycab,
  plant_monitoring_detect_brand('https://www.auroravision.net/home') AS fimer;

-- Should show all 12 brands + 'other':
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'inverters_brand_check';
```

Expected: all three brand columns match expected values; CHECK definition lists all 12 brands.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/103_inverter_integration_v1.sql
git commit -m "feat(om): mig 103 inverter integration V1 — extend brand CHECK + OAuth states

- Add 6 brands to inverters/inverter_monitoring_credentials/plant_monitoring_credentials CHECK lists
- Extend plant_monitoring_detect_brand to cover 7 new portal URL patterns
- inverter_oauth_states table + 15-min CSRF window + hourly cleanup cron
- Required by phases 2-7 of the inverter integration plan"
```

### Task 1.2: Regenerate database.ts

**Files:**
- Modify: `packages/types/database.ts` (overwrite from MCP regen)

- [ ] **Step 1: Regenerate via Supabase MCP**

Use `mcp__supabase__generate_typescript_types` with project_id `actqtzoxjilqnldnacqz`. The tool returns a tool-result file path (large file).

- [ ] **Step 2: Move regenerated types into place**

```bash
# Copy the tool-results file into the types path, then unwrap the JSON envelope:
node -e "const fs=require('fs'); const obj=JSON.parse(fs.readFileSync('packages/types/database.ts','utf8')); fs.writeFileSync('packages/types/database.ts', obj.types);"
```

- [ ] **Step 3: Strip view-FK entries (mandatory per CLAUDE.md)**

```bash
node scripts/strip-view-fk-entries.mjs
```

Expected: trims database.ts by ~40-60%.

- [ ] **Step 4: Verify type-check passes**

```bash
pnpm check-types
```

Expected: all 5 packages clean. If TS2589 ("excessively deep") fires, you skipped step 3.

- [ ] **Step 5: Commit regenerated types**

```bash
git add packages/types/database.ts
git commit -m "chore(types): regenerate database.ts after mig 103"
```

---

# Phase 2 — Bulk credential import

### Task 2.1: Define parser + matcher contracts

**Files:**
- Create: `scripts/import-plant-monitoring-credentials.ts`
- Create: `scripts/import-plant-monitoring-credentials.test.ts`
- Create: `scripts/import-plant-monitoring-credentials.fixtures.ts`

- [ ] **Step 1: Write fixture data**

```ts
// scripts/import-plant-monitoring-credentials.fixtures.ts
//
// Anonymized rows from the 2026-05-23 credentials dump. Used by unit tests
// to verify parser + matcher without hitting the DB.

export const FIXTURE_RAW_ROWS = [
  {
    project: 'GRN Ambili Srinivas',
    brand: 'Sungrow',
    username: 'venkatms@example.com',
    password: 'Solar123',
    monitoringLink: 'https://www.isolarcloud.com.hk/#/login',
    created: '2025-11-21',
  },
  {
    project: 'Mr Ravi / Tiruvannamalai',
    brand: 'Deye',
    username: 'raguramanradha1957@example.com',
    password: 'Solar12345',
    monitoringLink: 'https://home.solarmanpv.com/login',
    created: '12/3/2025',
  },
  {
    project: 'Mr Sridhar Rajan',
    brand: 'Deye',
    username: 'Sridharrajan1989@example.com',
    password: 'Solar@123',
    monitoringLink: 'https://home.solarmanpv.com/login',
    created: '4/18/2026',
  },
];

export const FIXTURE_PROJECTS = [
  { id: '11111111-1111-1111-1111-111111111111', customer_name: 'GRN Ambili Srinivas', project_number: 'SHIROI/PROJ/2025-26/0010' },
  { id: '22222222-2222-2222-2222-222222222222', customer_name: 'Mr Ravi', project_number: 'SHIROI/PROJ/2025-26/0020' },
  { id: '33333333-3333-3333-3333-333333333333', customer_name: 'Sridhar Rajan', project_number: 'SHIROI/PROJ/2026-27/0030' },
  { id: '44444444-4444-4444-4444-444444444444', customer_name: 'Some Unrelated', project_number: 'SHIROI/PROJ/2026-27/0040' },
];
```

- [ ] **Step 2: Define types + write failing tests for normalization**

```ts
// scripts/import-plant-monitoring-credentials.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeBrand,
  normalizeDate,
  matchProject,
  type RawRow,
  type ProjectStub,
} from './import-plant-monitoring-credentials';
import { FIXTURE_RAW_ROWS, FIXTURE_PROJECTS } from './import-plant-monitoring-credentials.fixtures';

describe('normalizeBrand', () => {
  it('maps Deye to solarman (single API path for both)', () => {
    expect(normalizeBrand('Deye')).toBe('solarman');
    expect(normalizeBrand('deye')).toBe('solarman');
    expect(normalizeBrand('DEYE')).toBe('solarman');
  });

  it('lowercases known brands', () => {
    expect(normalizeBrand('Sungrow')).toBe('sungrow');
    expect(normalizeBrand('Growatt')).toBe('growatt');
    expect(normalizeBrand('Goodwe')).toBe('goodwe');
    expect(normalizeBrand('Fimer')).toBe('fimer');
    expect(normalizeBrand('Polycab')).toBe('polycab');
    expect(normalizeBrand('Havells')).toBe('havells');
    expect(normalizeBrand('Flin Energy')).toBe('flin_energy');
    expect(normalizeBrand('Fronius')).toBe('fronius');
  });

  it('infers from monitoring URL when brand is empty', () => {
    expect(normalizeBrand('', 'https://home.solarmanpv.com/login')).toBe('solarman');
    expect(normalizeBrand('', 'https://www.isolarcloud.com.hk/#/login')).toBe('sungrow');
    expect(normalizeBrand('', 'https://server.growatt.com/login')).toBe('growatt');
  });

  it('returns other for unknown brand and unknown URL', () => {
    expect(normalizeBrand('XYZ Inverters')).toBe('other');
    expect(normalizeBrand('')).toBe('other');
  });
});

describe('normalizeDate', () => {
  it('parses YYYY-MM-DD as is', () => {
    expect(normalizeDate('2025-11-21')).toBe('2025-11-21');
  });
  it('parses M/D/YYYY US-style', () => {
    expect(normalizeDate('12/3/2025')).toBe('2025-12-03');
  });
  it('parses 4/18/2026', () => {
    expect(normalizeDate('4/18/2026')).toBe('2026-04-18');
  });
  it('returns null on empty', () => {
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(undefined as unknown as string)).toBeNull();
  });
  it('returns null on garbage', () => {
    expect(normalizeDate('not a date')).toBeNull();
  });
});

describe('matchProject', () => {
  const projects = FIXTURE_PROJECTS;

  it('exact match wins', () => {
    const result = matchProject('GRN Ambili Srinivas', projects);
    expect(result?.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('token-subset match handles prefix labels', () => {
    const result = matchProject('Mr Ravi / Tiruvannamalai', projects);
    expect(result?.id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('handles honorific case differences', () => {
    const result = matchProject('Mr Sridhar Rajan', projects);
    expect(result?.id).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('returns null when no project matches', () => {
    const result = matchProject('Completely Unknown Customer', projects);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm vitest run scripts/import-plant-monitoring-credentials.test.ts
```

Expected: FAIL — "normalizeBrand is not defined" etc.

- [ ] **Step 4: Commit failing tests + fixtures**

```bash
git add scripts/import-plant-monitoring-credentials.test.ts scripts/import-plant-monitoring-credentials.fixtures.ts
git commit -m "test(scripts): add failing tests for plant-monitoring import normalization"
```

### Task 2.2: Implement parser + matcher

**Files:**
- Create: `scripts/import-plant-monitoring-credentials.ts`

- [ ] **Step 1: Implement the module**

```ts
// scripts/import-plant-monitoring-credentials.ts
//
// Bulk-import customer monitoring portal credentials from a tab/CSV dump
// into plant_monitoring_credentials. Idempotent — uses (project_id, portal_url)
// unique key. Logs unmatched rows for manual triage.
//
// Usage:
//   pnpm tsx scripts/import-plant-monitoring-credentials.ts --input creds.tsv --dry-run
//   pnpm tsx scripts/import-plant-monitoring-credentials.ts --input creds.tsv --apply

import { readFileSync } from 'node:fs';
import { createAdminClient } from '@repo/supabase/admin';

export interface RawRow {
  project: string;
  brand: string;
  username: string;
  password: string;
  monitoringLink: string;
  created: string;
}

export interface ProjectStub {
  id: string;
  customer_name: string;
  project_number: string;
}

const KNOWN_BRANDS = [
  'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
  'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
] as const;
type KnownBrand = typeof KNOWN_BRANDS[number];

const BRAND_ALIASES: Record<string, KnownBrand> = {
  deye: 'solarman',         // Deye uses SolarMan cloud
  isolar: 'sungrow',        // iSolar = iSolarCloud (Sungrow)
  fronious: 'fronius',      // typo
  'flin energy': 'flin_energy',
};

export function normalizeBrand(rawBrand: string, monitoringUrl?: string): KnownBrand {
  const lower = (rawBrand ?? '').trim().toLowerCase();
  if (lower in BRAND_ALIASES) return BRAND_ALIASES[lower];
  if ((KNOWN_BRANDS as readonly string[]).includes(lower)) return lower as KnownBrand;

  // Fall back to URL inference if brand string is empty / unknown
  const url = (monitoringUrl ?? '').toLowerCase();
  if (!url) return 'other';
  if (url.includes('isolarcloud')) return 'sungrow';
  if (url.includes('growatt')) return 'growatt';
  if (url.includes('solarmanpv')) return 'solarman';
  if (url.includes('semsportal') || url.includes('goodwe')) return 'goodwe';
  if (url.includes('auroravision') || url.includes('fimer')) return 'fimer';
  if (url.includes('polycabmonitoring')) return 'polycab';
  if (url.includes('power-datacenter')) return 'flin_energy';
  return 'other';
}

export function normalizeDate(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // ISO already: 2026-05-01
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // US-style: 12/3/2025 or 4/18/2026
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const month = us[1].padStart(2, '0');
    const day = us[2].padStart(2, '0');
    return `${us[3]}-${month}-${day}`;
  }
  return null;
}

function tokenize(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/mr\.?|mrs\.?|m\/s|dr\.?|ms\.?/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

export function matchProject(rawCustomerName: string, projects: ProjectStub[]): ProjectStub | null {
  const lowerRaw = rawCustomerName.trim().toLowerCase();

  // 1. Exact match on customer_name
  const exact = projects.find((p) => p.customer_name.trim().toLowerCase() === lowerRaw);
  if (exact) return exact;

  // 2. Token-subset match — raw's tokens are a subset of any project's tokens, or vice versa
  const rawTokens = tokenize(rawCustomerName);
  if (rawTokens.size === 0) return null;

  let bestScore = 0;
  let bestMatch: ProjectStub | null = null;
  for (const project of projects) {
    const projectTokens = tokenize(project.customer_name);
    if (projectTokens.size === 0) continue;
    let overlap = 0;
    for (const t of rawTokens) if (projectTokens.has(t)) overlap++;
    // Score = overlap / min(sizes) — favors high-precision matches
    const score = overlap / Math.min(rawTokens.size, projectTokens.size);
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = project;
    }
  }
  return bestMatch;
}

interface CliFlags {
  inputPath: string;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { inputPath: '', dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') flags.inputPath = argv[++i] ?? '';
    if (argv[i] === '--apply') flags.dryRun = false;
    if (argv[i] === '--dry-run') flags.dryRun = true;
  }
  if (!flags.inputPath) throw new Error('Missing --input <path>');
  return flags;
}

function parseTsv(content: string): RawRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  // Header: Project, Brand, Username, Password, Monitoring Link, Created
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    rows.push({
      project: cols[0]?.trim() ?? '',
      brand: cols[1]?.trim() ?? '',
      username: cols[2]?.trim() ?? '',
      password: cols[3]?.trim() ?? '',
      monitoringLink: cols[4]?.trim() ?? '',
      created: cols[5]?.trim() ?? '',
    });
  }
  return rows;
}

async function main() {
  const op = '[import-plant-monitoring-credentials]';
  const flags = parseFlags(process.argv.slice(2));

  console.log(`${op} reading ${flags.inputPath} (dry-run=${flags.dryRun})`);

  const raw = readFileSync(flags.inputPath, 'utf8');
  const rows = parseTsv(raw);
  console.log(`${op} parsed ${rows.length} rows`);

  const supabase = createAdminClient();
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, customer_name, project_number');
  if (pErr) {
    console.error(`${op} failed to load projects:`, pErr);
    process.exit(1);
  }
  if (!projects) {
    console.error(`${op} projects load returned null data`);
    process.exit(1);
  }
  console.log(`${op} loaded ${projects.length} projects`);

  let matched = 0;
  let unmatched = 0;
  let inserted = 0;
  const unmatchedRows: string[] = [];

  for (const row of rows) {
    if (!row.project || !row.username || !row.password) continue;
    const match = matchProject(row.project, projects);
    if (!match) {
      unmatched++;
      unmatchedRows.push(`UNMATCHED: project="${row.project}" brand="${row.brand}" user="${row.username}"`);
      continue;
    }
    matched++;
    const brand = normalizeBrand(row.brand, row.monitoringLink);
    const createdAt = normalizeDate(row.created);
    const portalUrl = row.monitoringLink || '(no-portal)';

    if (flags.dryRun) {
      console.log(`MATCH: ${row.project} → ${match.project_number} (${match.customer_name}) brand=${brand}`);
      continue;
    }

    const { error: upErr } = await supabase
      .from('plant_monitoring_credentials')
      .upsert(
        {
          project_id: match.id,
          inverter_brand: brand,
          portal_url: portalUrl,
          username: row.username,
          password: row.password, // encrypted-at-rest via Supabase column encryption
          created_at: createdAt ?? new Date().toISOString(),
        },
        { onConflict: 'project_id,portal_url', ignoreDuplicates: false },
      );
    if (upErr) {
      console.error(`${op} upsert failed for ${row.project}:`, upErr);
      continue;
    }
    inserted++;
  }

  console.log(`${op} done. matched=${matched} unmatched=${unmatched} inserted=${inserted} (dry-run=${flags.dryRun})`);
  if (unmatchedRows.length > 0) {
    console.log(`\n${op} UNMATCHED ROWS (need manual project mapping):\n`);
    for (const u of unmatchedRows) console.log(u);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run tests — they should pass now**

```bash
pnpm vitest run scripts/import-plant-monitoring-credentials.test.ts
```

Expected: PASS — all 13 tests green.

- [ ] **Step 3: Commit implementation**

```bash
git add scripts/import-plant-monitoring-credentials.ts
git commit -m "feat(scripts): implement plant monitoring credentials bulk import"
```

### Task 2.3: Dry-run against the 2026-05-23 dump

**Files:**
- Create: `scripts/data/credentials-dump-2026-05-23.tsv` (paste Vivek's dump, sanitized to TSV with header row matching parseTsv's expectations: `Project\tBrand\tUsername\tPassword\tMonitoring Link\tCreated`)

- [ ] **Step 1: Create the TSV with header**

The script expects this exact header line:

```
Project	Brand	Username	Password	Monitoring Link	Created
```

Followed by one row per credential. Paste the entire dump Vivek sent, ensure tabs (not spaces) separate columns.

- [ ] **Step 2: Run in dry-run mode**

```bash
pnpm tsx scripts/import-plant-monitoring-credentials.ts --input scripts/data/credentials-dump-2026-05-23.tsv --dry-run | tee scripts/data/credentials-dryrun-2026-05-23.log
```

Expected: console lists matches + unmatches. Final line: `done. matched=NN unmatched=MM inserted=0 (dry-run=true)`.

- [ ] **Step 3: Triage unmatched rows**

Review `credentials-dryrun-2026-05-23.log`. For each UNMATCHED entry, decide:

| Cause | Action |
|---|---|
| Customer name in dump genuinely doesn't have a project in the ERP yet | Skip (creds preserved in dump file for later) |
| Customer name spelled differently | Fix the project's `customer_name` in the ERP, then rerun |
| Project = an apartment complex's sub-unit (e.g., "A/A1 - Mr Vanagiri") | These all belong to ONE project (Anjudham Phase II). Map manually: create one credential row per sub-unit but all pointing at the same project_id |

For the Anjudham Phase II case specifically, add a one-off block to the import:

```ts
// In main(), before the loop, add:
const ANJUDHAM_PROJECT_ID = '<look this up via SQL>';
const isAnjudhamUnit = (raw: string) => /^[A-J]\/[A-Z]?\d/.test(raw.trim());
// Then in the loop, if isAnjudhamUnit(row.project) and no match found, fall back to ANJUDHAM_PROJECT_ID
```

(Add this in a follow-up commit; don't block dry-run on it.)

- [ ] **Step 4: Commit the dump fixture + dry-run log (sanitized) NOT to repo**

The credentials dump file contains passwords — **do not commit it**. Add to `.gitignore`:

```bash
echo "scripts/data/credentials-dump-2026-05-23.tsv" >> .gitignore
echo "scripts/data/credentials-dryrun-2026-05-23.log" >> .gitignore
git add .gitignore
git commit -m "chore(gitignore): exclude credentials dump + dry-run log"
```

### Task 2.4: Apply the import

- [ ] **Step 1: Apply to dev DB**

```bash
pnpm tsx scripts/import-plant-monitoring-credentials.ts --input scripts/data/credentials-dump-2026-05-23.tsv --apply
```

Expected: `done. matched=NN unmatched=MM inserted=NN`.

- [ ] **Step 2: Verify via MCP**

```sql
-- Total rows landed:
SELECT COUNT(*) FROM plant_monitoring_credentials WHERE deleted_at IS NULL;

-- Breakdown by brand:
SELECT inverter_brand, COUNT(*) FROM plant_monitoring_credentials
WHERE deleted_at IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Spot check one row:
SELECT p.project_number, p.customer_name, c.inverter_brand, c.username
FROM plant_monitoring_credentials c
JOIN projects p ON p.id = c.project_id
WHERE p.project_number = 'SHIROI/PROJ/2024-25/0028'  -- Radiance Flourish
LIMIT 1;
```

Expected: row count matches dry-run's "inserted=NN"; brand breakdown matches expectations from the file; spot check shows correct username for Radiance Flourish.

- [ ] **Step 3: Manually populate the Anjudham Phase II rows** (if not yet handled)

If you added the apartment-complex special case to the script, rerun. Otherwise insert via SQL one-shot.

- [ ] **Step 4: Commit the script changes (no creds, no logs)**

```bash
git add scripts/import-plant-monitoring-credentials.ts
git commit -m "chore(scripts): apply credentials import (dev only, dump not committed)"
```

---

# Phase 3 — Shiroi master credential rows

### Task 3.1: Insert the 4 master credential rows

**Files:** none created — direct DB inserts via MCP

- [ ] **Step 1: Insert Growatt master credential row**

Run via MCP `execute_sql`:

```sql
INSERT INTO inverter_monitoring_credentials (brand, label, vault_secret_ref, config, created_by)
VALUES (
  'growatt',
  'Shiroi EEVUWE001 installer (Manivel) + OpenAPI token',
  'GROWATT_API_TOKEN',  -- read from env, not Vault for V1
  jsonb_build_object(
    'installer_code', 'EEVUWE001',
    'username', 'EEVUWE001',
    'api_base', 'https://openapi.growatt.com',
    'legacy_api_base', 'https://server.growatt.com',
    'notes', 'OpenAPI token in env var GROWATT_API_TOKEN. Plants link via installer code EEVUWE001.'
  ),
  (SELECT id FROM profiles WHERE email = 'svivek.88@gmail.com' LIMIT 1)
)
RETURNING id, brand, label;
```

Expected: 1 row inserted with returned id.

- [ ] **Step 2: Insert Sungrow master credential row**

```sql
INSERT INTO inverter_monitoring_credentials (brand, label, vault_secret_ref, config, created_by)
VALUES (
  'sungrow',
  'Shiroi manivel@ iSolarCloud + Vivek developer app',
  'SUNGROW_APPKEY',
  jsonb_build_object(
    'master_account_email', 'manivel@shiroienergy.com',
    'application_id', '2571',
    'cloud_id', '2',
    'api_base', 'https://gateway.isolarcloud.com.hk',
    'authorize_url', 'https://web3.isolarcloud.com.hk/#/authorized-app?cloudId=2&applicationId=2571&redirectUrl=https://erp.shiroienergy.com/api/integrations/sungrow/callback',
    'redirect_uri', 'https://erp.shiroienergy.com/api/integrations/sungrow/callback',
    'oauth_status', 'not_authorized',
    'access_token', null,
    'refresh_token', null,
    'access_token_expires_at', null
  ),
  (SELECT id FROM profiles WHERE email = 'svivek.88@gmail.com' LIMIT 1)
)
RETURNING id, brand, label;
```

Expected: 1 row inserted. `oauth_status` is `not_authorized` until Phase 5 completes Manivel's flow.

- [ ] **Step 3: Insert SolarMan/Deye master credential row (placeholder until API keys arrive)**

```sql
INSERT INTO inverter_monitoring_credentials (brand, label, vault_secret_ref, config, created_by)
VALUES (
  'solarman',
  'Shiroi manivel@ SolarMan Smart account (paid plan pending)',
  'SOLARMAN_APP_SECRET',
  jsonb_build_object(
    'master_account_email', 'manivel@shiroienergy.com',
    'api_base', 'https://globalapi.solarmanpv.com',
    'app_id', null,
    'app_secret', null,
    'org_id', null,
    'activation_status', 'paid_plan_email_sent',
    'notes', 'Awaiting reply from customerservice@solarmanpv.com with App ID + Secret + Org ID for Manivel Smart account, Basic paid plan.'
  ),
  (SELECT id FROM profiles WHERE email = 'svivek.88@gmail.com' LIMIT 1)
)
RETURNING id, brand, label;
```

- [ ] **Step 4: Insert Goodwe master placeholder**

```sql
INSERT INTO inverter_monitoring_credentials (brand, label, vault_secret_ref, config, created_by)
VALUES (
  'goodwe',
  'Shiroi Goodwe SEMS Portal (access pending)',
  'GOODWE_PASSWORD',
  jsonb_build_object(
    'api_base', null,
    'activation_status', 'email_sent_to_goodwe_india',
    'notes', 'No self-serve developer portal. Awaiting reply from Goodwe India sales contact.'
  ),
  (SELECT id FROM profiles WHERE email = 'svivek.88@gmail.com' LIMIT 1)
)
RETURNING id, brand, label;
```

- [ ] **Step 5: Verify role-based read access**

```sql
-- As founder (you):
SELECT brand, label, config->>'master_account_email' FROM inverter_monitoring_credentials;
-- Expect 4 rows visible.

-- As project_manager (NOT in the RLS allow-list — should see 0):
SET role authenticated;
SELECT brand, label FROM inverter_monitoring_credentials;  -- 0 rows expected if RLS works
RESET role;
```

Expected: founder sees 4 rows; project_manager sees 0.

- [ ] **Step 6: Commit a one-shot SQL file for traceability**

```bash
# Create a tracked file documenting these inserts (no secrets — env-var refs only)
cat > supabase/manual-data/2026-05-23-inverter-master-credentials.sql <<'SQL'
-- Manual data load: 4 Shiroi master inverter monitoring credential rows.
-- Applied to dev 2026-05-23. Not part of migrations because they reference
-- env var names that vary by environment. Re-apply to prod when promoting.
[paste the 4 INSERTs from above]
SQL

git add supabase/manual-data/2026-05-23-inverter-master-credentials.sql
git commit -m "data(om): 4 Shiroi master inverter credential rows (env-var refs, no secrets)"
```

(If `supabase/manual-data/` doesn't exist, create it. CLAUDE.md doesn't forbid it.)

---

# Phase 4 — Growatt OpenAPI real adapter

### Task 4.1: Write failing tests for Growatt adapter

**Files:**
- Create: `packages/inverter-adapters/src/growatt.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// packages/inverter-adapters/src/growatt.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { growattAdapter } from './growatt';
import { InvalidCredentialsError } from './base';

beforeEach(() => {
  // Reset global fetch mock between tests
  vi.restoreAllMocks();
  delete process.env.SYNTHETIC_INVERTER_READINGS;
});

describe('growattAdapter.fetchReadings', () => {
  it('throws InvalidCredentialsError when api_token missing', async () => {
    await expect(
      growattAdapter.fetchReadings({
        credentials: {},  // no api_token
        monitoring_site_id: '1234',
        monitoring_device_id: 'SN001',
        since: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('returns synthetic reading when SYNTHETIC_INVERTER_READINGS=1', async () => {
    process.env.SYNTHETIC_INVERTER_READINGS = '1';
    const result = await growattAdapter.fetchReadings({
      credentials: { api_token: 'tok', rated_capacity_kw: '5' },
      monitoring_site_id: '1234',
      monitoring_device_id: 'SN001',
      since: null,
    });
    expect(result.readings.length).toBe(1);
    expect(result.readings[0].raw_payload.source).toBe('synthetic');
  });

  it('calls /v1/device/inverter/last_data with token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: 0,
          data: {
            ac_power: 2500,          // watts
            dc_power: 2550,
            grid_voltage: 240.1,
            grid_current: 10.4,
            grid_frequency: 50.0,
            inverter_temp: 38.2,
            today_energy: 12.5,
            total_energy: 4321.8,
            status: '1',             // 1 = active per Growatt enum
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await growattAdapter.fetchReadings({
      credentials: { api_token: 's27gb0eqr79l1tn090s2s89emwh42jif', api_base: 'https://openapi.growatt.com' },
      monitoring_site_id: 'PLT1',
      monitoring_device_id: 'SN001',
      since: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/device/inverter/last_data');
    expect((init as RequestInit).headers).toMatchObject({
      token: 's27gb0eqr79l1tn090s2s89emwh42jif',
    });
    expect(result.readings[0].ac_power_kw).toBeCloseTo(2.5, 3);
    expect(result.readings[0].status).toBe('active');
    expect(result.readings[0].energy_today_kwh).toBeCloseTo(12.5, 3);
  });

  it('throws on Growatt error_code !== 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error_code: 10001, error_msg: 'Invalid token' }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      growattAdapter.fetchReadings({
        credentials: { api_token: 'bad', api_base: 'https://openapi.growatt.com' },
        monitoring_site_id: 'PLT1',
        monitoring_device_id: 'SN001',
        since: null,
      }),
    ).rejects.toThrow(/Invalid token/);
  });
});

describe('growattAdapter.healthCheck', () => {
  it('reports failure when token missing', async () => {
    const r = await growattAdapter.healthCheck({});
    expect(r.ok).toBe(false);
  });

  it('pings /v1/plant/list and reports OK on error_code 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error_code: 0, data: { count: 18, plants: [] } }),
          { status: 200 },
        ),
      ),
    );
    const r = await growattAdapter.healthCheck({ api_token: 'tok', api_base: 'https://openapi.growatt.com' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/18 plant/i);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
pnpm vitest run packages/inverter-adapters/src/growatt.test.ts
```

Expected: FAIL — current `growatt.ts` throws `NotImplementedError`, doesn't read `api_token`, doesn't call fetch.

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/inverter-adapters/src/growatt.test.ts
git commit -m "test(growatt): failing tests for real OpenAPI implementation"
```

### Task 4.2: Implement Growatt OpenAPI v1 adapter

**Files:**
- Modify: `packages/inverter-adapters/src/growatt.ts`
- Modify: `packages/inverter-adapters/src/base.ts` (add `api_token`, `api_base` to AdapterCredentials)

- [ ] **Step 1: Extend AdapterCredentials in base.ts**

Edit `packages/inverter-adapters/src/base.ts` — locate `AdapterCredentials` interface, add:

```ts
export interface AdapterCredentials {
  api_key?: string;
  api_secret?: string;
  api_token?: string;     // NEW — Growatt OpenAPI bearer-style token
  api_base?: string;      // NEW — vendor base URL (per-credential override)
  username?: string;
  password?: string;
  account_id?: string;
  endpoint_url?: string;
  oauth_token?: string;
  oauth_refresh_token?: string;
  rated_capacity_kw?: string;
  [key: string]: string | undefined;
}
```

Also extend `InverterBrand` union:

```ts
export type InverterBrand =
  | 'sungrow'
  | 'growatt'
  | 'sma'
  | 'huawei'
  | 'fronius'
  | 'solarman'
  | 'goodwe'
  | 'fimer'
  | 'polycab'
  | 'havells'
  | 'flin_energy';
```

- [ ] **Step 2: Replace growatt.ts implementation**

Overwrite `packages/inverter-adapters/src/growatt.ts`:

```ts
/**
 * Growatt OpenAPI v1 adapter.
 *
 * Status: LIVE (2026-05-23). Uses bearer-style `token` header against
 * openapi.growatt.com/v1/...
 *
 * Auth model: a single API token, issued by openapi.growatt.com. NO
 * per-call MD5 hashing, NO session cookies, NO OAuth flow. Token is
 * scoped to the OpenAPI account; for plants to be visible, the OpenAPI
 * account must be linked to a Shiroi installer code (e.g., EEVUWE001).
 *
 * Endpoints used:
 *   GET /v1/plant/list                       — enumerate visible plants
 *   GET /v1/device/inverter/last_data        — most recent reading for one inverter
 *   GET /v1/device/inverter/historical       — historical (used when since != null)
 *
 * Rate limit: not explicitly documented for OpenAPI v1; we self-throttle
 * via the poller's 5-min batch cadence + 96 polls/day/inverter cap.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  AdapterError,
  InvalidCredentialsError,
  NormalizedReading,
  NormalizedStatus,
  syntheticReading,
} from './base';

const GROWATT_STATUS_MAP: Record<string, NormalizedStatus> = {
  '-1': 'offline',
  '0': 'offline',
  '1': 'active',
  '2': 'fault',
  '3': 'offline',
  '4': 'derated',
  '5': 'derated',
};

function mapStatus(raw: string | number | null | undefined): NormalizedStatus | null {
  if (raw === null || raw === undefined) return null;
  return GROWATT_STATUS_MAP[String(raw)] ?? null;
}

function resolveBase(creds: AdapterCredentials): string {
  return (creds.api_base ?? 'https://openapi.growatt.com').replace(/\/$/, '');
}

export const growattAdapter: InverterAdapter = {
  brand: 'growatt',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[growattAdapter.fetchReadings]';
    const { credentials, monitoring_device_id } = input;

    if (!credentials.api_token) {
      throw new InvalidCredentialsError('growatt', 'api_token');
    }
    if (!monitoring_device_id) {
      throw new InvalidCredentialsError('growatt', 'monitoring_device_id');
    }

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      const cap = Number(credentials.rated_capacity_kw ?? '5');
      return { readings: [syntheticReading(cap)], string_readings: [] };
    }

    const base = resolveBase(credentials);
    const url = `${base}/v1/device/inverter/last_data?device_sn=${encodeURIComponent(monitoring_device_id)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { token: credentials.api_token },
    });
    if (!res.ok) {
      throw new AdapterError('growatt', `HTTP ${res.status}`, { httpStatus: res.status });
    }
    const body = (await res.json()) as {
      error_code: number;
      error_msg?: string;
      data?: Record<string, unknown>;
    };
    if (body.error_code !== 0) {
      throw new AdapterError('growatt', body.error_msg ?? `error_code ${body.error_code}`, {
        payloadExcerpt: JSON.stringify(body).substring(0, 500),
      });
    }
    const d = body.data ?? {};
    const acPowerW = Number(d.ac_power ?? 0);
    const dcPowerW = Number(d.dc_power ?? 0);
    const reading: NormalizedReading = {
      recorded_at: new Date().toISOString(),
      ac_power_kw: acPowerW > 0 ? acPowerW / 1000 : null,
      dc_power_kw: dcPowerW > 0 ? dcPowerW / 1000 : null,
      ac_voltage_v: d.grid_voltage != null ? Number(d.grid_voltage) : null,
      ac_current_a: d.grid_current != null ? Number(d.grid_current) : null,
      ac_frequency_hz: d.grid_frequency != null ? Number(d.grid_frequency) : null,
      temperature_c: d.inverter_temp != null ? Number(d.inverter_temp) : null,
      energy_today_kwh: d.today_energy != null ? Number(d.today_energy) : null,
      energy_total_kwh: d.total_energy != null ? Number(d.total_energy) : null,
      status: mapStatus(d.status as string | number | undefined),
      error_code: d.fault_code != null ? String(d.fault_code) : null,
      raw_payload: d,
    };
    console.log(`${op} ${monitoring_device_id} ac=${reading.ac_power_kw}kW status=${reading.status}`);
    return { readings: [reading], string_readings: [] };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.api_token) {
      return { ok: false, message: 'Missing api_token' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }
    const base = resolveBase(credentials);
    const res = await fetch(`${base}/v1/plant/list?page=1&perpage=1`, {
      headers: { token: credentials.api_token },
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { error_code: number; error_msg?: string; data?: { count?: number } };
    if (body.error_code !== 0) {
      return { ok: false, message: body.error_msg ?? `error_code ${body.error_code}` };
    }
    const count = body.data?.count ?? 0;
    return { ok: true, message: `${count} plant(s) visible`, vendor_api_version: 'OpenAPI v1' };
  },
};
```

- [ ] **Step 3: Run tests — should pass**

```bash
pnpm vitest run packages/inverter-adapters/src/growatt.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 4: Run repo-wide type-check**

```bash
pnpm check-types
```

Expected: clean across 5 packages.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/inverter-adapters/src/growatt.ts packages/inverter-adapters/src/base.ts
git commit -m "feat(growatt): real OpenAPI v1 adapter — token header, last_data endpoint"
```

### Task 4.3: Smoke test against EEVUWE001

**Files:** none — manual curl + verification

- [ ] **Step 1: Verify token can list plants**

```bash
curl -s "https://openapi.growatt.com/v1/plant/list?page=1&perpage=20" \
  -H "token: s27gb0eqr79l1tn090s2s89emwh42jif" | jq .
```

Three outcomes:
- `error_code: 0` + non-empty `data.plants` → great. Note the plant ids + inverter device_sn for next step.
- `error_code: 0` + empty `data.plants` → OpenAPI account not linked to EEVUWE001 yet. Email Growatt support (template in the architecture section above), wait for reply, retry.
- `error_code: 10001` (invalid token) → wrong base URL — retry against `openapi-cn.growatt.com`.

- [ ] **Step 2: Pick one device, fetch a real reading**

```bash
curl -s "https://openapi.growatt.com/v1/device/inverter/last_data?device_sn=<DEVICE_SN>" \
  -H "token: s27gb0eqr79l1tn090s2s89emwh42jif" | jq .
```

Expected: a reading with `ac_power`, `today_energy`, `status` fields populated.

- [ ] **Step 3: Insert that one inverter into the master table**

```sql
INSERT INTO inverters (
  project_id, serial_number, brand, model,
  rated_capacity_kw, monitoring_credentials_id,
  monitoring_site_id, monitoring_device_id,
  polling_interval_minutes, polling_enabled
)
VALUES (
  (SELECT id FROM projects WHERE project_number = 'SHIROI/PROJ/2024-25/0028'),  -- Radiance Flourish
  '<device_sn from above>',
  'growatt',
  '<inverter model if visible in plant list>',
  240.00,
  (SELECT id FROM inverter_monitoring_credentials WHERE brand='growatt' LIMIT 1),
  '<plant_id from plant_list>',
  '<device_sn>',
  15,
  true
);
```

- [ ] **Step 4: Trigger a manual poll via Edge Function (not yet wired — defer to Phase 8)**

Note this dependency: the actual end-to-end smoke test happens at the end of Phase 8. For now we've validated the adapter via curl and unit tests.

---

# Phase 5 — Sungrow OAuth2 callback + adapter

### Task 5.1: Implement RSA encryption helper

**Files:**
- Create: `apps/erp/src/lib/sungrow-rsa.ts`

Sungrow OpenAPI v2 requires RSA-OAEP encryption of the password/secret in the login request. Web Crypto's `crypto.subtle` handles this natively.

- [ ] **Step 1: Write the helper**

```ts
// apps/erp/src/lib/sungrow-rsa.ts
//
// RSA-OAEP encryption for Sungrow OpenAPI v2 login payloads.
//
// Sungrow's iSolarCloud OpenAPI requires that the login secret_key be
// RSA-encrypted using the public key issued with the developer app.
// The public key Sungrow sends is in SubjectPublicKeyInfo format,
// Base64-encoded (PKCS#8/SPKI). We import it with crypto.subtle and
// produce a Base64-encoded ciphertext that the API accepts.

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Encrypts `plaintext` with the SubjectPublicKeyInfo-encoded RSA public
 * key Sungrow issued. Returns Base64 ciphertext suitable for the
 * `secret_key` field of POST /openapi/login.
 */
export async function sungrowRsaEncrypt(plaintext: string, publicKeyBase64: string): Promise<string> {
  const keyBuf = base64ToArrayBuffer(publicKeyBase64);
  const publicKey = await crypto.subtle.importKey(
    'spki',
    keyBuf,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    enc.encode(plaintext),
  );
  return arrayBufferToBase64(cipher);
}
```

- [ ] **Step 2: Quick unit test**

```ts
// apps/erp/src/lib/sungrow-rsa.test.ts
import { describe, it, expect } from 'vitest';
import { sungrowRsaEncrypt } from './sungrow-rsa';

describe('sungrowRsaEncrypt', () => {
  it('produces non-empty Base64 ciphertext for a known plaintext', async () => {
    // Real Sungrow public key from .env.local (this is the public half, safe to commit)
    const pubKey = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCGc_aKE5Bqs3uUZE1vHhP4wdeLothZbNvvp4INtykpgAcK0jTk3CrRAVlTWlgWJWSnS4iwGAHsPnLk10-42UqLIOHf6s8Di1kJn7ibcWNXhNunilL02_BFRqM5NgftirvCwOOTmK8Pz1GOSK4proG8YIuGHxIjEDrpWIAXYR6hrQIDAQAB';
    const cipher = await sungrowRsaEncrypt('hello', pubKey);
    expect(cipher).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(cipher.length).toBeGreaterThan(100);  // 1024-bit RSA ⇒ 172 chars Base64
  });
});
```

Run: `pnpm vitest run apps/erp/src/lib/sungrow-rsa.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/sungrow-rsa.ts apps/erp/src/lib/sungrow-rsa.test.ts
git commit -m "feat(sungrow): RSA-OAEP helper for OpenAPI v2 login payload"
```

### Task 5.2: Implement OAuth2 authorize-redirect handler

**Files:**
- Create: `apps/erp/src/app/api/integrations/sungrow/authorize/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/erp/src/app/api/integrations/sungrow/authorize/route.ts
//
// GET handler that:
//   1. Verifies the caller is a founder or om_technician
//   2. Generates a CSRF state token, stores it in inverter_oauth_states
//   3. Redirects to Sungrow's authorize URL with state encoded
//
// Used once by Manivel to authorize the Sungrow developer app for the
// plants in his iSolarCloud account.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@repo/supabase/server';
import { randomBytes } from 'node:crypto';

const op = '[/api/integrations/sungrow/authorize]';

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profErr) {
    console.error(`${op} profile lookup failed:`, profErr);
    return NextResponse.json({ error: 'profile_lookup_failed' }, { status: 500 });
  }
  if (!profile || (profile.role !== 'founder' && profile.role !== 'om_technician')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data: cred, error: credErr } = await supabase
    .from('inverter_monitoring_credentials')
    .select('id, config')
    .eq('brand', 'sungrow')
    .limit(1)
    .maybeSingle();
  if (credErr || !cred) {
    console.error(`${op} sungrow credential row missing:`, credErr);
    return NextResponse.json({ error: 'no_sungrow_credential_row' }, { status: 500 });
  }

  const stateToken = randomBytes(32).toString('hex');
  const { error: insErr } = await supabase
    .from('inverter_oauth_states')
    .insert({
      state_token: stateToken,
      brand: 'sungrow',
      credentials_id: cred.id,
      created_by: user.id,
    });
  if (insErr) {
    console.error(`${op} state insert failed:`, insErr);
    return NextResponse.json({ error: 'state_insert_failed' }, { status: 500 });
  }

  const authorizeUrlBase = (cred.config as { authorize_url?: string })?.authorize_url;
  if (!authorizeUrlBase) {
    return NextResponse.json({ error: 'no_authorize_url_configured' }, { status: 500 });
  }
  // Sungrow's URL uses hash routing with cloudId=2&applicationId=2571&redirectUrl=...
  // We append state as an extra param; it's bounced back to us on callback.
  const url = authorizeUrlBase + `&state=${stateToken}`;
  return NextResponse.redirect(url, 302);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/api/integrations/sungrow/authorize/route.ts
git commit -m "feat(sungrow): /api/integrations/sungrow/authorize CSRF state + redirect"
```

### Task 5.3: Implement OAuth2 callback route

**Files:**
- Create: `apps/erp/src/lib/sungrow-oauth.ts`
- Create: `apps/erp/src/app/api/integrations/sungrow/callback/route.ts`

- [ ] **Step 1: Implement the token exchange helper**

```ts
// apps/erp/src/lib/sungrow-oauth.ts
//
// Sungrow OpenAPI v2 access-token exchange.
//
// After the user consents, Sungrow redirects to our callback with
// ?code=<auth_code>&state=<our_state>. We POST that code + our appkey
// + RSA-encrypted secret to the token endpoint and receive
// {access_token, refresh_token, expires_in}.

interface ExchangeInput {
  code: string;
  appkey: string;
  secret: string;
  publicKey: string;
  apiBase: string;        // e.g., https://gateway.isolarcloud.com.hk
  redirectUri: string;
}

interface ExchangeResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;     // seconds
  expires_at: string;     // ISO
}

import { sungrowRsaEncrypt } from './sungrow-rsa';

const op = '[sungrow-oauth]';

export async function exchangeCodeForToken(input: ExchangeInput): Promise<ExchangeResult> {
  const encryptedSecret = await sungrowRsaEncrypt(input.secret, input.publicKey);

  const url = `${input.apiBase.replace(/\/$/, '')}/openapi/apiManage/token`;
  const body = {
    appkey: input.appkey,
    secret_key: encryptedSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-access-key': input.appkey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${op} HTTP ${res.status} from token endpoint`);
  }
  const json = (await res.json()) as {
    result_code: string | number;
    result_msg?: string;
    result_data?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };
  if (String(json.result_code) !== '1') {
    throw new Error(`${op} Sungrow token exchange failed: ${json.result_msg ?? json.result_code}`);
  }
  const data = json.result_data;
  if (!data) {
    throw new Error(`${op} Sungrow token exchange returned no result_data`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function refreshAccessToken(input: {
  refresh_token: string;
  appkey: string;
  secret: string;
  publicKey: string;
  apiBase: string;
}): Promise<ExchangeResult> {
  const encryptedSecret = await sungrowRsaEncrypt(input.secret, input.publicKey);

  const url = `${input.apiBase.replace(/\/$/, '')}/openapi/apiManage/refreshToken`;
  const body = {
    appkey: input.appkey,
    secret_key: encryptedSecret,
    refresh_token: input.refresh_token,
    grant_type: 'refresh_token',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-access-key': input.appkey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${op} refresh HTTP ${res.status}`);
  const json = (await res.json()) as {
    result_code: string | number;
    result_msg?: string;
    result_data?: { access_token: string; refresh_token: string; expires_in: number };
  };
  if (String(json.result_code) !== '1') throw new Error(`${op} refresh failed: ${json.result_msg}`);
  const data = json.result_data!;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}
```

- [ ] **Step 2: Implement the callback route**

```ts
// apps/erp/src/app/api/integrations/sungrow/callback/route.ts
//
// GET handler that:
//   1. Receives ?code=...&state=... from Sungrow
//   2. Validates the state token against inverter_oauth_states
//   3. Exchanges the code for {access_token, refresh_token, expires_at}
//   4. Persists tokens to inverter_monitoring_credentials.config
//   5. Marks the state token consumed
//   6. Redirects to /om/plant-monitoring?sungrow=connected

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@repo/supabase/server';
import { exchangeCodeForToken } from '@/lib/sungrow-oauth';

const op = '[/api/integrations/sungrow/callback]';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'missing_code_or_state' }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Validate state — must exist, be unconsumed, fresh (<15 min)
  const { data: stateRow, error: sErr } = await supabase
    .from('inverter_oauth_states')
    .select('credentials_id, consumed_at, created_at')
    .eq('state_token', state)
    .eq('brand', 'sungrow')
    .maybeSingle();
  if (sErr || !stateRow) {
    console.error(`${op} state not found:`, sErr);
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }
  if (stateRow.consumed_at) {
    return NextResponse.json({ error: 'state_already_consumed' }, { status: 400 });
  }
  const ageMs = Date.now() - new Date(stateRow.created_at).getTime();
  if (ageMs > 15 * 60 * 1000) {
    return NextResponse.json({ error: 'state_expired' }, { status: 400 });
  }

  // 2. Load credential row to get appkey/secret/publicKey/base
  const { data: cred, error: cErr } = await supabase
    .from('inverter_monitoring_credentials')
    .select('id, config')
    .eq('id', stateRow.credentials_id)
    .maybeSingle();
  if (cErr || !cred) {
    console.error(`${op} credential row missing:`, cErr);
    return NextResponse.json({ error: 'credential_missing' }, { status: 500 });
  }

  const appkey = process.env.SUNGROW_APPKEY;
  const secret = process.env.SUNGROW_SECRET;
  const publicKey = process.env.SUNGROW_RSA_PUBLIC_KEY;
  const apiBase = (cred.config as { api_base?: string })?.api_base ?? process.env.SUNGROW_BASE_URL;
  const redirectUri = process.env.SUNGROW_REDIRECT_URI;

  if (!appkey || !secret || !publicKey || !apiBase || !redirectUri) {
    console.error(`${op} missing required env vars`);
    return NextResponse.json({ error: 'env_config_missing' }, { status: 500 });
  }

  // 3. Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForToken({ code, appkey, secret, publicKey, apiBase, redirectUri });
  } catch (e) {
    console.error(`${op} token exchange failed:`, e);
    return NextResponse.json({ error: 'token_exchange_failed' }, { status: 502 });
  }

  // 4. Persist tokens to config JSONB
  const newConfig = {
    ...(cred.config as Record<string, unknown>),
    oauth_status: 'authorized',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: tokens.expires_at,
    authorized_at: new Date().toISOString(),
  };
  const { error: uErr } = await supabase
    .from('inverter_monitoring_credentials')
    .update({ config: newConfig })
    .eq('id', cred.id);
  if (uErr) {
    console.error(`${op} config update failed:`, uErr);
    return NextResponse.json({ error: 'config_update_failed' }, { status: 500 });
  }

  // 5. Mark state consumed
  await supabase
    .from('inverter_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_token', state);

  return NextResponse.redirect(new URL('/om/plant-monitoring?sungrow=connected', req.url));
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/sungrow-oauth.ts apps/erp/src/app/api/integrations/sungrow/callback/route.ts
git commit -m "feat(sungrow): OAuth2 callback route + token exchange helper"
```

### Task 5.4: Add "Authorize Sungrow" button on /om/plant-monitoring

**Files:**
- Create: `apps/erp/src/app/(erp)/om/plant-monitoring/_components/connect-sungrow-button.tsx`
- Modify: `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx`

- [ ] **Step 1: Write the button component**

```tsx
// apps/erp/src/app/(erp)/om/plant-monitoring/_components/connect-sungrow-button.tsx
'use client';

import { Button } from '@repo/ui/button';

export function ConnectSungrowButton({
  status,
}: {
  status: 'not_authorized' | 'authorized' | 'expired';
}) {
  const label =
    status === 'authorized' ? 'Sungrow connected — re-authorize' : 'Authorize Sungrow';
  return (
    <a href="/api/integrations/sungrow/authorize">
      <Button variant={status === 'authorized' ? 'outline' : 'default'}>{label}</Button>
    </a>
  );
}
```

- [ ] **Step 2: Wire it into the page header**

Edit `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx`. Add the button next to the existing Add Credential CTA. Server-render the status by reading the Sungrow credential row's `config.oauth_status`.

```tsx
// In the page server component, near where other CTAs render:
import { ConnectSungrowButton } from './_components/connect-sungrow-button';

// ... in the component body, after fetching credentials data:
const { data: sungrowCred } = await supabase
  .from('inverter_monitoring_credentials')
  .select('config')
  .eq('brand', 'sungrow')
  .limit(1)
  .maybeSingle();

const sungrowStatus =
  (sungrowCred?.config as { oauth_status?: string })?.oauth_status ?? 'not_authorized';

// ... in JSX:
<div className="flex gap-2">
  <ConnectSungrowButton status={sungrowStatus as 'not_authorized' | 'authorized' | 'expired'} />
  {/* existing Add Credential button */}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/\(erp\)/om/plant-monitoring/_components/connect-sungrow-button.tsx apps/erp/src/app/\(erp\)/om/plant-monitoring/page.tsx
git commit -m "feat(sungrow): Connect Sungrow button on /om/plant-monitoring"
```

### Task 5.5: Manivel runs the OAuth flow

**Files:** none — manual user action

- [ ] **Step 1: Manivel logs into ERP at erp.shiroienergy.com**

(He needs an om_technician or founder role on his profile.)

- [ ] **Step 2: Navigate to /om/plant-monitoring**

- [ ] **Step 3: Click "Authorize Sungrow"**

Browser redirects to `web3.isolarcloud.com.hk` authorize page.

- [ ] **Step 4: Manivel logs in with manivel@shiroienergy.com / shiro@2025**

iSolarCloud asks: "Allow Shiroi Energy LLP developer app to read plant data?" → Manivel clicks Allow.

- [ ] **Step 5: Verify token persistence**

After redirect back, ERP page shows "Sungrow connected — re-authorize". Then via MCP:

```sql
SELECT
  config->>'oauth_status',
  config->>'access_token_expires_at',
  config->>'authorized_at'
FROM inverter_monitoring_credentials
WHERE brand = 'sungrow';
```

Expected: `oauth_status='authorized'`, expires ~30 days out, authorized_at = just now.

### Task 5.6: Implement Sungrow real adapter

**Files:**
- Modify: `packages/inverter-adapters/src/sungrow.ts`
- Create: `packages/inverter-adapters/src/sungrow.test.ts`

- [ ] **Step 1: Write failing unit tests**

```ts
// packages/inverter-adapters/src/sungrow.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sungrowAdapter, mapSungrowStatus } from './sungrow';
import { InvalidCredentialsError } from './base';

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SYNTHETIC_INVERTER_READINGS;
});

describe('mapSungrowStatus', () => {
  it('maps "1" → active', () => expect(mapSungrowStatus('1')).toBe('active'));
  it('maps "2" → fault', () => expect(mapSungrowStatus('2')).toBe('fault'));
  it('maps "3" → offline', () => expect(mapSungrowStatus('3')).toBe('offline'));
  it('returns null on unknown', () => expect(mapSungrowStatus('99')).toBeNull());
});

describe('sungrowAdapter.fetchReadings', () => {
  it('throws InvalidCredentialsError when oauth_token missing', async () => {
    await expect(
      sungrowAdapter.fetchReadings({
        credentials: { api_key: 'k' },  // missing oauth_token
        monitoring_site_id: 'PS1',
        monitoring_device_id: 'D1',
        since: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('calls /openapi/getDeviceRealTimeData with x-access-key + bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result_code: 1,
          result_data: {
            p_array: [{
              ps_id: 'PS1',
              device_sn: 'D1',
              p_kw: 3.2,
              dc_p_kw: 3.3,
              grid_v: 240.5,
              today_energy_kwh: 18.4,
              total_energy_kwh: 1240.7,
              device_status: '1',
              t_inverter: 42.1,
              update_time: '2026-05-23 17:00:00',
            }],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sungrowAdapter.fetchReadings({
      credentials: {
        api_key: 'APPKEY',
        oauth_token: 'ACCESS_TOKEN',
        api_base: 'https://gateway.isolarcloud.com.hk',
      },
      monitoring_site_id: 'PS1',
      monitoring_device_id: 'D1',
      since: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'x-access-key': 'APPKEY',
      Authorization: 'Bearer ACCESS_TOKEN',
    });
    expect(result.readings[0].ac_power_kw).toBeCloseTo(3.2, 3);
    expect(result.readings[0].status).toBe('active');
  });
});
```

Run: `pnpm vitest run packages/inverter-adapters/src/sungrow.test.ts` → FAIL.

- [ ] **Step 2: Implement sungrow.ts**

Replace `packages/inverter-adapters/src/sungrow.ts`:

```ts
/**
 * Sungrow iSolarCloud OpenAPI v2 adapter.
 *
 * Status: LIVE (2026-05-23). Auth: x-access-key header (appkey) + Bearer
 * access_token (from OAuth2 flow stored on the credential row).
 *
 * Endpoint used here:
 *   POST /openapi/getDeviceRealTimeData
 *     body: { ps_id, device_sn_list: [device_sn] }
 *     returns: result_data.p_array[].{ p_kw, today_energy_kwh, ... }
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  AdapterError,
  InvalidCredentialsError,
  NormalizedReading,
  NormalizedStatus,
  syntheticReading,
} from './base';

const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',
  '2': 'fault',
  '3': 'offline',
  '4': 'derated',
  '5': 'derated',
};

export function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (!raw) return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

function resolveBase(creds: AdapterCredentials): string {
  return (creds.api_base ?? 'https://gateway.isolarcloud.com.hk').replace(/\/$/, '');
}

export const sungrowAdapter: InverterAdapter = {
  brand: 'sungrow',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[sungrowAdapter.fetchReadings]';
    const { credentials, monitoring_site_id, monitoring_device_id } = input;

    if (!credentials.api_key) throw new InvalidCredentialsError('sungrow', 'api_key');
    if (!credentials.oauth_token) throw new InvalidCredentialsError('sungrow', 'oauth_token');
    if (!monitoring_site_id) throw new InvalidCredentialsError('sungrow', 'monitoring_site_id');
    if (!monitoring_device_id) throw new InvalidCredentialsError('sungrow', 'monitoring_device_id');

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { readings: [syntheticReading(Number(credentials.rated_capacity_kw ?? '5'))], string_readings: [] };
    }

    const base = resolveBase(credentials);
    const res = await fetch(`${base}/openapi/getDeviceRealTimeData`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': credentials.api_key,
        Authorization: `Bearer ${credentials.oauth_token}`,
      },
      body: JSON.stringify({
        ps_id: monitoring_site_id,
        device_sn_list: [monitoring_device_id],
      }),
    });
    if (!res.ok) {
      throw new AdapterError('sungrow', `HTTP ${res.status}`, { httpStatus: res.status });
    }
    const body = (await res.json()) as {
      result_code: string | number;
      result_msg?: string;
      result_data?: { p_array?: Array<Record<string, unknown>> };
    };
    if (String(body.result_code) !== '1') {
      throw new AdapterError('sungrow', body.result_msg ?? `result_code ${body.result_code}`);
    }
    const arr = body.result_data?.p_array ?? [];
    const row = arr.find((r) => String(r.device_sn) === monitoring_device_id) ?? arr[0];
    if (!row) {
      console.warn(`${op} no row in p_array for device ${monitoring_device_id}`);
      return { readings: [], string_readings: [] };
    }
    const reading: NormalizedReading = {
      recorded_at: typeof row.update_time === 'string'
        ? new Date(row.update_time.replace(' ', 'T') + 'Z').toISOString()
        : new Date().toISOString(),
      ac_power_kw: row.p_kw != null ? Number(row.p_kw) : null,
      dc_power_kw: row.dc_p_kw != null ? Number(row.dc_p_kw) : null,
      ac_voltage_v: row.grid_v != null ? Number(row.grid_v) : null,
      ac_current_a: row.grid_a != null ? Number(row.grid_a) : null,
      ac_frequency_hz: row.grid_freq != null ? Number(row.grid_freq) : null,
      temperature_c: row.t_inverter != null ? Number(row.t_inverter) : null,
      energy_today_kwh: row.today_energy_kwh != null ? Number(row.today_energy_kwh) : null,
      energy_total_kwh: row.total_energy_kwh != null ? Number(row.total_energy_kwh) : null,
      status: mapSungrowStatus(row.device_status as string | undefined),
      error_code: row.fault_code != null ? String(row.fault_code) : null,
      raw_payload: row,
    };
    console.log(`${op} ${monitoring_device_id} ac=${reading.ac_power_kw}kW status=${reading.status}`);
    return { readings: [reading], string_readings: [] };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.api_key) return { ok: false, message: 'Missing api_key' };
    if (!credentials.oauth_token) return { ok: false, message: 'Missing oauth_token — run /api/integrations/sungrow/authorize first' };
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }
    const base = resolveBase(credentials);
    const res = await fetch(`${base}/openapi/getPowerStationList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': credentials.api_key,
        Authorization: `Bearer ${credentials.oauth_token}`,
      },
      body: JSON.stringify({ curPage: 1, size: 1 }),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const body = (await res.json()) as { result_code: string | number; result_msg?: string };
    if (String(body.result_code) !== '1') return { ok: false, message: body.result_msg };
    return { ok: true, message: 'authorized', vendor_api_version: 'OpenAPI v2' };
  },
};
```

- [ ] **Step 3: Run tests — should pass**

```bash
pnpm vitest run packages/inverter-adapters/src/sungrow.test.ts
pnpm check-types
```

Both should pass.

- [ ] **Step 4: Commit**

```bash
git add packages/inverter-adapters/src/sungrow.ts packages/inverter-adapters/src/sungrow.test.ts
git commit -m "feat(sungrow): real adapter using OAuth2 access_token + x-access-key"
```

### Task 5.7: n8n token-refresh workflow

**Files:**
- Create: `infrastructure/n8n/workflows/61-sungrow-token-refresh.json`

- [ ] **Step 1: Write the workflow JSON**

Use the same 4-node cron pattern as the existing daily digests:
1. scheduleTrigger: `0 4 * * *` (04:00 IST daily)
2. HTTP node: GET Supabase REST `/inverter_monitoring_credentials?brand=eq.sungrow&select=id,config`
3. Code node: check if `config.access_token_expires_at - now < 5 days`; if yes call refresh endpoint via the Edge Function
4. HTTP node: POST `/functions/v1/sungrow-refresh-token` (or in-place fetch)

(See `infrastructure/n8n/workflows/19-vivek-daily-7am-digest.json` for the canonical 4-node template.) Defer the exact JSON to inline implementation — it follows the same pattern.

- [ ] **Step 2: Push via `scripts/push-n8n-workflows.ts`**

```bash
pnpm tsx scripts/push-n8n-workflows.ts
```

Expected: new workflow registered, active by default.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/n8n/workflows/61-sungrow-token-refresh.json
git commit -m "feat(n8n): Sungrow token-refresh cron at 04:00 IST daily"
```

---

# Phase 6 — Adapter stubs for SolarMan + Goodwe

These adapters can't ship live yet (waiting on API access) but should be skeleton-ready so the moment credentials arrive we just fill in `fetchReadings`.

### Task 6.1: SolarMan adapter stub

**Files:**
- Create: `packages/inverter-adapters/src/solarman.ts`

- [ ] **Step 1: Write stub**

```ts
/**
 * SolarMan / Deye adapter.
 *
 * Status: STUB — paid Basic plan email sent 2026-05-23, awaiting App ID,
 * App Secret, and Org ID from customerservice@solarmanpv.com (~1 week
 * after payment confirms).
 *
 * Endpoint reference (once credentials arrive):
 *   POST /account/v1.0/token  — login: appId + appSecret + sha256(password) + email
 *   POST /business/v1.0/plant/list — enumerate plants visible to org
 *   POST /device/v1.0/realtime — realtime reading per device sn
 *
 * Rate limit: 5M calls/year on Basic plan = ~13,700/day. 70 plants × 96 polls
 * × 1.5 calls = 10,080/day. Comfortable.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  NotImplementedError,
  syntheticReading,
} from './base';

export const solarmanAdapter: InverterAdapter = {
  brand: 'solarman' as const,

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.api_key) {
      throw new InvalidCredentialsError('solarman' as const, 'api_key (SolarMan App ID)');
    }
    if (!input.credentials.api_secret) {
      throw new InvalidCredentialsError('solarman' as const, 'api_secret (SolarMan App Secret)');
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { readings: [syntheticReading(Number(input.credentials.rated_capacity_kw ?? '5'))], string_readings: [] };
    }
    throw new NotImplementedError('solarman' as const, 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.api_key || !credentials.api_secret) {
      return { ok: false, message: 'SolarMan paid Basic plan not yet activated — App ID + Secret pending' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }
    return { ok: false, message: 'SolarMan adapter not yet implemented — API keys pending' };
  },
};
```

- [ ] **Step 2: Add to factory.ts and InverterBrand union**

Edit `packages/inverter-adapters/src/factory.ts`:

```ts
import { solarmanAdapter } from './solarman';
import { goodweAdapter } from './goodwe';
// ...
const ADAPTERS: Record<InverterBrand, InverterAdapter> = {
  sungrow: sungrowAdapter,
  growatt: growattAdapter,
  sma: smaAdapter,
  huawei: huaweiAdapter,
  fronius: sungrowAdapter,    // placeholder fallback
  solarman: solarmanAdapter,
  goodwe: goodweAdapter,
  fimer: sungrowAdapter,      // placeholder fallback (skipped)
  polycab: sungrowAdapter,    // placeholder fallback (skipped)
  havells: sungrowAdapter,    // placeholder fallback (skipped)
  flin_energy: sungrowAdapter, // placeholder fallback (skipped)
};
```

(Update `base.ts` `InverterBrand` union if not done in Task 4.2.)

- [ ] **Step 3: Commit**

```bash
git add packages/inverter-adapters/src/solarman.ts packages/inverter-adapters/src/factory.ts
git commit -m "feat(solarman): adapter stub with synthetic mode and TODO API impl"
```

### Task 6.2: Goodwe adapter stub

**Files:**
- Create: `packages/inverter-adapters/src/goodwe.ts`

- [ ] **Step 1: Write stub** (mirrors solarman.ts structure)

```ts
/**
 * Goodwe SEMS Portal adapter.
 *
 * Status: STUB — no self-serve developer portal. Email sent to Goodwe
 * India sales team 2026-05-23 requesting SEMS API access. ETA 2-6 weeks.
 *
 * Endpoint reference (once Goodwe replies with creds):
 *   POST /api/v1/Common/CrossLogin — login: account + password
 *   POST /api/v1/PowerStation/GetMonitorDetail — realtime per station
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  NotImplementedError,
  syntheticReading,
} from './base';

export const goodweAdapter: InverterAdapter = {
  brand: 'goodwe' as const,

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.username) throw new InvalidCredentialsError('goodwe' as const, 'username');
    if (!input.credentials.password) throw new InvalidCredentialsError('goodwe' as const, 'password');
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { readings: [syntheticReading(Number(input.credentials.rated_capacity_kw ?? '5'))], string_readings: [] };
    }
    throw new NotImplementedError('goodwe' as const, 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.username || !credentials.password) {
      return { ok: false, message: 'Goodwe SEMS API access pending' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') return { ok: true, message: 'Synthetic mode' };
    return { ok: false, message: 'Goodwe adapter not yet implemented' };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/inverter-adapters/src/goodwe.ts
git commit -m "feat(goodwe): adapter stub, real impl pending Goodwe India response"
```

---

# Phase 7 — /om/inverters management UI

### Task 7.1: Queries module

**Files:**
- Create: `apps/erp/src/lib/inverters-queries.ts`

- [ ] **Step 1: Write the queries**

```ts
'use server';

import type { Database } from '@repo/types/database';
import { createServerClient } from '@repo/supabase/server';

export type InverterRow = Database['public']['Tables']['inverters']['Row'];

export async function listInverters(): Promise<InverterRow[]> {
  const op = '[listInverters]';
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('inverters')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`${op} failed:`, { error, timestamp: new Date().toISOString() });
    return [];
  }
  return data ?? [];
}

export async function getInverterById(id: string): Promise<InverterRow | null> {
  const op = '[getInverterById]';
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('inverters')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error(`${op} failed:`, { id, error, timestamp: new Date().toISOString() });
    return null;
  }
  return data;
}

export async function listRecentPollFailures(limit = 20) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('inverter_poll_failures')
    .select('id, inverter_id, error_message, http_status, attempted_at')
    .order('attempted_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[listRecentPollFailures] failed:', { error });
    return [];
  }
  return data ?? [];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/inverters-queries.ts
git commit -m "feat(inverters): queries module — list, getById, recent failures"
```

### Task 7.2: Actions module

**Files:**
- Create: `apps/erp/src/lib/inverters-actions.ts`

- [ ] **Step 1: Write the actions**

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@repo/supabase/server';
import { getAdapter } from '@repo/inverter-adapters';
import type { ActionResult } from './types/actions';

const createInverterSchema = z.object({
  project_id: z.string().uuid(),
  brand: z.enum([
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
  ]),
  serial_number: z.string().min(3),
  model: z.string().optional(),
  rated_capacity_kw: z.coerce.number().positive(),
  monitoring_credentials_id: z.string().uuid().nullable().optional(),
  monitoring_site_id: z.string().nullable().optional(),
  monitoring_device_id: z.string().nullable().optional(),
  polling_interval_minutes: z.coerce.number().int().min(5).max(120).default(15),
  polling_enabled: z.coerce.boolean().default(true),
});

export async function createInverter(
  input: z.infer<typeof createInverterSchema>,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createInverter]';
  const parsed = createInverterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('inverters')
    .insert(parsed.data)
    .select('id')
    .single();
  if (error) {
    console.error(`${op} insert failed:`, { input, error, timestamp: new Date().toISOString() });
    return { ok: false, error: error.message };
  }
  revalidatePath('/om/inverters');
  return { ok: true, data: { id: data.id } };
}

export async function healthCheckInverter(inverterId: string): Promise<ActionResult<{ ok: boolean; message?: string }>> {
  const op = '[healthCheckInverter]';
  const supabase = createServerClient();
  const { data: inv, error: invErr } = await supabase
    .from('inverters')
    .select('id, brand, monitoring_credentials_id')
    .eq('id', inverterId)
    .maybeSingle();
  if (invErr || !inv) {
    return { ok: false, error: 'inverter_not_found' };
  }
  if (!inv.monitoring_credentials_id) {
    return { ok: false, error: 'no_credentials_attached' };
  }
  const { data: cred, error: credErr } = await supabase
    .from('inverter_monitoring_credentials')
    .select('config, brand')
    .eq('id', inv.monitoring_credentials_id)
    .maybeSingle();
  if (credErr || !cred) {
    return { ok: false, error: 'credentials_not_found' };
  }
  // Build AdapterCredentials from config + env
  const config = (cred.config ?? {}) as Record<string, string | undefined>;
  const adapter = getAdapter(inv.brand as 'sungrow' | 'growatt');
  const result = await adapter.healthCheck({
    api_key: process.env.SUNGROW_APPKEY,
    api_secret: process.env.SUNGROW_SECRET,
    api_token: process.env.GROWATT_API_TOKEN,
    api_base: config.api_base,
    oauth_token: config.access_token,
  });
  return { ok: true, data: { ok: result.ok, message: result.message } };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/inverters-actions.ts
git commit -m "feat(inverters): server actions — createInverter, healthCheck"
```

### Task 7.3: Page + table + add dialog

**Files:**
- Create: `apps/erp/src/app/(erp)/om/inverters/page.tsx`
- Create: `apps/erp/src/app/(erp)/om/inverters/_components/inverter-table.tsx`
- Create: `apps/erp/src/app/(erp)/om/inverters/_components/add-inverter-dialog.tsx`
- Create: `apps/erp/src/app/(erp)/om/inverters/_components/healthcheck-button.tsx`

(These follow the same patterns as `/om/plant-monitoring/page.tsx`. Reference that file for the canonical layout: header CTA bar, filter combobox, table, add dialog. Each step ~3-5 min once you have the existing page open as a template.)

- [ ] **Step 1: Page component (server)**

```tsx
// apps/erp/src/app/(erp)/om/inverters/page.tsx
import { Suspense } from 'react';
import { listInverters, listRecentPollFailures } from '@/lib/inverters-queries';
import { InverterTable } from './_components/inverter-table';
import { AddInverterDialog } from './_components/add-inverter-dialog';

export default async function InvertersPage() {
  const [inverters, failures] = await Promise.all([listInverters(), listRecentPollFailures(10)]);
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inverters</h1>
        <AddInverterDialog />
      </div>
      <Suspense fallback={<div>Loading...</div>}>
        <InverterTable inverters={inverters} />
      </Suspense>
      {failures.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-900">Recent poll failures</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {failures.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{new Date(f.attempted_at).toLocaleString('en-IN')}</span>{' '}
                · inverter {f.inverter_id.slice(0, 8)} · {f.error_message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2-4: Table, add-dialog, healthcheck-button components**

(Skeleton code omitted for brevity — follow `/om/plant-monitoring/_components/*` patterns. Each component is ~30-50 LOC. Use `'use client'` only where needed for dialog state.)

- [ ] **Step 5: Commit page + components**

```bash
git add apps/erp/src/app/\(erp\)/om/inverters
git commit -m "feat(inverters): /om/inverters page + table + add + healthcheck UI"
```

### Task 7.4: Playwright smoke test

**Files:**
- Create: `e2e/inverters.spec.ts`

- [ ] **Step 1: Write smoke test**

```ts
// e2e/inverters.spec.ts
import { test, expect } from '@playwright/test';

test('founder can open /om/inverters', async ({ page }) => {
  await page.goto('/login');
  // (assume test-user fixture sets up session — match existing smoke tests)
  await page.goto('/om/inverters');
  await expect(page.getByRole('heading', { name: 'Inverters' })).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e e2e/inverters.spec.ts
git add e2e/inverters.spec.ts
git commit -m "test(inverters): Playwright smoke for /om/inverters page"
```

---

# Phase 8 — Edge Function wiring + n8n schedule

### Task 8.1: Update Edge Function to call real adapters

**Files:**
- Modify: `supabase/functions/inverter-poll/index.ts`

- [ ] **Step 1: Replace the synthetic-only branch with real credential resolution**

In `supabase/functions/inverter-poll/index.ts`, locate the loop body. Replace the inline `if (!synthetic) { throw ... }` with:

```ts
// Fetch credential row for this inverter
const { data: cred } = await supabase
  .from('inverter_monitoring_credentials')
  .select('brand, config')
  .eq('id', inv.monitoring_credentials_id)
  .maybeSingle();

const adapterCreds: Record<string, string | undefined> = {
  // Pull env vars per brand (matches what Phase 4-6 adapters expect)
  api_key: inv.brand === 'sungrow' ? Deno.env.get('SUNGROW_APPKEY')! : undefined,
  api_secret: inv.brand === 'sungrow' ? Deno.env.get('SUNGROW_SECRET')! : undefined,
  api_token: inv.brand === 'growatt' ? Deno.env.get('GROWATT_API_TOKEN')! : undefined,
  api_base: (cred?.config as { api_base?: string } | null)?.api_base,
  oauth_token: (cred?.config as { access_token?: string } | null)?.access_token,
  rated_capacity_kw: String(inv.rated_capacity_kw ?? 5),
};

// Inline minimal adapter dispatch (no workspace import in Deno yet)
let reading: NormalizedReading;
if (synthetic) {
  reading = syntheticReading(inv.rated_capacity_kw ?? 5);
} else if (inv.brand === 'growatt') {
  reading = await fetchGrowattReading(adapterCreds, inv);
} else if (inv.brand === 'sungrow') {
  reading = await fetchSungrowReading(adapterCreds, inv);
} else {
  throw new Error(`No live adapter for brand ${inv.brand}`);
}
```

Then inline `fetchGrowattReading` and `fetchSungrowReading` as Deno-compatible functions that mirror what the `@repo/inverter-adapters` package does. (Per the existing comment in the file, workspace deps don't resolve in Edge Functions.)

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy inverter-poll
```

Expected: function deploys.

- [ ] **Step 3: Set env vars on the Edge Function**

```bash
npx supabase secrets set SUNGROW_APPKEY=...
npx supabase secrets set SUNGROW_SECRET=...
npx supabase secrets set GROWATT_API_TOKEN=...
npx supabase secrets set SYNTHETIC_INVERTER_READINGS=0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/inverter-poll/index.ts
git commit -m "feat(inverter-poll): real adapter dispatch (Growatt + Sungrow); deploy"
```

### Task 8.2: n8n schedule

**Files:**
- Create: `infrastructure/n8n/workflows/60-inverter-poll-cron.json`

- [ ] **Step 1: Author the workflow JSON**

scheduleTrigger `*/5 * * * *` (every 5 min) → HTTP POST to `{SUPABASE_URL}/functions/v1/inverter-poll` with Authorization Bearer (Supabase service key).

(Same pattern as `infrastructure/n8n/workflows/19-vivek-daily-7am-digest.json`.)

- [ ] **Step 2: Push + activate**

```bash
pnpm tsx scripts/push-n8n-workflows.ts
```

- [ ] **Step 3: Commit**

```bash
git add infrastructure/n8n/workflows/60-inverter-poll-cron.json
git commit -m "feat(n8n): inverter-poll cron every 5 min"
```

### Task 8.3: End-to-end smoke

- [ ] **Step 1: Insert one Growatt inverter (Radiance Flourish)**

Already done in Task 4.3 Step 3. Verify it's there.

- [ ] **Step 2: Wait for next 5-min tick + check readings landed**

```sql
SELECT COUNT(*), MIN(recorded_at), MAX(recorded_at)
FROM inverter_readings
WHERE recorded_at > NOW() - interval '10 minutes';
```

Expected: ≥1 row from the past 5 min.

- [ ] **Step 3: Verify rollup populated next morning**

After 02:22 IST cron runs:

```sql
SELECT * FROM inverter_readings_daily WHERE day = CURRENT_DATE - 1;
```

Expected: 1 row per polled inverter.

- [ ] **Step 4: Repeat steps 1-3 for one Sungrow inverter (post-OAuth)**

---

# Phase 9 — Docs

### Task 9.1: CHANGELOG entries

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Add entries**

```markdown
- **[2026-05-23]** Inverter integration V1 — schema (migration 103), bulk-imported ~100 customer monitoring credentials into `plant_monitoring_credentials`, 4 Shiroi master credential rows, Growatt OpenAPI v1 adapter live (token-based), Sungrow OpenAPI v2 adapter live (OAuth2 + RSA), `/om/inverters` UI shipped, Edge Function wired + n8n schedule every 5 min. SolarMan + Goodwe stubs synthetic-mode-ready, real impl deferred pending API access.
```

- [ ] **Step 2: Commit**

```bash
git add docs/CHANGELOG.md
git commit -m "docs(changelog): inverter integration V1 entry"
```

### Task 9.2: Module doc

**Files:**
- Modify: `docs/modules/om.md`

- [ ] **Step 1: Replace the "Built but awaiting live API credentials" section with the live state**

(Update the "Inverter Telemetry Architecture" section to remove the "SYNTHETIC_INVERTER_READINGS=1" reference for Growatt + Sungrow and replace with the live API path. Mention Phases 4-8 of the integration plan that landed.)

- [ ] **Step 2: Commit**

```bash
git add docs/modules/om.md
git commit -m "docs(om): mark inverter telemetry live (Growatt + Sungrow)"
```

### Task 9.3: CURRENT_STATUS

**Files:**
- Modify: `docs/CURRENT_STATUS.md`

- [ ] **Step 1: Strike the inverter blocker row**

Remove "Inverter live polling — adapter stubs + Edge Function + partitioned telemetry all shipped (migration 050 + `packages/inverter-adapters/`). Awaiting Sungrow/Growatt API registration (4–8 weeks)." from the Known Open Issues section, and add an entry to the In Flight table with status "Mostly shipped; SolarMan + Goodwe pending API access".

- [ ] **Step 2: Commit + push**

```bash
git add docs/CURRENT_STATUS.md
git commit -m "docs(status): mark inverter integration V1 mostly shipped"
git push origin main
```

---

# Open follow-ups (not in this plan)

- **SolarMan adapter real implementation** when paid Basic plan keys arrive (~1 week after payment). Use this plan's solarman.ts as the skeleton; fill in `fetchReadings` per the SolarMan v1.1.7 API manual.
- **Goodwe SEMS adapter** when Goodwe India responds (~2-6 weeks). Same pattern.
- **Fimer/ABB Aurora Vision adapter** — needs FIMER India email, then per-plant datalogger audit (VSN300 / VSN700 / PVI-AEC-EVO present?). Defer to a separate plan.
- **Polycab, Havells, Flin Energy adapters** — research the portal APIs first (each may not have a public API). Defer.
- **Per-plant data quality cleanup** — `projects.inverter_brand` has ~70 rows with capacity values ("3kw", "5 kw") stuffed into the brand field, plus 253 blank rows. Separate cleanup task.
- **Anjudham Phase II model** — currently one ERP project but 40 SolarMan accounts (one per apartment unit). Decide whether to model as 40 separate `inverters` rows under one project, or split into 40 projects. Discuss with Vivek before implementing.
- **Sungrow plant share via Manivel's account** — if at any point the customer-facing iSolarCloud accounts change ownership (e.g., customer revokes Manivel's share), the OAuth2 token becomes useless for those plants. Add an n8n alert if plant count drops unexpectedly.
- **Customer credential expiry handling** — passwords rotate. Add a "credential health" surface to `/om/plant-monitoring` showing creds that are >12 months old or where the last manual check failed.

---

# Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-23-inverter-integration-v1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a large plan like this (9 phases) where each task is well-defined.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best if you want to be in the loop on every commit.

**Which approach?**
