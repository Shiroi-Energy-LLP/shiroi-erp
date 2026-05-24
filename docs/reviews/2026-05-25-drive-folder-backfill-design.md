# Drive Folder Backfill Design Note — 2026-05-25

> Scope: 1,353 historical proposal Drive folders promised in mig 109 "Phase 2 (deferred)".
> Decision gate: Vivek to read and approve before any script is written.

## What the CSV actually is

`scripts/data/documents-backfill-storage-audit.csv` (7,636 data rows + 1 header = 7,637 lines)
is **not a Drive folder list**. It is the output of
`scripts/index-supabase-storage-into-documents.ts`, which walks the
`proposal-files` Supabase Storage bucket and records what was inserted (or
skipped as duplicate) into `documents`. Columns:

```
lead_id, filename, storage_path, size_bytes, mime_type, inferred_category, action, error
```

Sample rows span many lead UUIDs, each with multiple files (docx, pdf, xlsx,
mp4, jpeg). The `action` column is uniformly `inserted` in all sampled rows —
meaning this CSV captured the last time the Supabase Storage backfill ran, and
those rows were already written to `documents`.

## What is NOT done yet

The mig 109 spec describes two distinct backlogs:

1. **Supabase Storage → `documents`** — already done (CSV proves it ran; rows
   exist).
2. **Google Drive proposal folders → `documents`** — 1,353 folders, never
   done. The "1,353" figure comes from the mig 109 comment ("Phase 2
   deferred: 1,353-folder backfill"). No Drive-keyed rows with
   `storage_backend='drive'` exist in `documents` from this batch.

There is no existing script for the Drive backfill. `scripts/migrate-google-drive.ts`
and `scripts/sync-gdrive-files-to-supabase.ts` exist but are not the Drive→documents
indexer (they copy files into Storage, not index Drive metadata into `documents`).

## Target table

`public.documents` (mig 109). Relevant columns for the Drive backfill:

| Column | Value |
|--------|-------|
| `lead_id` | matched via `leads.drive_folder_id` or proposal_number lookup |
| `storage_backend` | `'drive'` |
| `external_id` | Drive folder ID (the folder, not individual files) |
| `external_url` | Drive webViewLink (cached, avoids API roundtrip) |
| `name` | folder name |
| `category` | `'misc'` for folder-level entries, or per-file if files are listed |
| `lead_id / proposal_id` | at least one required (NOT NULL constraint) |

The `documents_storage_backend_integrity` CHECK requires `external_id IS NOT NULL`
when `storage_backend='drive'`.

## Matching strategy

`leads.drive_folder_id` was added in mig 109 (`ADD COLUMN IF NOT EXISTS drive_folder_id TEXT`).
If it was backfilled when Drive folders were created, the join is direct:

```sql
SELECT id, drive_folder_id FROM leads WHERE drive_folder_id IS NOT NULL;
```

If `leads.drive_folder_id` is mostly NULL (likely — it was added in mig 109
and may never have been populated for historical leads), the fallback is:
folder name → proposal_number → `proposals.proposal_number` → `proposal_id`
→ `lead_id`. Folder names at Shiroi follow `PV{NNN}/{YY} - {customer_name}` or
`SE/PV/{NNN}/{YY}` patterns.

**Coverage already confirmed:** `SELECT COUNT(*) total_leads, COUNT(drive_folder_id) with_drive_folder FROM leads` → **1,074 of 1,245 leads already have `drive_folder_id`** (86%). The direct join path is viable. The remaining 171 leads without a folder ID would need the fuzzy folder-name matching fallback or manual assignment.

## Risks

1. **No source of truth for folder list.** The actual list of 1,353 Drive
   folder IDs does not exist in the repo. A Drive API call to list the
   shared drive / root folder is needed to enumerate them.
2. **Duplicate detection.** Run against `documents` table filtered by
   `storage_backend='drive'` and `external_id` before inserting. The script
   must check `EXISTS (SELECT 1 FROM documents WHERE external_id = $folder_id)`
   for idempotency.
3. **Proposal-number matching failures.** Folder names may not parse cleanly.
   Any unmatched folder must be logged (skip, don't fail) with the folder name
   so Vivek can manually assign.
4. **Drive API rate limits.** 1,353 folders × metadata fetch = well within
   Google Drive API quotas (1,000 req/100s), but needs exponential backoff.
5. **`drive_folder_id` on leads may be empty.** If `leads.drive_folder_id`
   was never backfilled, the script doubles as a backfill for that column too —
   add that as a secondary write.

## Estimated script complexity

- 2–3 hours to write and test, assuming:
  - Service account JSON for Drive API is already available (check `.env.local`
    for `GOOGLE_SERVICE_ACCOUNT_JSON` or similar)
  - `leads.drive_folder_id` coverage is known before starting
  - The folder naming convention is consistent enough for regex parsing
- Add 1–2 hours if Drive API credentials need provisioning or folder-name
  matching requires manual review of edge cases.

## What to decide before writing the script

1. **Already answered:** 1,074/1,245 leads have `drive_folder_id` — the direct
   join path is viable. Decide whether to skip the 171 without a folder ID or
   attempt Drive API enumeration for them.
2. Confirm whether the 1,353 folders are in a single shared Drive or spread
   across personal Drives.
3. Decide granularity: index the **folder** as one `documents` row, or
   enumerate files within each folder. The former is much faster; the latter
   gives richer data but is 1,353 × avg-files-per-folder API calls.

---

*Written 2026-05-25 by Claude Sonnet 4.6 as a pre-decision investigation note.
Do not execute — await Vivek's decision on the three questions above.*
