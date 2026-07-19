# Shiroi Energy ERP — Claude Code Startup Brief

> Always loaded. Keep minimal. Everything else is linked below.
> Restructured April 17, 2026. If you're tempted to add a feature-completion row or a daily log paragraph here, stop — that belongs in `docs/CHANGELOG.md` or a module doc.

---

## WHERE TO FIND THINGS

**Read this table first.** It decides how much you load for this chat.

| I need... | File |
|-----------|------|
| What's being worked on this week / migration dev↔prod state | `docs/CURRENT_STATUS.md` |
| Business rules, roles, DB spine, cross-cutting gotchas (CEIG/IR/MSME/sum-to-100%), full coding standards | `docs/SHIROI_MASTER_REFERENCE.md` |
| Details on a specific module: workflow, screens, tables, key files, past decisions | `docs/modules/<module>.md` (sales, design, projects, purchase, finance, om, liaison, hr, inventory, contacts) |
| When did we ship X / which migration was X in | `docs/CHANGELOG.md` (grep by date or keyword) |
| **Which** spec/plan/review covers X (1-line-per-doc router — read THIS before opening a heavy doc) | `docs/INDEX.md` (regen: `node scripts/build-docs-index.mjs`) |
| Full spec for a completed/in-flight feature | `docs/superpowers/specs/` (find it via `docs/INDEX.md` first) |
| Implementation plan for a feature in flight | `docs/superpowers/plans/` (find it via `docs/INDEX.md` first) |
| Legacy one-time import data (Zoho `.xls`, etc.) | `data/` (gitignored — not in the docs tree, not context) |
| Design system, colours, typography, brand | `docs/design/design-system.md` + `docs/design/brand-guide.html` |
| DB schema source of truth | `supabase/migrations/` (numbered, append-only) |
| Generated TS types from schema | `packages/types/database.ts` — **never edit by hand** |
| Historical CLAUDE.md / master ref / Ai Studio screens | `docs/archive/` |

**Load pattern:**
- **Small fix or question** → CLAUDE.md is enough.
- **Feature in an existing module** → + `CURRENT_STATUS.md` + `SHIROI_MASTER_REFERENCE.md` + `modules/<module>.md`.
- **New module / big refactor** → all of the above + relevant `superpowers/specs/` and `superpowers/plans/`.

---

## IDENTITY

**Shiroi Energy LLP** — solar EPC, Chennai, Tamil Nadu. Rooftop solar (residential, commercial, industrial). ~50 employees, 500+ projects completed.

This ERP is **single-tenant, built for Shiroi only**. No `company_id` on any table. Ever.

**Founder:** Vivek. He reviews every file before commit. **No autonomous pushes to production.**

---

## TECH STACK (locked — no debate)

| Layer | Choice |
|-------|--------|
| ERP web | Next.js 14 + TypeScript, App Router |
| Mobile (future) | React Native + Expo SDK 51+ |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (employees: email+password; customers: phone OTP) |
| File storage | Supabase Storage — DB holds path strings only |
| Backend logic | Supabase Edge Functions (Deno/TypeScript) |
| Offline sync | WatermelonDB (mobile only) |
| Automation | n8n self-hosted (spare laptop, port 5678) |
| ERP hosting | Vercel (`erp.shiroienergy.com`) |
| UI | shadcn/ui + Radix + Tailwind (via `packages/ui`) |
| Simulation | NREL PVWatts API → PVLib microservice fallback (port 5001) |
| AI narrative | Claude API, `claude-sonnet-4-20250514` |
| Money | `decimal.js` client · `NUMERIC(14,2)` in SQL — never native floats |
| PDF | `@react-pdf/renderer` (listed in `serverComponentsExternalPackages`) |
| Monitoring | Sentry (`@sentry/nextjs` v10) |

---

## REPO STRUCTURE

```
shiroi-erp/                          ← pnpm workspace, Turborepo
├── apps/
│   ├── erp/                         ← Next.js 14 ERP web app
│   │   └── src/{app,components,lib}/
│   └── mobile/                      ← React Native + Expo (empty, built later)
├── packages/
│   ├── types/                       ← database.ts — generated, never edit
│   ├── supabase/                    ← client factory (browser, server, admin, middleware)
│   ├── ui/                          ← design system components
│   ├── inverter-adapters/           ← per-brand normalized inverter API clients
│   ├── eslint-config/
│   └── typescript-config/
├── supabase/
│   ├── migrations/                  ← numbered SQL files, source of truth
│   └── functions/                   ← Edge Functions
├── scripts/                         ← data migration, imports, CI checks
├── docs/                            ← see "WHERE TO FIND THINGS"
├── .env.local                       ← gitignored, never committed
├── CLAUDE.md                        ← this file
└── turbo.json
```

