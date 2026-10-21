# Manivel Google Sheet ↔ ERP Live Sync — Design

> Status: approved direction 2026-10-21 (Vivek: "share both sheets, write the spec, start sheet→ERP on dev").
> Phase 1 (this doc's build scope) = **sheet → ERP, dev-only, read + diff + link — no writes to core tables.**
> Predecessor: `2026-06-15-manivel-dashboard-parity-design.md` (one-time snapshot reconciliation, migs 180/181).

## 1. Problem

Manivel still runs projects off two Google Sheets. Every earlier ERP import was a **one-time snapshot**
(June xlsx → `recon_sheet_projects`; July BOI JSON → `/purchase`), so the ERP drifts the moment he edits.
Measured 2026-10-21: dashboard sheet has **310** projects (snapshot had 264), 270 tasks, 46 services.

| Source | Spreadsheet id | Tabs | Owner | Service-account access (2026-10-21) |
|---|---|---|---|---|
| `manivel_dashboard` ("shiroienergy", Apps-Script dashboard) | `1m8Ywb88fT9bwAMQZK1iM9DhfUv1lWYJhGRSLHH921Bk` | Projects, Budgets, Tasks, Services, Activities, Plant Monitoring, Project details | manivel@ | **reader** |
| `manivel_boi` ("Bill of Items") | `1CsAYamXivIpqPJkKzum0vdkyfoKWBNUrv1C62wmktt8` | Projects (has a UUID `ID` col), Bill of Items, Expenses, Price Book | manivel@ | **none (403)** — owner must share |

Service account: `shiroi-migaration@shiroi-migataion.iam.gserviceaccount.com`. Editors cannot re-share
these files (owner setting), so **Manivel must add it as Editor himself** — required for phase 2 (write-back)
and for any BOI read.

## 2. Goals / non-goals

**Goals:** a live, scheduled mirror of both sheets inside the ERP; field-level change log of every edit
Manivel makes; a stable sheet-row → ERP-project link; a review page. Build on the reconciliation links
already confirmed (mig 180).

**Non-goals (phase 1):** writing into `projects`/tasks/activities; writing to the sheet; touching
Manivel's Apps Script; syncing plant-monitoring passwords; prod.

## 3. Architecture

```
pg_cron (*/10 min) ──pg_net POST──▶ Edge Function `gsheet-sync`
                                      │ 1. service-account JWT (RS256, WebCrypto) → Google OAuth token
                                      │ 2. spreadsheets.values.batchGet (all tabs of each enabled source)
                                      │ 3. normalise rows + compute row_key per tab (deterministic)
                                      ▼
                         RPC gsheet_apply_snapshot(source, tab, rows jsonb)   ← set-based diff in SQL
                           ├─ gsheet_rows        (current mirror, 1 row per sheet row)
                           ├─ gsheet_changes     (insert / update-per-field / remove events)
                           └─ gsheet_project_links (auto-link new names)
                         gsheet_sync_runs       (one row per run per source: counts, status, error)
```

* **No n8n** (spare-laptop dependency; past outages). Trigger is DB-native: `pg_cron` + `pg_net`,
  secrets in Vault (`gsheet_sync_url`, `gsheet_sync_secret`) — same pattern as mig 222.
* Function auth: `verify_jwt=false` + shared secret header `x-gsheet-sync-secret` (Edge secret
  `GSHEET_SYNC_SECRET`). Service-account key = Edge secret `GOOGLE_SERVICE_ACCOUNT_JSON`
  (moved out of `~/Downloads`).
* Sources are rows in `gsheet_sources` (enable/disable without a deploy). A 403 on one source records
  a failed run and does not block the others.

## 4. Row identity (the hard part)

The dashboard sheet has **no IDs**; the BOI Projects tab does (`ID` UUID). Row keys are built from
identity columns, normalised with the same `norm()` as `scripts/reconcile-manivel.ts`
(lower, `&`→and, strip punctuation + honorifics, collapse spaces):

| Tab | row_key |
|---|---|
| Projects, Budgets, Project details | `norm(Project Name)` |
| Tasks | `norm(Project)·norm(Task Name)·norm(Assigned to)` |
| Services | `norm(Project)·norm(Task Name)·Assigned date·norm(Assigned to)` |
| Activities | `Date·norm(Project)·norm(Stage)·norm(Done By)` |
| Plant Monitoring | `norm(Project)·norm(Brand)` |
| BOI tabs | sheet `ID` column when present, else name-based as above |

Duplicate keys within one tab get `#2`, `#3` suffixes in sheet order. Consequence: **renaming a project
or a task's identity columns appears as remove + insert**, not update. Acceptable for phase 1; phase 2
writes an `ERP ID` column (far right) into each Projects tab to make project identity rename-proof.

## 5. Data model (mig 224)

* `gsheet_sources(id text pk, spreadsheet_id, title, enabled, tabs text[], last_run_at, last_status, last_error)`
* `gsheet_rows(source_id, tab, row_key, project_key, sheet_row, data jsonb, row_hash, first_seen_at,
  last_seen_at, last_changed_at, removed_at)` — PK `(source_id, tab, row_key)`.
* `gsheet_changes(id, source_id, tab, row_key, project_key, project_id, change_type insert|update|remove,
  field, old_value, new_value, detected_at, review_status pending|applied|ignored, reviewed_by → employees, reviewed_at)`.
  First-ever load of a tab is a **baseline**: mirrors rows but logs no `insert` events (avoids 900 noise rows).
* `gsheet_project_links(source_id, project_key, project_id, link_method exact|recon|manual, linked_by, linked_at)` — PK `(source_id, project_key)`.
* `gsheet_sync_runs(id, source_id, started_at, finished_at, status ok|error|partial, tabs, rows_seen, inserts, updates, removes, error)`.
* RLS: read = founder + project_manager; writes = service role (sync) and founder/PM (review + manual link).

**Secrets never mirrored:** Plant Monitoring `Username`/`Password` are dropped in the Edge Function
before the RPC call; `data` keeps only `has_credentials: true|false`.

**Auto-linking** (in the RPC, for each new `project_key`):
1. `project_reconciliation` row whose `recon_sheet_projects.name_norm = project_key` and
   (`status='confirmed'` or `match_method='auto'` and not rejected) → `recon`.
2. else exactly one live project whose normalised `COALESCE(project_name, customer_name)` equals it → `exact`.
3. else unlinked → shown on the review page for a manual link.

## 6. Field ownership — DECIDED 2026-10-21 (Vivek)

* **Manivel's dashboard sheet wins everything.** The ERP is not the working tool for now; phase 2
  makes the sheet the source of truth and overwrites the linked ERP fields.
* **Master project list = dashboard Projects tab (310).** Bill of Items is a subset of it.
* Phase-2 write-back to the sheet is therefore limited to the `ERP ID` column (no ERP-owned columns).

Status map (sheet → `project_status`, verified against all 310 rows — every value maps):

| Sheet | ERP |
|---|---|
| Completed | completed |
| Yet to Start | yet_to_start |
| In Progress, On Progress | in_progress |
| Waiting for Net Meter, Waiting for Meter | waiting_net_metering |
| Holding from client | holding_client |
| Holding from Shiroi | holding_shiroi |
| Meter Client Scope | meter_client_scope |

`order_received` has no sheet equivalent; linked projects in that state take the sheet's value.

## 7. UI — `/sheet-sync` (founder + PM)

KPIs (last run, rows mirrored, pending changes, unlinked projects) · per-source run status with last
error · **Unlinked sheet projects** with a project combobox → manual link · **Recent changes** feed
(tab, project, field, old → new, time) with Mark applied / Ignore.

## 8. Phases

1. **(this build)** sheet → ERP mirror + change log + links + review page. Dev only.
2. Auto-apply sheet-owned fields (status map, tasks, activities, services) via a per-field rule table;
   Budget diffs feed `project_reconciliation`; write `ERP ID` + ERP-owned columns back to the sheet
   (needs Editor share).
3. Sunset: Command Center replaces the Apps Script dashboard; sheet becomes a read-only ERP mirror.

## 9. Open items (need Vivek / Manivel)

1. Manivel shares both sheets with the service account as **Editor** (BOI is blocked until then).
2. Which Projects list is master — dashboard (310) or BOI (275)?
3. OK to append an `ERP ID` column at the far right of each Projects tab (phase 2)?
4. ~~Confirm §6 field ownership + status mapping~~ — decided 2026-10-21, see §6.

**Status 2026-10-21 (later):**
- (1) Dashboard sheet: service account is now **Editor** (shared from Vivek's Chrome as svivek.88@gmail.com).
  **BOI still 403**: it is shared only with vivek@shiroienergy.com / coord@ / manivel@, none of which is
  signed in to that Chrome. Share it from one of those accounts.
- (2) Master = dashboard (310); BOI is a subset.
- Phase-2 rules still to confirm: (a) a blank/₹0 sheet cell does NOT erase an ERP value;
  (b) the 64 unlinked sheet projects become new ERP projects after the manual-link pass;
  (c) sheet "Project Cost" → `projects.contracted_value`; "Actual Cost" stays in
  `project_reconciliation.sheet_actual_cost` (the ERP has no stored actual-cost column).
