/**
 * Generate migration 078 from docs/drive-proposal-date-matches.csv.
 *
 * For each match where:
 *   - drive_created is present
 *   - bulk_reorg = false
 *   - drive_created is before today
 * we emit a VALUES row that SETs proposals.created_at = drive_created (IST noon).
 *
 * The migration unconditionally replaces the DB date with Drive's date because
 * Drive's createdTime reliably reflects when the proposal folder was created
 * (i.e. when the quote was generated). It's more accurate than our synthetic
 * FY/CY fallback dates.
 *
 * Cascade: after updating proposals, re-run the lead-cascade (MIN of proposals
 * per lead) to pull lead dates back.
 */

import { readFileSync, writeFileSync } from 'fs';

type Row = {
  key: string;
  db_id: string;
  db_number: string;
  db_current: string;
  drive_name: string;
  drive_id: string;
  drive_created: string;
  drive_modified: string;
  year_folder: string;
  bulk_reorg: string;
  candidate_count: string;
};

function parseCSV(path: string): Row[] {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    const cols: string[] = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    const row: any = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
    out.push(row as Row);
  }
  return out;
}

function main() {
  const matches = parseCSV('docs/drive-proposal-date-matches.csv');

  // Deduplicate by db_id — prefer the row with the EARLIEST drive_created
  // (if one drive folder has multiple matches, or one proposal matches
  // multiple drive folders, the earlier date is the safer signal).
  const byId = new Map<string, Row>();
  for (const m of matches) {
    if (m.bulk_reorg === 'true') continue;
    if (!m.drive_created || m.drive_created.length < 8) continue;
    if (m.drive_created >= '2026-04-01') continue; // post-clobber, skip
    // Skip ambiguous
    if (parseInt(m.candidate_count, 10) > 1) continue;
    const existing = byId.get(m.db_id);
    if (!existing || m.drive_created < existing.drive_created) {
      byId.set(m.db_id, m);
    }
  }

  const finalRows = [...byId.values()];
  console.log(`Final rows: ${finalRows.length}`);

  // Emit SQL
  const values = finalRows.map(r => {
    // Convert YYYY-MM-DD to IST timestamp at 12:00 noon
    return `  ('${r.db_id}'::uuid, make_timestamptz(${r.drive_created.slice(0,4)}, ${parseInt(r.drive_created.slice(5,7),10)}, ${parseInt(r.drive_created.slice(8,10),10)}, 12, 0, 0, 'Asia/Kolkata'))`;
  }).join(',\n');

  const sql = `-- ============================================================================
-- Migration 078 — Backfill proposal dates from Google Drive folder createdTime
-- ============================================================================
-- Context: migrations 076+077 used FY/CY year from project_number / proposal_number
-- and fell back to the FY or CY start date (e.g. April 1 or January 1). Those
-- synthetic boundary dates clustered hundreds of proposals on fake dates:
--   - 2025-04-01 IST: 174 proposals
--   - 2024-04-01 IST: 115
--   - 2024-01-01 IST: 96
--   - 2023-01-01 IST: 84
--   - 2022-01-01 IST: 48
--   - 2022-04-01 IST: 44
--
-- User (Vivek) flagged this as wrong: "Everything here is 31/3/24 that is the
-- date on which it was uploaded to Hubspot. Hubspot is not right with the dates.
-- Pls go over the google drive properly..."
--
-- We scanned 4 "Proposals YYYY" folders in Google Drive (1,405 children), matched
-- folder names like "PV018/24 Customer Name" to DB proposal_number, and kept
-- ${finalRows.length} unambiguous matches with non-bulk-reorg Drive createdTime.
-- (The 2022 folder was bulk-reorganised on 2023-05-23, so those Drive dates
-- cannot be used — 70 matches filtered out.)
--
-- Safety:
--   - Only updates ${finalRows.length} specific proposal UUIDs (inline list).
--   - Unconditional replacement: Drive createdTime is authoritative.
--   - Timestamps set to 12:00 noon IST for stable display.
--   - Leads get re-cascaded (MIN of linked proposals).

BEGIN;

-- ------------------------------------------------------------------
-- 1. Proposals — created_at ← Drive folder createdTime (unconditional)
-- ------------------------------------------------------------------
WITH drive_dates (proposal_id, new_created_at) AS (VALUES
${values}
)
UPDATE proposals pr
SET created_at = dd.new_created_at
FROM drive_dates dd
WHERE dd.proposal_id = pr.id;

-- ------------------------------------------------------------------
-- 2. Leads — re-cascade MIN(linked proposal.created_at)
-- ------------------------------------------------------------------
WITH lead_first_proposal AS (
  SELECT lead_id, MIN(created_at) AS earliest
  FROM proposals
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
)
UPDATE leads l
SET created_at = lfp.earliest
FROM lead_first_proposal lfp
WHERE lfp.lead_id = l.id
  AND l.created_at > lfp.earliest;

-- ------------------------------------------------------------------
-- 3. Projects — re-cascade from proposal_id FK when present
-- ------------------------------------------------------------------
UPDATE projects p
SET created_at = pr.created_at
FROM proposals pr
WHERE pr.id = p.proposal_id
  AND p.created_at > pr.created_at;

COMMIT;
`;

  writeFileSync('supabase/migrations/078_backfill_proposal_dates_from_drive.sql', sql);
  console.log('Wrote supabase/migrations/078_backfill_proposal_dates_from_drive.sql');
}

main();
