# Credential Leak Remediation — 2026-06-06

**Trigger:** GitGuardian alerts (Company Email Password / Generic Password / Username Password) on
`Shiroi-Energy-LLP/shiroi-erp`, pushed 2026-06-05 23:44:56 UTC.

**Severity:** High — real customer + internal credentials committed in plaintext to a remote repo.

---

## Root cause

The 2026-06-05 push (commit `a573304`, "feat(om): historical plants import + plant-credentials
encryption") added `scripts/count-plant-credentials.ts`, a one-off analysis script that **inlined
Vivek's entire credential dump** — 186 rows of real solar-portal credentials:

- Project name · brand · **username (often a customer or `@shiroienergy.com` email)** · **plaintext
  password** · portal URL · created date.

The irony: the *same commit* shipped migration 158, which encrypts these very credentials at rest in
the database. The DB was protected; the analysis script leaked them in cleartext.

The repo already had the correct convention — secret inputs live in gitignored files
(`scripts/data/growatt-credentials-*.tsv`, `fimer-credentials-*.tsv`, the XLSX masters) and only
secret-free derived outputs are committed. This script simply didn't follow it.

## Secondary exposures found during the sweep

Pre-existing (committed 2026-05-24, not in the flagged push but still real secrets):

| File | Secret | Fix |
|------|--------|-----|
| `scripts/fix-vinodh-account.ts` | hardcoded `Shiroi2026!tmp` | → `process.env.VINODH_TEMP_PASSWORD` |
| `scripts/migrate-google-drive.ts` | hardcoded `Migration2026!Temp` | → `process.env.MIGRATION_USER_PASSWORD` ?? random UUID |
| `packages/inverter-adapters/src/growatt.test.ts` | real customer creds `Block - C` / `Fl0ur1sh@2026` | → fake `test-account` / `TestPass@2026` (MD5 assertion recomputed) |
| `scripts/data/fimer-plants-2026-06-05.json` | 11 `(user / password)` labels | passwords stripped from labels |
| `scripts/data/migration-scan-cache.json` | 41 `"password"` values (8 unique real) | values blanked, structure kept |
| `docs/superpowers/plans/2026-05-23-inverter-integration-v1.md` | `manivel@shiroienergy.com / shiro@2025` | password redacted |

Not changed (intentional dummies / non-secrets): `scripts/import-plant-monitoring-credentials.fixtures.ts`
and the anonymized fixture block in the inverter-integration plan use `@example.com` + generic
`Solar123`-style values; `scripts/create-shravan-account.ts` already generates a random temp password.

## What was done on this branch (`claude/exposed-credentials-shiroi-erp-FTUAP`)

1. **`count-plant-credentials.ts`** — replaced the 186-row inline array with a `loadRaw()` that reads
   tab-separated rows from gitignored `scripts/data/plant-credentials-dump.tsv` at runtime, erroring
   clearly if the file is absent. Classifier/report logic unchanged.
2. The five secondary fixes in the table above.
3. **`.gitignore`** — added `scripts/data/plant-credentials-dump.tsv` + `...-dump-*.tsv`.
4. **CI prevention** — `scripts/ci/check-forbidden-patterns.sh` gains rule `RSEC`: any quoted
   `password|passwd|pwd` literal in `scripts/**/*.ts` (excluding `*.test.ts` / `*.fixtures.ts`, and
   `process.env` / random-generation patterns) is a new violation that fails CI. Regression-tested
   (catches a planted secret, passes on the clean tree).

**Local gates:** `check-types` 5/5, `lint` 2/2, `check-forbidden-patterns` clean (baseline 64),
`vitest` 75/75. `pnpm build` fails only because `next/font` cannot reach Google Fonts under the
sandbox network policy — no `apps/` files were touched, so this is environmental.

## ⚠️ Still required — owner: Vivek (out of scope for an automated branch)

A working-tree edit removes the secrets from *future* commits. It does **not** undo the leak:

1. **Rotate every exposed credential.** Treat all 186 customer portal passwords + the two internal
   temp passwords (`Shiroi2026!tmp`, `Migration2026!Temp`) and any reused variants as compromised.
   They were public/scanned and are recoverable from git history regardless of this cleanup.
   Prioritise `@shiroienergy.com` master accounts (`manivel@shiroienergy.com` Sungrow/SolarMan, the
   Growatt master) since those unlock many plants.
2. **Purge git history.** The plaintext rows persist in commit `a573304` (and the May-24 commits).
   Use `git filter-repo` (or BFG) to strip the affected paths/blobs, force-push, and have every clone
   re-clone. This rewrites shared history — do it deliberately, coordinated with anyone holding a clone.
   *(Not performed automatically: force-pushing rewritten history is destructive and `main` is
   protected per CLAUDE.md.)*
3. **Resolve in GitGuardian** once history is purged so it stops re-flagging, and confirm no secret
   survives (`git log -p -S '<a known leaked password>'` should return nothing).

## Prevention going forward

- Credential dumps are gitignored TSV/XLSX inputs only; scripts load them at runtime.
- The `RSEC` CI rule blocks quoted password literals in `scripts/`.
- Consider enabling GitHub push protection / secret scanning on the repo as a second line.
