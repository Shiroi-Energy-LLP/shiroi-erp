# Repo Structure — Token-Optimization Restructure — Design Spec

**Date:** 2026-07-01
**Author:** Claude (with Vivek)
**Status:** ✅ Implemented (docs-layer changes only; no code/TS/build surface touched)
**Module:** cross-cutting / docs + repo hygiene

---

## Problem

An agent working this repo pays a token cost in three ways, and the repo's weight
was concentrated in exactly the places that cost the most:

1. **The always-on tax.** `CLAUDE.md` is loaded into *every* session. It had grown to
   ~18 KB (~4.5 K tokens), of which ~2.5 KB was an annotated env-var catalog (every
   FIMER account, N8N webhook nuance, the `SUPABASE_ACCESS_TOKEN` essay) needed only
   when wiring an integration — paid on every unrelated chat.
2. **Blind opens of heavy on-demand docs.** `docs/superpowers/plans/` (2.16 MB / 44
   files, up to **145 KB each**) and `docs/superpowers/specs/` (762 KB / 48 files).
   To discover *which* doc answers a question, an agent would open several 50–145 KB
   files — tens of thousands of tokens to find one filename.
3. **Search/tree noise.** `docs/Zoho data/` held **37 MB** of legacy `.xls` exports
   *inside* `docs/`. Claude can't read `.xls`, so it carried zero context value, but it
   dominated the docs tree, `find`/`Glob`/Explore output, and every fresh clone.
   `docs/archive/` (773 KB) is likewise never meant to be auto-loaded but surfaces in
   greps.

Measured before (docs tree): **~45 MB**; `CLAUDE.md`: **18,132 bytes**.

## Constraints (inherited from prior docs work — respected here)

- **Zero information loss.** Nothing is destroyed; content is *moved*, not deleted.
- **Founder's layout is sound.** The April-17 layout (CLAUDE.md → CURRENT_STATUS →
  master ref → modules → changelog → specs/plans → archive) stays. This is additive
  hygiene, not a re-layout — consistent with the 2026-04-17 restructure and the
  2026-06-19 lean-reset, both of which explicitly kept the layout.
- **No autonomous prod / Vivek reviews every file.** Docs + one generator script + a
  data relocation only. **No code, TS, migration, or build surface touched.**
- **No new blocking CI gate** (matches the 2026-06-19 advisory-only guardrail choice).

## Design

### A — Slim the always-on `CLAUDE.md`

- The annotated env-var catalog moves into `docs/SHIROI_MASTER_REFERENCE.md` §3
  ("Env var name list"), which is loaded **on demand** and already deferred to CLAUDE.md
  for the names. CLAUDE.md keeps a **compact names-only list grouped by system**
  (Supabase / AI / n8n / Sim / Sentry / e-invoice / FIMER) + a one-line pointer.
- Result: `CLAUDE.md` **18,132 → 16,492 bytes** (~9% off the per-session tax) with no
  loss — the full annotations are one hop away when actually needed.

### B — `docs/INDEX.md` — a token-cheap router

- New generator `scripts/build-docs-index.mjs` (run: `pnpm docs:index`) walks
  `specs/`, `plans/`, `reviews/` and emits **one grep-able line per file**: date,
  title (first H1), module/status (from the `**Module:**`/`**Status:**`/`**Goal:**`
  lines the repo already uses), and the basename.
- **~18 KB indexes all 140 heavy docs.** An agent reads `docs/INDEX.md` (one line each)
  to pick the right file instead of opening several 50–145 KB files to discover
  content. Added as the first "find a spec/plan" row in CLAUDE.md's WHERE-TO-FIND table.
- Deterministic + idempotent — re-run after adding/renaming a doc. No hand-editing.

### C — Evict non-context binaries from the tree

- `docs/Zoho data/` (37 MB `.xls`) → `data/zoho-import/`, **untracked** (`git rm
  --cached`) and gitignored via `/data/*` (with `!/data/README.md` kept as a tracked
  breadcrumb). Files remain on local disk; re-exportable from Zoho Books (the auditor's
  source of record) if ever needed.
- `docs/` tree: **~45 MB → 7.6 MB.** `find`/`Glob`/Explore over `docs/` no longer wade
  through 37 MB of binaries.

## What was considered and deferred

- **Per-file TL;DR headers on the mega plans/specs.** Rejected for now: `INDEX.md`
  already solves "know what's inside without opening," and injecting headers into ~90
  founder-reviewed files is a large, low-marginal-value change surface. Revisit only if
  a specific hot doc keeps getting opened in full.
- **Quarantining `docs/archive/` from git tooling.** It's already never auto-loaded;
  ripgrep respects `.gitignore` but archive is intentionally tracked. Left as-is; the
  INDEX deliberately excludes it so it doesn't compete with live docs.
- **Re-laying-out `apps/` and `packages/` code.** Out of scope (Vivek's call) — moving
  workspace code breaks imports across the monorepo for no context-token win (code is
  only loaded when read).
- **Rewriting `.xls` history out of the git pack.** History rewrite is disruptive and
  separate; the tree/clone/search win is captured by the untrack + gitignore above.

## Files touched

- `CLAUDE.md` — env block slimmed to grouped names + pointer; INDEX + `data/` rows added.
- `docs/SHIROI_MASTER_REFERENCE.md` §3 — now holds the authoritative annotated catalog.
- `scripts/build-docs-index.mjs` — **new** generator.
- `docs/INDEX.md` — **new** generated router.
- `package.json` — `docs:index` script.
- `.gitignore` — `/data/*` (+ `!/data/README.md`).
- `data/README.md` — **new** breadcrumb; `docs/Zoho data/` → `data/zoho-import/` (untracked).

## Success criteria

- [x] `CLAUDE.md` smaller, every env var still discoverable (names in CLAUDE.md, full
      annotations in master-ref §3). Zero loss.
- [x] `docs/INDEX.md` lists all 140 specs/plans/reviews, one line each; regenerable via
      `pnpm docs:index`.
- [x] `docs/` tree ≪ its former size (45 MB → 7.6 MB); Zoho `.xls` untracked + gitignored,
      breadcrumb committed.
- [x] No code/TS/migration/build surface touched; existing CI gates unaffected.

## Going-forward rule (one line for CLAUDE.md workflow)

> Added a spec/plan/review? Run `pnpm docs:index` so `docs/INDEX.md` stays the router.
> Large binary/import dumps go in gitignored `data/`, never in `docs/`.
