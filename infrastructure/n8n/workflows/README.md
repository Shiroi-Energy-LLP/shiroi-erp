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
3. **Supabase credential (for digests):** create an `httpHeaderAuth` credential named `Supabase service role` with header `apikey: {sb_secret_*}`. Used by all Tier 1 cron + Tier 2 digest workflows to fetch view data.
4. **WhatsApp Business Cloud API credential:** create a credential named `WhatsApp (Shiroi)` with type **`whatsAppApi`** (n8n's whatsApp node binds to this type — `whatsAppBusinessAccountApi` does not exist as a credential type). Paste your System User permanent access token (`EAAV…`). All WhatsApp Send nodes reference this credential by name; the push script resolves the placeholder at import time.
   - Business Account ID: 1366524581909221
   - Phone Number ID: 1140448799143790 (registered: +91-9444998787)
   - Credential schema: `{ accessToken, businessAccountId }` — store BOTH values in the credential.

## Current state (2026-05-01)

**Deployment status:** 19 of 20 workflows pushed to `n8n.shiroienergy.com` and **active**. End-to-end tested 2026-05-01 (Meta Cloud API → workflow → Vivek's WhatsApp landed in 2 sec).

> ⚠️ **DigitalOcean has externally blocked ports 80/443/8080** on the droplet (in response to a Netcraft alert despite our abuse response). The droplet itself is healthy, n8n + Caddy are up. Until DO restores the ports, **management traffic** goes through SSH tunnel:
>
> ```
> ssh -N -L 5679:172.18.0.2:5678 root@68.183.91.111
> ```
>
> Then point the push script and any API tooling at `http://localhost:5679`. Active webhook workflows (router, sentry forwarder) are unreachable from the public internet until ports are restored — they remain internally callable for development.

### Router + error handler

| File | Status | Activated? |
|------|--------|------------|
| `00-event-bus-router.json` | Active — 16 event routes wired | ✅ Yes |
| `55-global-error-handler.json` | Pushed; needs Gmail OAuth credential | ❌ No |

### Tier 1 — webhook handoffs (ERP event → router → sub-workflow)

All Tier 1 sub-workflows are **active** as of 2026-05-01. Send nodes use the canonical n8n `whatsApp` node (typeVersion 1.1) with the `WhatsApp (Shiroi)` credential.

| File | ERP event | Wired in ERP? | Send node | Co-founder cc |
|------|-----------|---------------|-----------|---------------|
| `01-bug-report.json` | `bug_report.submitted` | Yes | Vivek | ✅ Vinodh |
| `02-lead-created.json` | `lead.created` | Yes | Sales head | — |
| `04-proposal-requested.json` | `proposal.requested` | Yes | Design head | — |
| `05-proposal-submitted.json` | `proposal.submitted` | Yes | Sales head | — |
| `06-proposal-approved.json` | `proposal.approved` | Yes | PM + Finance head | — |
| `07-purchase-order-approved.json` | `purchase_order.approved` | Yes | Purchase head | — |
| `09-grn-recorded.json` | `grn.recorded` | ⏳ Pending createGRN action | Purchase head | — |
| `10-installation-scheduled.json` | `project.installation_scheduled` | Yes | Projects head | — |
| `11-installation-complete.json` | `project.installation_complete` | Yes | Projects head | — |
| `12-ceig-approval-received.json` | `ceig_approval.received` | Yes | Liaison head | — |
| `13-project-commissioned.json` | `project.commissioned` | Yes | Projects head | — |
| `14-customer-payment-received.json` | `customer_payment.received` | Yes | Sales head + Finance head | — |
| `15-om-ticket-created.json` | `om_ticket.created` | Yes | O&M head | — |
| `16-expense-submitted.json` | `expense_claim.submitted` | Yes | Finance head | — |
| `17-leave-request-submitted.json` | `leave_request.submitted` | ⏳ Pending leave-request action | HR head | — |
| `18-employee-created.json` | `employee.created` | Yes | HR head | — |

### Tier 1 — cron handoffs (Supabase view → per-item WhatsApp)

| File | Source view (migration) | Schedule | Send node | Activated? |
|------|-------------------------|----------|-----------|-----------|
| `03-lead-stale-24h.json` | `v_digest_leads_stale_24h` (083) | Daily 9:00 IST | Sales head | ❌ (waiting for Sales head phone — assigned, can be activated) |
| `08-vendor-payment-due.json` | `v_digest_vendor_payments_due_7d` (085) | Daily 9:00 IST | Finance head always + Vivek + Vinodh (cc if >₹5L) | ❌ (waiting for Finance head phone) |

### Tier 2 — daily digests (cron → Supabase view → morning summary)

| File | Source view (migration) | Schedule | To | Activated? |
|------|-------------------------|----------|-----|-----------|
| `19-vivek-daily-7am.json` | `v_digest_leads_new_24h` (083) | Daily 7:00 IST | Vivek + Vinodh | ✅ |
| `20-sales-head-daily-8am.json` | `v_digest_leads_stale_24h` (083) | Daily 8:00 IST | Sales head | ❌ (phone assigned, can activate) |
| `21-design-head-daily-8am.json` | `v_digest_proposals_design_backlog` (085) | Daily 8:00 IST | Design head | ❌ (phone assigned, can activate) |
| `22-projects-head-daily-8am.json` | `v_digest_milestones_overdue` (085) | Daily 8:00 IST | Projects head | ❌ (phone assigned, can activate) |
| `23-purchase-head-daily-8am.json` | `v_digest_pos_pending_approval` (085) | Daily 8:00 IST | Purchase head | ❌ (phone assigned, can activate) |
| `24-finance-head-daily-8am.json` | `v_digest_invoices_overdue_15d` (083) | Daily 8:00 IST | Finance head | ❌ (no phone yet) |
| `25-om-head-daily-8am.json` | `v_digest_om_tickets_open_48h` (085) | Daily 8:00 IST | O&M head | ❌ (no phone yet) |
| `26-liaison-head-daily-8am.json` | ⏳ Placeholder — no view yet | Daily 8:00 IST | Liaison head | ❌ (no phone yet) |
| `27-hr-head-daily-8am.json` | `v_digest_leave_pending` (085) | Daily 8:00 IST | HR head | ❌ (no phone yet) |
| `28-vivek-weekly-monday-8am.json` | ⏳ Placeholder — no weekly rollups yet | Monday 8:00 IST | Vivek + Vinodh | ❌ (template approval pending) |

Each digest has the same 4-node shape: `scheduleTrigger → httpRequest (Supabase REST) → Set (compose) → WhatsApp Send Message`. Placeholder workflows (`26`, `28`) drop the HTTP step, compose a documentation-style stub noting which views are missing, but still route to WhatsApp Send.

### Tier 6 — meta / infra

| File | Trigger | Purpose | Activated? |
|------|---------|---------|-----------|
| `55-global-error-handler.json` | `errorTrigger` | Any workflow error → Gmail Vivek (see above) | ❌ (Gmail OAuth needed) |
| `56-droplet-health.json` (renamed `56 — Droplet heartbeat`) | Cron daily 9 AM IST | Sends "n8n heartbeat — alive" WhatsApp to Vivek + Vinodh. Original 15-min CPU/RAM/disk check used `executeCommand` which n8n removed for security in current version. For metric thresholds, use DO's built-in monitoring (Droplets → shiroi-erp → Insights → Alerts) — free, integrated. | ❌ (active when Meta template approved) |
| `57-n8n-backup.json` | Cron daily 2:00 IST | tar ~/.n8n → Supabase Storage `n8n-backups/YYYY-MM-DD.tar.gz` with sha256 | ❌ (Supabase bucket `n8n-backups` not yet created) |
| `58-sentry-forwarder.json` | Webhook `/webhook/sentry-alert` | Sentry POSTs P0/P1 via WhatsApp to Vivek + Vinodh; lower severities logged + dropped | ❌ (Sentry alert rule not yet pointed at this webhook) |

Pre-reqs for Tier 6:
- **56:** Now a daily heartbeat workflow (no shell access needed). For threshold-based metrics monitoring, configure DigitalOcean's built-in monitoring instead — it's free, integrated, and emails you when CPU/RAM/disk exceed your threshold.
- **57:** Create a private Supabase Storage bucket named `n8n-backups` (Supabase dashboard → Storage → New bucket). Restore procedure: download the latest `.tar.gz`, verify `sha256sum`, `tar xzf` into a fresh `~/.n8n` volume, restart the container.
- **58:** In Sentry, configure an Alert Rule → Send notification via webhook → `https://n8n.shiroienergy.com/webhook/sentry-alert`, with a custom header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`. Set the alert rule to fatal/error level only; the Switch double-filters in case of misconfiguration.

### Still unbuilt

- Tier 3 monitoring (`29`–`37`)
- Tier 4 customer-facing (`38`–`49`)
- Tier 5 reports (`50`–`54`)
- Tier 6 #59 training microlearning

Build order per `docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md#build-order-recommended`.

### Env vars on the n8n droplet (`/opt/shiroi-automation/.env`)

Loaded into the n8n container via `env_file: - .env` in `docker-compose.yml`. As of 2026-05-01:

| Var | Status | Used by |
|-----|--------|---------|
| `N8N_ENCRYPTION_KEY` | ✅ set | n8n itself (encrypts credential storage) |
| `N8N_WEBHOOK_SECRET` | ✅ set (matched by `x-webhook-secret` credential) | Router #00, Sentry forwarder #58 |
| `SUPABASE_PROJECT_ID` | ✅ set (`kfkydkwycgijvexqiysc` prod) | Tier 1 cron #03, #08; Tier 2 digests `19–28` |
| `SUPABASE_SECRET_KEY` | ✅ set (`sb_secret_*` from prod) | Same — used as `apikey` header |
| `VIVEK_WHATSAPP` | ✅ `+919444414087` | `01`, `08`, `19`, `28`, `56`, `58` (founder) |
| `VINODH_WHATSAPP` | ✅ `+919444052787` | Same as VIVEK — co-founder cc |
| `SALES_HEAD_WHATSAPP` | ✅ `+919444060787` | `02`, `03`, `05`, `14`, `20` |
| `DESIGN_HEAD_WHATSAPP` | ✅ `+919704514879` | `04`, `21` |
| `PROJECTS_HEAD_WHATSAPP` | ✅ `+919486801859` | `10`, `11`, `13`, `22` |
| `PURCHASE_HEAD_WHATSAPP` | ✅ `+919698685985` | `07`, `09`, `23` |
| `FINANCE_HEAD_WHATSAPP` | ❌ empty (no role assigned yet) | `06`, `08`, `14`, `16`, `24` |
| `OM_HEAD_WHATSAPP` | ❌ empty | `15`, `25` |
| `LIAISON_HEAD_WHATSAPP` | ❌ empty | `12`, `26` |
| `HR_HEAD_WHATSAPP` | ❌ empty | `17`, `18`, `27` |

To update vars, SSH in (`ssh root@68.183.91.111`), edit `/opt/shiroi-automation/.env`, then `docker compose restart n8n`.

### Credentials in n8n (resolved at push time by name+type)

| Credential | Type | Purpose | Status |
|------------|------|---------|--------|
| `WhatsApp (Shiroi)` | `whatsAppApi` | All 22 WhatsApp Send nodes | ✅ Created (2026-05-01) |
| `x-webhook-secret` | `httpHeaderAuth` | Router auth + Sentry forwarder auth | ✅ Created (2026-05-01) |
| `Supabase service role` | `httpHeaderAuth` (`apikey: sb_secret_*`) | Tier 1 cron + Tier 2 digests fetch view rows | ✅ Created (2026-05-01) |
| `Gmail (Vivek)` | `gmailOAuth2` | Error handler #55 emails Vivek on workflow failure | ❌ Not yet (manual OAuth flow) |

## The legacy standalone bug-report webhook

The original bug-report workflow tested on 2026-04-19 used its own webhook URL (`N8N_BUG_REPORT_WEBHOOK_URL`). ERP's `notifyBugReport` now fires through the event bus router (`bug_report.submitted` → `01 — Bug report`) whenever `N8N_EVENT_BUS_URL` is set, and only falls back to the legacy URL when it isn't. The standalone workflow can be retired once the router is activated in n8n — until then, leave `N8N_BUG_REPORT_WEBHOOK_URL` set as a safety net for local dev.
