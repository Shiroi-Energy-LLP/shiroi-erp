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
| Full spec for a completed/in-flight feature | `docs/superpowers/specs/` |
| Implementation plan for a feature in flight | `docs/superpowers/plans/` |
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

**Shiroi Energy Private Limited** — solar EPC, Chennai, Tamil Nadu. Rooftop solar (residential, commercial, industrial). ~50 employees, 500+ projects completed.

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

## ENVIRONMENT VARIABLES (names only — values in `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL              (dev: actqtzoxjilqnldnacqz.supabase.co)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (sb_publishable_...)
SUPABASE_SECRET_KEY                   (sb_secret_...)
PROD_SUPABASE_URL                     (prod: kfkydkwycgijvexqiysc.supabase.co)
PROD_SUPABASE_PUBLISHABLE_KEY
PROD_SUPABASE_SECRET_KEY
ANTHROPIC_API_KEY
PVWATTS_API_KEY
PVLIB_MICROSERVICE_URL
N8N_WEBHOOK_SECRET
NEXT_PUBLIC_SENTRY_DSN + SENTRY_DSN + SENTRY_ORG + SENTRY_PROJECT
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

## NEVER DO (20 rules — rationale in master reference §4.11)

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

---

## WORKFLOW

1. Claude writes code → Vivek reviews → `git add` / `git commit` / `git push`.
2. SQL migrations: paste into Supabase SQL Editor (**dev first, then prod**) → save as numbered `.sql` in `supabase/migrations/` → regenerate `packages/types/database.ts`.
3. After completing a task:
   - Append one line to `docs/CHANGELOG.md`.
   - Update `docs/CURRENT_STATUS.md` if in-flight work changed.
   - Update the relevant `docs/modules/<module>.md` if the module gained a capability, a new table, or a significant decision.
   - **Do not grow CLAUDE.md.** If something feels like it belongs here, it probably belongs in the master reference or a module doc.

---

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
