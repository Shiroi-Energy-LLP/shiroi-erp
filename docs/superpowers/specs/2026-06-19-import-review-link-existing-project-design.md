# Import Review → "Link to existing project" — design (2026-06-19)

## Problem
The O&M **Plant Monitoring** page lists `plant_monitoring_credentials` (33 rows). But 172 plants with portal logins sit unpromoted in `pending_project_imports`. The Import Review **Approve** action creates a *new* project for every non-exact import — so for a plant that already has an ERP project, approving makes a **duplicate**. There is no in-app way to attach a staged plant's credential to an *existing* project. This feature adds that, so Manivel (project_manager) can finish the whole O&M backfill from `/om/import-review`.

## Design
A **Link** action on each Import Review card: pick an existing project → attach the plant's monitoring credential (and an inverter row only if the project has none) → mark the import imported. No duplicate project.

### RPC (migration, dev-first)
`link_pending_import_to_project(p_import_id uuid, p_project_id uuid) RETURNS uuid` — `SECURITY DEFINER`, **founder/project_manager** gated (mirrors `approve_pending_import`):
1. Lock the import row; require `status_review ∈ ('pending','approved')`; reject child rows (`parent_import_id` set).
2. Verify `p_project_id` exists.
3. If `portal_username` present → `INSERT INTO plant_monitoring_credentials (project_id, portal_url, username, password_encrypted, inverter_brand, notes)` selecting from the import — **copy `portal_password_encrypted` ciphertext as-is** (both tables share the `plant_credentials_key` Vault secret, so no decrypt/re-encrypt); `inverter_brand = COALESCE(portal_brand,'other')`; `ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING`.
4. If the project has **no** `inverters` rows → insert one from the import (`brand = COALESCE(portal_brand,'other')`, model, `rated_capacity_kw`, `serial_number = NULLIF(inverter_serial_number,'')`, `commissioned_at = commissioning_date`, `polling_enabled = false`). Else skip — avoid duplicate inverters. (Per Vivek: create the inverter only when none exists; most won't.)
5. Update the import: `status_review='imported'`, `imported_project_id = matched_project_id = p_project_id`, `reviewed_by = auth.uid()`, `reviewed_at = COALESCE(reviewed_at, now())`.
6. `RETURN p_project_id`. `GRANT EXECUTE … TO authenticated` (the body enforces the role gate).

### Server action
`linkPendingImportToProject(importId, projectId): Promise<ActionResult<{ project_id: string }>>` in `apps/erp/src/lib/import-review-actions.ts` → calls the RPC; `revalidatePath('/om/import-review')` + `'/om/plant-monitoring'`. Never throws across the RSC boundary.

### UI
`ImportRowCard` gains a **Link** button beside Approve/Reject (shown when `status_review === 'pending'`). It opens a small dialog reusing the existing `ProjectCombobox` ([forms/project-combobox.tsx](apps/erp/src/components/forms/project-combobox.tsx)); on project select → call the action → `router.refresh()`. Inline error on failure, matching the Approve handler.

### Scope (decided)
- **Credential always**; **inverter row only if the project has none**; **never** create a project.
- `polling_enabled = false` on any inverter created — Deye serials arrive later via the API backfill, then polling is turned on.

### Migration + types
One new numbered migration, applied to **dev only** (no prod — per the dev-only rule). Regenerate `packages/types/database.ts` in the same commit so the new RPC is typed (NEVER-DO #20).

### Testing (dev)
Link a sample Deye import to an existing project → credential appears in Plant Monitoring under that project; the import flips to **Imported**; an inverter row is created only when the project had none; re-running the link is idempotent (no duplicate credential).
