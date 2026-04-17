# Documentation Restructure — Design Spec

**Date:** April 17, 2026
**Author:** Claude (with Vivek's approval)
**Status:** Approved, executed same day

## Problem

`CLAUDE.md` (811 lines / 147 KB) and `docs/SHIROI_MASTER_REFERENCE_3_0.md` (1,906 lines / 178 KB) are both loaded/read at every chat start. Combined ~80K tokens burned before any work begins. Both files overlap heavily and have accumulated hundreds of rows of historical build log. Effect: small-feature chats waste tokens; Claude is slower; history drifts and gets stale.

## Constraints

- Still actively building — 3 more big modules to go. Depth of context matters.
- But want small chats to stay cheap.
- Nothing gets deleted — historical detail archives, doesn't vanish.
- Founder (Vivek) reviews every file. Structure must be easy for a human to navigate too.

## Design

### Five-layer file structure

```
shiroi-erp/
├── CLAUDE.md                              ← ~150 lines. ALWAYS loaded.
├── docs/
│   ├── CURRENT_STATUS.md                  ← ~50 lines. Weekly refresh.
│   ├── SHIROI_MASTER_REFERENCE.md         ← ~600 lines. Stable domain.
│   ├── CHANGELOG.md                       ← Append-only. One line per milestone.
│   ├── modules/                           ← On-demand, one per module.
│   │   ├── sales.md
│   │   ├── design.md
│   │   ├── projects.md
│   │   ├── purchase.md
│   │   ├── finance.md
│   │   ├── om.md
│   │   ├── liaison.md
│   │   ├── hr.md
│   │   ├── inventory.md
│   │   └── contacts.md
│   ├── design/                            ← Design system (deduped).
│   ├── superpowers/{plans,specs}/         ← Unchanged.
│   └── archive/                           ← All historical bloat lands here.
```

### What goes where

**`CLAUDE.md` (always loaded, ~150 lines):**
- "WHERE TO FIND THINGS" table (first thing)
- Identity (4 lines)
- Tech stack (locked, 1 table)
- Repo structure (ascii tree)
- Env variable names (no values)
- Coding standards — summary list, details in master reference
- NEVER-DO rules — one line each, 20 rules
- Workflow (3 lines)
- How to work in this repo (small-fix vs. feature vs. new-module)

**`docs/CURRENT_STATUS.md` (~50 lines):**
- Current week's in-flight work (3–5 items)
- Migration state: latest dev migration, latest prod migration, list of pending prod migrations
- Env URLs
- Updated weekly by whoever is working

**`docs/SHIROI_MASTER_REFERENCE.md` (~600 lines):**
- Company context, roles, handoff chain
- Five core problems
- Technology choices (full rationale)
- Development environment (dev-first workflow, migration workflow, type regen)
- Coding standards in depth (sections 4.1–4.11 from old master ref, preserved)
- Database spine, conventions, triggers, RLS patterns, document numbering, file storage
- Three-tier immutability model
- Field friction standards
- Completion percentage model
- Integrations (PVWatts, PVLib, Claude API, n8n, Zoho, WATI, inverter APIs)
- Security model (RLS patterns)
- Observability (Sentry, system_logs)
- Decisions log (compact)
- Known complexities (CEIG, IR, sum-to-100%, MSME 45-day, phone uniqueness, offline sync)
- Cross-cutting subsystems: tasks, data flagging, WhatsApp import

**`docs/modules/<module>.md` (~150 lines each, on-demand):**
- User flow / screens in this module
- Module-specific business rules
- Key tables + relationships
- Key files (routes, queries, actions, components)
- Module gotchas
- Past decisions + why
- Links to relevant specs in `superpowers/specs/`

**`docs/CHANGELOG.md`:**
- One line per shipped milestone: `[YYYY-MM-DD] Headline → migrations X, Y, Z · spec: <path>`
- Compresses the bloated CLAUDE.md footer + CURRENT STATE table entries
- Source of truth for "when did we ship X / which migration was X in"

**`docs/archive/`:**
- Entire current `CLAUDE.md` (archived as `CLAUDE_MD_2026-04-17_ARCHIVED.md`)
- Entire current `SHIROI_MASTER_REFERENCE_3_0.md` (archived as `SHIROI_MASTER_REFERENCE_3_0_ARCHIVED.md`)
- The existing `SHIROI_MASTER_REFERENCE_2_6_ARCHIVED.md`
- Duplicate V2 design system files
- Ai Studio reference TSX files
- `projects dashboard.md` (legacy PM spec)

## Load pattern

| Chat type | What Claude reads at start |
|-----------|---------------------------|
| Small fix / question | CLAUDE.md only (~5K tokens) |
| Feature in existing module | CLAUDE.md → CURRENT_STATUS.md → SHIROI_MASTER_REFERENCE.md → `modules/<module>.md` (~25K tokens) |
| New module / big refactor | All of above + relevant `superpowers/specs/` + `superpowers/plans/` (~40K tokens) |
| "When did we ship X" | Grep `CHANGELOG.md` (~3K tokens) |

Down from current ~80K unconditional.

## Migration steps (executed 2026-04-17)

1. Create `docs/archive/`, `docs/modules/`, `docs/design/`.
2. Archive `CLAUDE.md` + `SHIROI_MASTER_REFERENCE_3_0.md` as `_ARCHIVED` copies.
3. Move duplicate design system files to archive. Consolidate to single `docs/design/design-system.{md,html}`.
4. Move `Shiroi_Energy_Brand_Guide_V6.html` → `docs/design/brand-guide.html`.
5. Move `Ai studio/` → `docs/archive/ai-studio-screens/`.
6. Move `projects dashboard.md` → `docs/archive/projects-dashboard-notes.md`.
7. Write new `CLAUDE.md` (~150 lines).
8. Write new `docs/SHIROI_MASTER_REFERENCE.md` (~600 lines) — extract stable sections from archived master ref, drop CURRENT STATE table + per-migration footers.
9. Write `docs/CURRENT_STATUS.md` from current in-flight work.
10. Write `docs/CHANGELOG.md` — compress archived CURRENT STATE tables + footers to one-line-per-milestone entries.
11. Write `docs/modules/*.md` — parallel subagents, each agent reads its module's routes + queries + actions + relevant specs and produces a concise module doc.
12. Delete `docs/SHIROI_MASTER_REFERENCE_3_0.md` after verifying new master reference is complete.

## Success criteria

- `wc -l CLAUDE.md` returns ≤ 200.
- `wc -l docs/SHIROI_MASTER_REFERENCE.md` returns ≤ 700.
- CLAUDE.md startup cost ≤ 6K tokens.
- No domain knowledge lost (searchable in archive or new slim files).
- All 10 modules documented in `docs/modules/`.
- `docs/CHANGELOG.md` has at least one entry per historical milestone from the archived CURRENT STATE tables.
- Vivek can find anything that was in the old files via the "WHERE TO FIND THINGS" table in CLAUDE.md.
