# Docs Lean-Reset — Design Spec

**Date:** 2026-06-19
**Author:** Claude (brainstormed with Vivek)
**Status:** ✅ Done (2026-06-19) — all migration steps executed; success criteria met. Executed against a live file that a concurrent session was appending to, so the compressor was made content-keyed + idempotent and the archive snapshot was taken from the latest state.

---

## Problem

`docs/CHANGELOG.md` and `docs/CURRENT_STATUS.md` have regressed exactly what the 2026-04-17 docs restructure fixed: they were designed as lean, grep-able index files, and have re-bloated into walls of prose.

Measured 2026-06-19:

| File | Lines | Size | Avg chars/entry-line | Worst |
|------|-------|------|----------------------|-------|
| `CHANGELOG.md` | 334 | **320 KB** | **1,652** | 6,759 chars (one "entry") |
| `CURRENT_STATUS.md` | 188 | **~110 KB** | 592 | essay "Last updated" line |

- The changelog's **own** closing rule says *"One line per shipped milestone… **Keep it short.** Paragraphs of detail belong in the spec or the module doc — not here."* Current entries break that by ~20×.
- The drift is recent and accelerating: **June = 47 entries in 18 days**, and they are the longest (4,000–6,800 chars each).
- **17 entries already link to a `docs/reviews/` or spec doc holding the same detail** — the verbose prose is duplicated.
- The failure mode is structural: the changelog is appended by **Claude sessions** at end-of-task, so the discipline that slipped is the agent's, repeatedly, across sessions. A polite in-file note alone has already proven insufficient.

**Cost:** reading the changelog is ~80 K tokens; it is meant to be the quick "when did we ship X / which migration" index and is no longer scannable as one — it is a second copy of the review docs.

## Constraints

- **Zero information loss.** Nothing the verbose prose records may be destroyed.
- **Grep targets must survive** every compressed entry: `[YYYY-MM-DD]` dates, migration numbers, review/spec basenames, module names, and commit hashes where present. These are how the file is queried.
- **No autonomous prod / no skipping review.** Vivek reviews every file before commit (CLAUDE.md). Source-of-truth docs especially.
- **Founder's existing structure is sound** — the April-17 layout (CLAUDE.md → CURRENT_STATUS → master ref → modules → changelog → specs/plans → archive) stays. This is a content-discipline reset, not a re-layout.
- **Proportionate guardrail.** Per Vivek's choice: an advisory CI warning, **not** a build-failing gate.

## Design

### Part A — CHANGELOG.md

1. **Archive verbatim first (zero-loss safety net).** Copy the entire current `docs/CHANGELOG.md` byte-for-byte to `docs/archive/CHANGELOG_VERBOSE_2026-H1_ARCHIVED.md`, prefixed with a short header explaining it is the pre-reset verbose snapshot. Rationale: many small-fix entries have their detail *only* in the changelog prose (no separate review doc), so the snapshot is the preservation guarantee. `docs/archive/` is never auto-loaded into agent context, so this carries no ongoing context cost.

2. **Rewrite the live file lean**, using the file's own stated format:
   ```
   - **[YYYY-MM-DD]** <one-sentence headline> → <migration(s)> · <review/spec basename> · <module>
   ```
   - The structured tail (dates, migration numbers, review/spec basenames, module names, commit hashes) is **preserved on every entry** — these are the grep targets.
   - The blow-by-blow is dropped: hex-mapping lists, gate counts ("check-types 5/5"), "not committed — for Vivek's review" notes, and multi-clause root-cause narration. All of it remains in the archive + `docs/reviews/`.
   - One headline keeps the single most important fact: *what shipped and why it mattered*.
   - Already-compliant older entries (March / early April / "Earlier (foundation)") stay byte-identical — they are already one-liners.
   - Compression is **hand-curated**, entry by entry — a good one-liner requires understanding the change. No truncation script.

3. **Header note** at the top of the live file recording the 2026-06-19 lean-reset and pointing to the archive, mirroring the existing April-17 note already in the header.

### Part B — CURRENT_STATUS.md

Compress **in place** — no archive snapshot (it is a living weekly snapshot, not an append-only record of record; its content migrates into the changelog over time, and git history covers prior states).

- Replace the essay "Last updated" paragraph with a single line (date + one-line summary).
- Refresh the stale `In flight this week (April 14 – May 2, 2026)` window to the true 2026-06-19 state.
- Tighten each section to current truth; cut narration of *shipped* work (it is in the changelog).
- **Keep every structured section:** Prod cutover, Phase, Migration state, Environment URLs, Active CI / discipline gates, External registrations, Known open issues.
- **Preserve any forward-looking decision or plan** not captured elsewhere — only narration of completed work is cut.

### Part C — Guardrail (advisory, non-blocking)

1. **`scripts/ci/check-changelog-entry-length.sh`** — scans `docs/CHANGELOG.md` for entry lines (`^- \*\*\[`), flags any over a **400-char threshold** (a single constant at the top of the script, tunable), prints a warning naming each offender and the cap, and **exits 0** (never blocks a build or commit). Runnable locally.
2. **Wire it** into `.github/workflows/ci.yml` as a dedicated **non-failing** step so the warning surfaces in the Actions log.
3. **Documented rule:** strengthen the changelog's "How to append" section with the hard cap, and add a one-liner to CLAUDE.md workflow step 4.2:
   > Changelog entry = **1 line**. If it needs a paragraph, write `docs/reviews/<date>-<topic>.md` (or the spec) and **link it** — don't inline it.

### Out of scope (flagged, not touched)

- `docs/Zoho data/*.xls` (~35 MB of legacy Excel dumps inside `docs/`) — most of the docs tree's disk size. No context cost; candidate to relocate or gitignore in a separate task. Recorded here only.

## Migration steps

1. Copy `docs/CHANGELOG.md` → `docs/archive/CHANGELOG_VERBOSE_2026-H1_ARCHIVED.md` (verbatim) + add archive header.
2. Hand-rewrite the live `docs/CHANGELOG.md` lean (June first — the worst — then May, then verify April/March untouched). Add the reset header note.
3. Compress `docs/CURRENT_STATUS.md` in place; refresh stale window + "Last updated".
4. Add `scripts/ci/check-changelog-entry-length.sh` (advisory) + wire into `.github/workflows/ci.yml` as a non-failing step.
5. Update the changelog "How to append" rule + CLAUDE.md workflow step 4.2.
6. Verify (see success criteria), then Vivek reviews file-by-file → commit → push to main.

## Success criteria

- [ ] `docs/archive/CHANGELOG_VERBOSE_2026-H1_ARCHIVED.md` body is byte-identical to the pre-reset changelog (zero loss).
- [ ] Live `CHANGELOG.md` ≪ 320 KB; no entry exceeds the 400-char threshold; advisory script reports **0 offenders**.
- [ ] Every migration number, review/spec basename, module name, and date present in the old changelog is still grep-findable in the new one (spot-check a sample across June/May/April).
- [ ] `CURRENT_STATUS.md` "this week" window reflects 2026-06-19; no stale April label; all structured sections retained.
- [ ] `scripts/ci/check-changelog-entry-length.sh` exits 0 and prints a clean summary; CI step is non-failing.
- [ ] CLAUDE.md step 4.2 + changelog "How to append" carry the 1-line rule.
- [ ] No code/TS/build surface touched (docs + one advisory shell script only).

## Non-goals

- Re-laying-out the docs system (April-17 layout stays).
- Touching module docs, specs, or plans (only the two index files + guardrail).
- The Zoho `.xls` cleanup (separate task).
- A build-failing changelog gate (Vivek chose advisory-only).
