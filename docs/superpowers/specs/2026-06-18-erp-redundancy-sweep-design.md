# ERP-wide Redundancy Sweep — Design

> Date: 2026-06-18 · Status: approved, executing · Owner: Vivek (review-before-commit)
> Trigger: founder observed "old things still there, new ones overlaid" — `project_id` vs `projectId`, `CreateTask` vs `CreateQuickTask`, and two duplicate index pairs already caught by mig 187. Question: *"Do we have a lot of these? We need code sanity."*

---

## 1. Problem

The schema and codebase are append-only by habit: migrations are numbered and never rewritten, and new features add columns / indexes / helpers without retiring the ones they supersede. [Migration 172](../../../supabase/migrations/172_2026-06-09-leads-projects-project-name.sql) is the proof case — it ran `CREATE INDEX IF NOT EXISTS idx_leads_company_id` while `idx_leads_company` already existed on the same column from mig 016, silently creating a duplicate. [Migration 187](../../../supabase/migrations/187_2026-06-18-drop-redundant-indexes.sql) cleaned up four such index objects on `leads`/`projects`. The open question is **how widespread the pattern is** across the whole ERP, and — for anything that *looks* redundant but isn't — **a documented reason it exists.**

## 2. Goals

- A single, authoritative pass over the entire ERP (DB schema + application code + UI) that finds redundant / duplicated entries.
- Every finding classified into exactly one of three buckets, each with evidence.
- Provably-safe schema redundancy dropped via one dev-only migration.
- A quantified answer to "do we have a lot of these things?"

## 3. Non-goals

- **No prod changes.** Dev only; prod cutover is deferred (project: dev-only, no prod).
- **No auto-merge of code/UI duplicates.** Those carry behaviour risk → reported and flagged, never edited in this pass.
- **No broad refactor.** We document and drop redundancy; we do not restyle or re-architect.
- **Not a dead-code hunt.** Unused-but-unique code is out of scope unless it is *duplicated*.

## 4. Methodology — hunt by dimension, across the whole tree

Redundancy is cross-cutting, so we scan by *dimension* (not by module — a per-module split is blind to the same helper written twice in two modules).

### 4a. Schema layer — live dev-DB introspection (ground truth, not grep)

Migrations are append-only and use `IF NOT EXISTS`, so grepping them over-counts (idempotent re-creates) and under-counts (later drops). The only reliable source is the live dev catalog (`actqtzoxjilqnldnacqz`).

| # | Dimension | Detection |
|---|---|---|
| 1 | **Duplicate indexes** — identical table + key + opclass + predicate, different name | `pg_index` grouped by normalized key, `HAVING count(*) > 1` |
| 2 | **Shadowed indexes** — plain index whose key is a left-prefix of a UNIQUE/PK index on the same table | compare key arrays against unique/primary indexes |
| 3 | **Overlapping columns** — two columns, one concept (old kept after rename) | column inventory + code cross-reference → **flag only** |
| 4 | **Redundant RPCs / dead function overloads** — stale signatures, near-identical bodies | `pg_proc` grouped by name; diff bodies |
| 5 | **Duplicate triggers / FKs / constraints** — two objects, same effect | `pg_trigger` / `pg_constraint` grouped by table+definition |
| 6 | **Unused indexes** — `idx_scan = 0` | `pg_stat_user_indexes` → **flag only** (dev usage ≠ prod) |

### 4b. Application + UI layer — parallel read-only agents

| # | Dimension | Scope |
|---|---|---|
| 7 | Duplicate / overlapping **server actions** & **query helpers** (incl. `CreateTask` vs `CreateQuickTask`) | `apps/erp/src/lib/**` |
| 8 | Duplicate **utils / constants / types / enums** (NEVER-DO #21 violations) | `apps/erp/src/lib/**`, `packages/**` |
| 9 | Duplicate **React components / forms** | `apps/erp/src/components/**`, `app/**`, `packages/ui/**` |
| 10 | **snake/camel dual-field** — an object/type carrying *both* `x_id` and `xId` | whole tree (expected: none) |

## 5. Classification rubric — every finding gets exactly one tag

- **REDUNDANT → DROP** — provably zero loss of coverage or behaviour. *(duplicate indexes, shadowed indexes, dead overloads)* → goes into the migration.
- **INTENTIONAL → KEEP + reason** — looks redundant, isn't; the reason is recorded inline. *(e.g. `company_id` = customer-org FK, not multi-tenancy; a partial index with a distinct `WHERE`; a denormalised column kept for read perf)* → this is the "be very clear why" requirement.
- **NEEDS-DECISION → FLAG** — genuine overlap, but acting carries behaviour risk; founder's call. *(overlapping columns, duplicate actions, duplicate components)* → reported, not touched.

## 6. Deliverables

1. **Report** → `docs/reviews/2026-06-18-erp-redundancy-sweep.md` — findings by dimension; each with tag + reason + evidence (`file:line` / object name); a summary count table answering "how much is there".
2. **Migration** → `supabase/migrations/188_2026-06-18-drop-duplicate-schema-objects.sql` — drops **only** the REDUNDANT→DROP schema objects; `DROP INDEX IF EXISTS` style; header notes "Applied to DEV <date>. Prod: deferred." Index drops do not alter `database.ts` (types reflect tables/columns/functions, not indexes) → **no type-regen churn**, unless a dead RPC overload is dropped, in which case types are regenerated in the same commit.

## 7. Guardrails

- Dev only · auto-drop limited to provably-safe schema objects · code/UI dups reported only.
- Concurrent sessions share this working tree → commit **only files this task creates/edits** via explicit pathspec; never `git add -A`.
- End-of-task: CI gates → docs (CHANGELOG + CURRENT_STATUS + module docs as needed) → commit → push to remote main.

## 8. Execution plan

1. Introspect dev catalog for dimensions 1–6 (owner: main session).
2. Three parallel read-only agents for dimensions 7–10.
3. Synthesize + classify; cross-reference schema columns ↔ code for overlapping-column candidates (dim 3).
4. Write report; write migration with the safe drops; apply to dev; verify coverage unchanged.
5. CI gates → update docs → commit own files → push to main.