---

## ENVIRONMENT VARIABLES (names only — values in `.env.local`, never committed)

> Names grouped below for quick reference. **Full annotated catalog** (what each does, FIMER account map, PAT usage) lives in `docs/SHIROI_MASTER_REFERENCE.md` §3 → "Env var name list" — load it only when wiring an integration.

```
Supabase   NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY · SUPABASE_SECRET_KEY
           PROD_SUPABASE_URL · PROD_SUPABASE_PUBLISHABLE_KEY · PROD_SUPABASE_SECRET_KEY · SUPABASE_ACCESS_TOKEN (mgmt PAT)
AI         ANTHROPIC_API_KEY · AI_PROVIDER · AI_MODEL · AI_MAX_TOKENS · OPENROUTER_API_KEY
n8n        N8N_WEBHOOK_SECRET · N8N_EVENT_BUS_URL · N8N_BUG_REPORT_WEBHOOK_URL · N8N_API_KEY
Sim        PVWATTS_API_KEY · PVLIB_MICROSERVICE_URL
Sentry     NEXT_PUBLIC_SENTRY_DSN · SENTRY_DSN · SENTRY_ORG · SENTRY_PROJECT
e-invoice  SHIROI_GSTIN · SHIROI_ADDRESS_LINE1 · SHIROI_CITY · SHIROI_STATE_CODE · SHIROI_PINCODE · SHIROI_ACCOUNTS_EMAIL
Misc       NEXT_PUBLIC_ERP_URL
FIMER      FIMER_CRED_{SHIROIENERGY,CHEMFABALKALIS,HARSHA,BOSSSHYAM,SIDDHARTH,EDISONSCHOOL,SRIRAMSV}  (per-account JSON blobs)
```

**Key format:** new Supabase only. `sb_publishable_` replaces legacy `anon`. `sb_secret_` replaces legacy `service_role`. Never use legacy names.

---

## CODING STANDARDS (non-negotiable — full details in `docs/SHIROI_MASTER_REFERENCE.md` §4)

- **Error handling:** `const op = '[functionName]';` at the top; log with `op` prefix; include `{ ...context, error, timestamp }` on failure.
- **Supabase queries:** handle `error` and null `data` separately; never merge the checks.
- **Money:** `decimal.js` on the client, `NUMERIC(14,2)` in SQL. Never native floats.
- **Indian formatting:** `formatINR(amt)` → `₹1,23,456` · `shortINR(amt)` → `₹1.2Cr` / `₹5.0L` / `₹50K`.
- **Dates:** store UTC, display IST (`Asia/Kolkata`). Date-only fields as `'YYYY-MM-DD'` TEXT.
- **UUIDs:** client-generated via `crypto.randomUUID()` (enables offline record creation on mobile).
- **Supabase clients:** always via `@repo/supabase/{client,server,admin,middleware}` factory.
- **Row types:** `type X = Database['public']['Tables']['x']['Row']` — **no `as any`.** If the type is wrong, regenerate `database.ts`.
- **Server actions:** return `ActionResult<T>` from `apps/erp/src/lib/types/actions`. **Never throw across the RSC boundary.**
- **File separation:** reads in `*-queries.ts`, mutations in `*-actions.ts` (`'use server'`). **Never call Supabase inline from a page or component.**
- **Financial aggregation:** SQL RPCs. **Never `.reduce()` over monetary rows in JavaScript.**
- **Time-series:** declarative partitioning (`PARTITION BY RANGE`) + pg_cron + rollup tables. Frontend queries rollups, never raw readings.
- **Indexes:** any new filterable/sortable/joined column gets an index in the same migration.
- **Sensitive fields** (never in logs): `bank_account_number`, `aadhar_number`, `pan_number`, `gross_monthly`, `basic_salary`, `ctc_monthly`, `ctc_annual`, `net_take_home`, `commission_amount`, `pf_employee`.

