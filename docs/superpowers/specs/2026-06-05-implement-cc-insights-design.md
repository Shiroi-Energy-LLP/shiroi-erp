# Implement Claude Code Insights Recommendations — Design

**Date:** 2026-06-05
**Author:** Vivek + Claude
**Source:** Claude Code usage report 2026-04-18 → 2026-06-03 (198 messages, 26 sessions)

---

## Goal

Encode the report's actionable recommendations into the harness, project docs, and persistent memory so the friction patterns it surfaced — silent sub-agent failures, skipped CI before push, chasing already-fixed errors, false-positive diagnostics — stop recurring.

## Scope (6 deliverables)

1. **Hook:** `PostToolUse` on `Edit|Write` → `pnpm check-types`. Literal report suggestion. User opted in despite the 15-30s monorepo cost.
2. **Master ref §4.17:** Add `Working-style patterns from CC insights` section with full rationale for the 4 new patterns (sub-agent verify, reproduce-before-fix, cross-verify diagnostics, chunk-on-token-limits).
3. **CLAUDE.md:** Add NEVER DO #22 (verify sub-agent file persistence) + a small `Recurring Patterns` subsection cross-referencing master ref §4.17.
4. **Memory:** 3 new `feedback_*.md` files + index them in `MEMORY.md`.
5. **GitHub MCP:** `claude mcp add github -- npx -y @modelcontextprotocol/server-github`. Document that `GITHUB_PERSONAL_ACCESS_TOKEN` env var is required.
6. **Changelog + push.**

## Out of scope

- `/ship` custom skill — `verification-before-completion` + `finishing-a-development-branch` superpowers skills already exist.
- "Horizon" items (overnight pipelines, autonomous root-cause bot, self-healing CI enforcer) — those are emergent patterns, not separately installable.
- Re-encoding rules already in CLAUDE.md (CI-before-push, regen types after schema change, docs+changelog) — they're already there; the issue is following them, not documenting them again.

## Deliverable details

### 1. Hook config

Edit `~/.claude/settings.json` to append:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      { "type": "command", "command": "cd C:/Users/vivek/Projects/shiroi-erp && pnpm check-types", "async": false }
    ]
  }
]
```

Constraints:
- Must NOT remove the existing `SessionStart` superpowers hook.
- Hook command sets cwd to the ERP repo so the right `package.json` is found.
- `async: false` so I see the result before continuing. If it's intolerably slow in practice, Vivek can switch to a `Stop` hook or move to PreToolUse on `git push` later.

### 2. Master ref §4.17 (new section)

Add a `§4.17 Working-style patterns from CC insights (June 5, 2026)` section to `docs/SHIROI_MASTER_REFERENCE.md`, placed after §4.16 (`/ask`) and before the §5 Database section.

Content covers four sub-rules with rationale:

- **§4.17.1 Verify sub-agent file persistence.** Sub-agents have repeatedly reported edits and migrations as applied while silently failing to persist. Always run `git status` and `Read` the target file before treating sub-agent work as done. Reason: 26-session report flagged this as a top friction.
- **§4.17.2 Reproduce reported errors from clean state.** Before fixing a "fix these type errors" ticket, run `git status` + `pnpm check-types` from the current state first. Multiple sessions revealed the errors were already fixed in uncommitted diffs.
- **§4.17.3 Cross-verify diagnostics.** Connectivity/flaky-state diagnostics (Test-NetConnection, time-sensitive tests, n8n status flags) can give false positives. Confirm with a second independent method (raw TCP, a real run, an out-of-band probe) before drawing conclusions. The DigitalOcean port-test false positive in May is the canonical example.
- **§4.17.4 Chunk long autonomous work.** Output-token-limit errors wiped multiple sessions. Multi-wave overnight builds must checkpoint after each phase — confirm files persisted, CI green, deploy responding — before starting the next phase.

### 3. CLAUDE.md updates

**Add NEVER DO #22** under the existing 21-rule list:

> 22. Never trust a sub-agent's "done" report — verify the change actually landed locally (`git status` + read the file) before continuing. (Master ref §4.17.1.) Reason: multiple sessions silently failed when sub-agents reported edits/migrations as applied but didn't persist.

**Add a `RECURRING PATTERNS` subsection** between WORKFLOW and "Regenerating database.ts". Keep terse (3 bullets, no expansion):

> ## RECURRING PATTERNS (full rationale in master reference §4.17)
>
> - **Reproduce before fixing.** Before fixing a "reported" type/build error, reproduce it from a clean state (`git status`, fresh `pnpm check-types`). Several sessions wasted effort fixing errors that were already resolved in uncommitted diffs. (§4.17.2)
> - **Cross-verify diagnostics.** When testing connectivity, flaky behavior, or external service state, confirm with two independent methods (e.g., raw TCP + the high-level tool). (§4.17.3)
> - **Chunk long autonomous work.** Multi-wave overnight builds should checkpoint after each phase — confirm files persisted, CI green, deploy responding — before starting the next. (§4.17.4)

### 4. Memory files

Three new files in `C:\Users\vivek\.claude\projects\C--Users-vivek-Projects-shiroi-erp\memory\`:

| File | Slug | One-liner |
|------|------|-----------|
| `feedback_subagent_verify.md` | `feedback-subagent-verify` | Verify sub-agent file persistence with `git status` / Read before trusting "done" reports |
| `feedback_verify_before_fix.md` | `feedback-verify-before-fix` | Reproduce a reported error from clean state before editing — many "errors" turn out already fixed |
| `feedback_cross_verify_diagnostics.md` | `feedback-cross-verify-diagnostics` | Cross-check connectivity/flaky-behavior diagnostics with a second independent method before drawing conclusions |

Each follows the feedback memory body structure (rule → **Why:** → **How to apply:**). Then 3 lines added to `MEMORY.md` index.

### 5. GitHub MCP

```powershell
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

The official server requires `GITHUB_PERSONAL_ACCESS_TOKEN` env var. Document this in the spec but don't set it here — Vivek will mint the PAT separately. Test with `claude mcp list` after add.

### 6. Changelog + push

Add one line to `docs/CHANGELOG.md`:

> 2026-06-05 — chore: implement CC insights recommendations (hook + CLAUDE.md NEVER-DO #22 + Recurring Patterns + 3 feedback memories + GitHub MCP)

Then run the 4 CI gates locally per CLAUDE.md WORKFLOW §4.i, commit, push.

## Self-review

- **Placeholders:** Resolved — master ref §4.17 will be added in this same commit, so CLAUDE.md cross-references stay live.
- **Internal consistency:** Hook command targets a hardcoded Windows path (`C:/Users/vivek/Projects/shiroi-erp`). This is fine because the user-level `settings.json` is already Vivek-specific (the existing SessionStart hook also has hardcoded paths). Confirmed.
- **Scope:** Single coherent commit. Fits one plan.
- **Ambiguity:** The hook will trigger on ALL Edit|Write calls, including .md docs and JSON. Reading the user's choice literally — they picked the report's exact suggestion knowing the tradeoff. If they want me to filter to only `.ts`/`.tsx`, that's a follow-up.

## Risks

- **Hook performance:** `pnpm check-types` on this Turborepo takes 15-30s. Will slow every edit. Documented tradeoff; user accepted.
- **Hook on the wrong cwd:** If Claude is editing files outside this repo, `pnpm check-types` will fail confusingly. Acceptable — Vivek can refine the hook command after seeing real behavior.
- **GitHub MCP without PAT:** `claude mcp add` will succeed, but the MCP will fail at use time without `GITHUB_PERSONAL_ACCESS_TOKEN`. Documented.
