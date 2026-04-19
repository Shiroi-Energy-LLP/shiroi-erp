# n8n workflow library

Canonical JSON exports for every automation workflow in Shiroi ERP. One file per workflow. These are the source of truth — `n8n.shiroienergy.com`'s database is derived from them.

## Naming

`NN-kebab-name.json` where `NN` is the workflow number from [`docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md`](../../../docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md).

| Prefix | Tier | Trigger |
|--------|------|---------|
| `00` | 6 — meta | Router — single ingress from ERP |
| `01`–`18` | 1 — handoffs | ERP event via router |
| `19`–`28` | 2 — digests | Cron |
| `29`–`37` | 3 — monitoring | Cron / external ingest |
| `38`–`49` | 4 — customer-facing | ERP event / cron |
| `50`–`54` | 5 — reports | Cron |
| `55`–`59` | 6 — meta/infra | Error trigger / cron |

## Editing flow

1. Edit JSON in this repo (preferred) OR edit live in `https://n8n.shiroienergy.com`.
2. If edited live: **Download** the workflow (workflow menu → Download) and overwrite the JSON here.
3. If edited in the repo: run `pnpm tsx scripts/push-n8n-workflows.ts` to upload via the n8n REST API.
4. Commit the JSON change with a short message. The JSON file is the source of truth — never diverge.

The workflow exports contain placeholder strings (`REPLACE_WITH_*_CRED_ID`, `REPLACE_WITH_*_WORKFLOW_ID`) for credentials and sub-workflow references. These are resolved during push — see `scripts/push-n8n-workflows.ts`.

## Activate state

All exports ship with `"active": false`. Activation is a deliberate UI step, not a repo state. Do not flip `active: true` in JSON — it's meaningless at import time anyway (n8n ignores it for imports via API).

## Tags

Every workflow has at least `{"name": "erp"}` + a tier tag (`tier-1`, `tier-2`, …). Tier 6 meta workflows additionally carry `{"name": "meta"}`. Tags appear in the n8n sidebar and make the catalog visually searchable.

## Error handling

Every workflow's `settings.errorWorkflow` points to `55 — Global Error Handler`. That handler's ID is resolved at push time. It catches uncaught errors in any workflow and emails Vivek (WhatsApp later).

## Manual steps after first import

1. **Header Auth credential:** create an n8n credential named `x-webhook-secret` with the value of `N8N_WEBHOOK_SECRET` from `.env.local`. The router webhook references this by name at import; n8n resolves it to an ID.
2. **Gmail OAuth credential:** create an `n8n-nodes-base.gmailOAuth2` credential named `Gmail (Vivek)` using the Google Cloud OAuth client from `docs/CURRENT_STATUS.md`. Referenced by name in the error handler.
3. **Supabase credential (for digests):** add `sb_secret_*` value as header auth or use HTTP Request → Supabase REST pattern. Will be used by Tier 2 workflows when they land.
4. **WhatsApp credential:** will be added after WABA creation. Placeholder until then.

## Current state (2026-04-19)

| File | Status | Activated? |
|------|--------|------------|
| `00-event-bus-router.json` | Ready to import | No |
| `55-global-error-handler.json` | Ready to import | No |
| `02-lead-created.json` | Template stub — WhatsApp branch disabled | No |
| `06-proposal-approved.json` | Template stub — WhatsApp branch disabled | No |
| `13-project-commissioned.json` | Template stub — WhatsApp branch disabled | No |
| `16-expense-submitted.json` | Template stub — WhatsApp branch disabled | No |

All other numbers from the catalog are still unbuilt. Build order per `docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md#build-order-recommended`.

## The existing standalone bug-report workflow

The original bug-report workflow tested on 2026-04-19 uses its own webhook URL (`N8N_BUG_REPORT_WEBHOOK_URL`). Keep it running as-is. The event bus router also has a `bug_report.submitted` route that we'll flip to once `notifyBugReport` is migrated to `emitErpEvent('bug_report.submitted', …)`.