---

## NEVER DO (25 rules — rationale in master reference §4.8 + §4.12–4.19)

1. Never hardcode env variables, API keys, or Supabase project IDs.
2. Never commit `.env.local`.
3. Never use TypeScript `any` — always type from `packages/types/database.ts`.
4. Never bypass RLS with the secret key except for explicitly labelled admin/system ops.
5. Never use floats for money — `decimal.js` or `NUMERIC(14,2)`.
6. Never edit `packages/types/database.ts` by hand.
7. Never store files in the database — Storage for files, DB holds path strings only.
8. Never write SQL directly in a React component or page.
9. Never push directly to main (once branching is set up).
10. Never run untested migrations on prod — dev first, verify, then prod.
11. Never use `as any` / `: any` in a Supabase query. Regenerate types instead.
12. Never aggregate money in JavaScript — use a SQL RPC.
13. Never use `count: 'exact'` on tables >1,000 rows — use `count: 'estimated'`.
14. Never write a form component larger than 500 LOC.
15. Never make an inline Supabase call from a `page.tsx` or a component.
16. Never store time-series data in a regular table — declarative partitioning from day 1.
17. Never add a filterable/sortable column without also adding its index in the same migration.
18. Never queue background work (>5s, polling, retries) inside a Next.js server action.
19. Never throw from a server action — return `ActionResult<T>`.
20. Never ship schema changes without regenerating types in the same commit.
21. Never import runtime values from `-queries.ts` files in a `'use client'` component — `import type` only. Extract shared constants (label maps, enum orders, weight maps) to `<domain>-constants.ts` with no server imports. The queries file re-exports from there. `pnpm check-types` does NOT catch the boundary violation; only `pnpm build` does. (Master ref §4.13.)
22. Never cache authenticated identity/role outside a **request-scoped React `cache()`**. No `unstable_cache`, module scope, or any cross-request store for `auth.getUser()`/profile/role — it bleeds one user's session into another. Server actions always re-resolve identity server-side; never trust a client-passed `role`/`userId`. (Master ref §4.17.)
23. Never ship a user-facing text search as leading-wildcard `col ILIKE '%term%'` without a `pg_trgm` GIN index on the searched column — it forces a sequential scan. (Master ref §4.18 sibling; NEVER-DO #17 extension.)
24. Never perform a DB write (INSERT/UPDATE/DELETE) during a server-component / page render. Writes belong in explicit actions triggered by user intent — a GET that mutates isn't idempotent (prefetch + concurrent renders double-fire). (Master ref §4.17 sibling.)
25. Never use a bare `.limit(N)` on a list that can exceed N rows without pagination (`count: 'estimated'` + `.range()`) — it silently hides rows. (Master ref §4.18 sibling.)

---

## WORKFLOW

1. Claude writes code → Vivek reviews → `git add` / `git commit` / `git push`.
2. SQL migrations: paste into Supabase SQL Editor (**dev first, then prod**) → save as numbered `.sql` in `supabase/migrations/` → regenerate `packages/types/database.ts` (see "Regenerating database.ts" below).
3. **Schema lookup before query writing.** Before writing `.from('table').select('col_a, col_b')` or `.eq('col', x)`, confirm each table and column exists in `supabase/migrations/` or `packages/types/database.ts`. Speculative column names cost a debug cycle (NEVER-DO #20 inverse; master ref §4.14).
4. **End-of-task sequence — strict order, no skipping, no reordering:**
   1. **Run all four CI gates locally first.** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build` (the exact set `.github/workflows/ci.yml` runs). `pnpm build` was added 2026-05-24 because three Vercel deploys failed in a row — check-types alone misses Next.js client/server boundary violations. **Read the actual stdout of each command** — background-task notifications can report `exit code 0` even when the real exit is non-zero (master ref §4.15). Grep the tail for `error TS`, `Failed:`, `ELIFECYCLE`, or `Build failed`. If anything fails, fix it locally — never push a red branch.
   2. **Update docs only after all gates are green.** Append **one line** to `docs/CHANGELOG.md` (hard cap ~400 chars — if the change needs a paragraph, write `docs/reviews/<date>-<topic>.md` or the spec and link the basename; never inline prose. The advisory `scripts/ci/check-changelog-entry-length.sh` warns on over-long entries but never fails the build); update `docs/CURRENT_STATUS.md` if in-flight work changed; update the relevant `docs/modules/<module>.md` if the module gained a capability, a new table, or a significant decision. Multi-area reviews go in `docs/reviews/YYYY-MM-DD-<topic>.md` (not inline in the changelog). If you **added or renamed** a spec/plan/review, run `pnpm docs:index` so `docs/INDEX.md` (the one-line-per-doc router) stays current. **Do not grow CLAUDE.md** — if something feels like it belongs here, it probably belongs in the master reference or a module doc. Large binary/import dumps go in gitignored `data/`, never in `docs/`.
   3. **Push to main, and always push to the git remote — not just commit locally.** `git add` → `git commit` → `git push origin main`. A local commit that hasn't reached the remote isn't done.

---

## Regenerating `packages/types/database.ts`

**Preferred (since 2026-06-08): the Management API + the `SUPABASE_ACCESS_TOKEN` PAT — no Dashboard, no MCP.** `.env.local` holds a full-scope PAT (`shiroi-erp-mgmt`). `GET https://api.supabase.com/v1/projects/<ref>/types/typescript` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` returns `200` + the same `{"types":"..."}` wrapper the MCP returns (confirmed 2026-06-08). One-liner that writes it straight to the file, then run the strip step + check-types:

```bash
node -e "require('dotenv').config({path:'.env.local'}); fetch('https://api.supabase.com/v1/projects/actqtzoxjilqnldnacqz/types/typescript',{headers:{Authorization:'Bearer '+(process.env.SUPABASE_ACCESS_TOKEN||'').trim()}}).then(r=>r.json()).then(o=>require('fs').writeFileSync('packages/types/database.ts',o.types))"
node scripts/strip-view-fk-entries.mjs && pnpm check-types
```

**The old 403 was the stale `supabase login` CLI token (it lacked org privileges), NOT a hard account limit** — the PAT has the privileges. (Don't capture the token via shell `$(...)` — the dotenvx banner pollutes it and the CLI then rejects the format; read `process.env.SUPABASE_ACCESS_TOKEN` inside node, as above.)

**MCP fallback** (still works if the PAT is ever unavailable):

The flow:

1. Use the MCP tool `mcp__<supabase>__generate_typescript_types` against the dev project id (`actqtzoxjilqnldnacqz`). Its response is JSON-wrapped (`{"types": "..."}`) and is large enough that it lands in the tool-results file rather than the conversation. The path is reported in the error message.
2. Extract the `types` field and write to `packages/types/database.ts`. One-liner that works for the JSON wrapper:
   ```bash
   node -e "const fs=require('fs'); const obj=JSON.parse(fs.readFileSync('packages/types/database.ts','utf8')); fs.writeFileSync('packages/types/database.ts', obj.types);"
   ```
   (Easier if you copy the tool-results file to `packages/types/database.ts` first.)
3. Run `node scripts/strip-view-fk-entries.mjs` — required. The generator emits FK-target entries for every view that exposes a candidate column, which blows the type past `tsc`'s recursion limit. The script trims that down by ~60%.
4. `pnpm check-types` — must pass before the regen is considered done. If a column rename or constraint change broke a query, fix it in the same commit (NEVER-DO #20).

If you ever see "Type instantiation excessively deep" (TS2589) after a regen, you forgot the strip step.

(Historical: the "CLI 403 / account-permissions" framing applied to the old `supabase login` token. The `shiroi-erp-mgmt` PAT resolves it for Management-API ops — secrets, type-gen, deploys — so prefer the PAT method above.)

## HOW TO WORK IN THIS REPO

| Situation | Read before acting |
|-----------|-------------------|
| Small fix / question / quick answer | This file only. |
| Bug fix in a known area | This file + `docs/modules/<module>.md`. |
| Feature in an existing module | + `docs/CURRENT_STATUS.md` + `docs/SHIROI_MASTER_REFERENCE.md` + `docs/modules/<module>.md`. |
| New module | All of the above + every existing module doc for patterns + brainstorm a spec first. |
| SQL work | Relevant migration file + master reference §5 (database). |
| "When did we ship X" | `docs/CHANGELOG.md`. |

---

*Maintained by Vivek. Structural change: April 17, 2026 — docs reorganization (see `docs/superpowers/specs/2026-04-17-docs-restructure-design.md`).*
