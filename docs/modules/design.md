# Design Module

> Lead in Path B (detailed proposal) → design workspace → BOM via price-book-gated picker → design_confirmed → sales team finalizes proposal.
> Related modules: [sales], [projects]. This module hands off to sales for proposal send.

## Overview

The Design module is where the Designer (and Marketing Manager) turn a site-surveyed lead into a buildable technical package: AutoCAD layouts, PVsyst simulations, panel/inverter specs, and a price-book-gated BOM. It is the engineering gate between the Sales "quick quote" stage and the "detailed proposal" send. The workspace lives at `/design/[leadId]` and auto-creates a draft detailed proposal on entry so every BOM line is tied to a real proposal row from the first click.

## User Flow

- Lead reaches `site_survey_done` → sales/marketing team routes the lead to `/design`.
- `/design` list page shows all leads with `status IN (site_survey_done, design_in_progress)`, sorted by oldest-first so nothing rots in the queue.
- `/design/[leadId]` is the per-lead workspace:
  - On entry: if the lead is in Path B and has no `draft_proposal_id`, `createDraftDetailedProposal(leadId)` fires and stashes the new proposal's id back on the lead.
  - **Lead Files Panel:** drag-drop category grid scoped to `proposal-files/leads/{leadId}/{category}/`. Six categories — `drawings`, `pvsyst`, `photos`, `specs`, `proposal`, `misc`. Reuses `CategoryBox` + `PhotoSlideshow` from `components/projects/project-files/parts-boxes.tsx` so the visual pattern matches the project Documents tab.
  - **BomPicker:** price-book-gated editor. Searchable typeahead over `price_book` (50-result cap, filter by description / brand / category), qty input, inline row qty edit, Trash2 remove. Every new line carries `price_book_id`. Legacy free-text rows show a warning chip.
  - **Design Notes Editor:** textarea with blur-save + a "Mark Design Confirmed" button that stays disabled until all preconditions are satisfied — inline blocker-reasons list shows exactly what's missing.
- Preconditions for `design_confirmed`: BOM has at least one line, every line has `price_book_id`, notes non-empty, lead currently in `design_in_progress`.
- On confirm: `design_confirmed_at` + `design_confirmed_by` stamped on the lead, status flipped to `design_confirmed`. Sales team takes it from there via `finalizeDetailedProposal` on the Quote tab.

## Key Business Rules

- `price_book_id` FK is **mandatory** on every `proposal_bom_lines` row for Path B. Enforced in code via `finalizeDetailedProposal` validation — a missing FK blocks the detailed-proposal send outright.
- Sync chain: **Quote → BOQ → PO** — all three tables joined via `price_book_id` so a rate change in the price book is traceable downstream.
- Design confirmed stamps `design_confirmed_at` and `design_confirmed_by` on the lead. `sendBackToDesign` reverses those stamps and flips status back to `design_in_progress` for marketing escape-hatch.
- `designer` role has SELECT on `projects` + full access on `price_book` (RLS from migration 052). Designer cannot edit projects — that stays with PM.
- `marketing_manager` can operate as designer too (Prem wears both hats on a small team).

## Key Tables

- `leads` (`status = design_in_progress / design_confirmed`, `design_notes`, `design_confirmed_at`, `design_confirmed_by`, `draft_proposal_id`)
- `proposals` (`type = detailed`, `status = draft` during design workspace work)
- `proposal_bom_lines` (`price_book_id` FK mandatory for Path B — see master reference for full schema)
- `price_book` (252 active rows, 22 categories — see [contacts / price-book] module)
- `storage.objects` in bucket `proposal-files` under `leads/{leadId}/{category}/`

## Key Files

```
apps/erp/src/app/(erp)/design/
  page.tsx                        # list view — leads in site_survey_done / design_in_progress
  [leadId]/page.tsx               # per-lead workspace

apps/erp/src/lib/
  design-actions.ts               # submitDesignConfirmation, saveDesignNotes, sendBackToDesign
  design-queries.ts               # list + per-lead workspace data fetch
  quote-actions.ts                # shared with sales: createDraftDetailedProposal, addBomLineFromPriceBook, updateBomLineQuantity, removeBomLine

apps/erp/src/components/
  design/lead-files-panel.tsx     # drag-drop category grid over proposal-files bucket
  design/design-notes-editor.tsx  # textarea + blur-save + Mark Design Confirmed with blocker list
  sales/bom-picker.tsx            # SHARED — also used on /sales/[id]/proposal Quote tab
```

## Known Gotchas

- **BomPicker is shared** between the design workspace and the sales Quote tab — don't fork it. Any change needs to work in both call sites.
- `CategoryBox` + `PhotoSlideshow` come from `components/projects/project-files/parts-boxes.tsx`. Reusing them across `lead-files-panel` keeps the visual pattern single-source — don't reimplement.
- `proposal-files` bucket storage RLS was rebuilt in migration 052 to include `marketing_manager` + `designer` on INSERT / UPDATE / DELETE. Earlier migrations only covered the legacy sales_engineer role.
- **Design notes are NOT committed to proposals.** They live on `leads.design_notes` so they persist even if the draft proposal is discarded and recreated.
- `draft_proposal_id` FK on `leads` points at the auto-created detailed draft. If that proposal is manually deleted, the FK goes stale — the workspace will recreate on next entry.
- Legacy (pre-migration-053) BOM lines may be free-text without `price_book_id`. BomPicker flags them with a warning chip; the designer has to re-add them from the price book before confirmation.

## Past Decisions & Specs

- Migration 052 — `design_notes`, `draft_proposal_id`, `price_book_id` FK on `proposal_bom_lines` + `project_boq_items`, designer + marketing_manager RLS
- Migration 053 — fuzzy-matched `price_book_id` backfill on existing BOM lines (23/35,022 matched; low hit rate is expected because legacy data is free-text)
- `docs/superpowers/plans/2026-04-06-marketing-redesign.md` — full rollout plan for Path A / Path B + design workspace
- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — original design spec

## Role Access Summary

| Role | Design list | Design workspace | price_book | projects |
|---|---|---|---|---|
| `designer` | full | full CRUD on leads in design_in_progress | full | SELECT |
| `marketing_manager` | full | full (operates as designer too) | full | SELECT |
| `founder` | full | full | full | full |
| `project_manager` | read-only window | read-only | SELECT (Reference) | full |
| others | — | — | — | — |
