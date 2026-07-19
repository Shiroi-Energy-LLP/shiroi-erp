# `data/` — legacy / local-only import data (gitignored)

This directory is **gitignored** (see the `/data/*` rule in `.gitignore`). Only this
README is tracked, as a breadcrumb.

## Why it exists

On **2026-07-01** the `docs/Zoho data/` folder — ~37 MB of one-time Zoho Books
`.xls` exports — was moved here and untracked as part of the repo token-optimization
pass (`docs/superpowers/specs/2026-07-01-token-optimization-restructure-design.md`).

Those binaries carry **no agent-context value** (Claude can't read `.xls`) but were
bloating the `docs/` tree, `find`/`Glob`/Explore results, and every fresh clone.

## What's here (local disk only, not committed)

- `zoho-import/` — the original Zoho Books exports (Invoice, Bill, Journal,
  Customer_Payment, Expense, Purchase_Order, Contacts, …). Source material for the
  finance-v2 / zoho-orphan-triage historical imports (see those specs/plans).

## Need it again?

Re-export from **Zoho Books** (the authoritative source of record for the auditor),
or recover from git history prior to the 2026-07-01 move. It is intentionally not
tracked — do not re-add large binary dumps to the repo.
