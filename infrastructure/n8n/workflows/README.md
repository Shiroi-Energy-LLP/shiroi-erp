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
4. **WhatsApp Business Cloud API credential:** create a credential named `WhatsApp (Shiroi)` with type `whatsAppBusinessAccountApi`. Paste your System User permanent access token (EAAVob8gwerQBRd5...). All 18 WhatsApp workflows reference this credential by name; n8n resolves it at import time.
   - Business Account ID: 1366524581909221
   - Phone Number ID: 1140448799143790 (registered: +91-9444998787)

## Current state (2026-04-20)

### Router + error handler

| File | Status | Activated? |
|------|--------|------------|
| `00-event-bus-router.json` | Ready to import — 16 event routes wired | No |
| `55-global-error-handler.json` | Ready to import | No |

### Tier 1 — webhook handoffs (ERP event → router → sub-workflow)

| File | ERP event | Wired in ERP? | Send node |
|------|-----------|---------------|-----------|
| `01-bug-report.json` | `bug_report.submitted` | Yes | WhatsApp Send (Vivek) |
| `02-lead-created.json` | `lead.created` | Yes | WhatsApp Send (assignee phone) |
| `04-proposal-requested.json` | `proposal.requested` | Yes | WhatsApp Send (Design head) |
| `05-proposal-submitted.json` | `proposal.submitted` | Yes | WhatsApp Send (Sales person) |
| `06-proposal-approved.json` | `proposal.approved` | Yes | WhatsApp Send × 2 (PM + Finance) |
| `07-purchase-order-approved.json` | `purchase_order.approved` | Yes | WhatsApp Send (PO preparer) |
| `09-grn-recorded.json` | `grn.recorded` | ⏳ Pending createGRN action | Simulated |
| `10-installation-scheduled.json` | `project.installation_scheduled` | Yes | Simulated |
| `11-installation-complete.json` | `project.installation_complete` | Yes | Simulated |
| `12-ceig-approval-received.json` | `ceig_approval.received` | Yes | Simulated |
| `13-project-commissioned.json` | `project.commissioned` | Yes | Simulated |
| `14-customer-payment-received.json` | `customer_payment.received` | Yes | WhatsApp Send (sales person) |
| `15-om-ticket-created.json` | `om_ticket.created` | Yes | Simulated |
| `16-expense-submitted.json` | `expense_claim.submitted` | Yes | Simulated |
| `17-leave-request-submitted.json` | `leave_request.submitted` | ⏳ Pending leave-request action | Simulated |
| `18-employee-created.json` | `employee.created` | Yes | Simulated |

### Tier 1 — cron handoffs (Supabase view → per-item WhatsApp)

| File | Source view (migration) | Schedule | Send node |
|------|-------------------------|----------|-----------|
| `03-lead-stale-24h.json` | `v_digest_leads_stale_24h` (083) | Daily 9:00 IST | Simulated |
| `08-vendor-payment-due.json` | `v_digest_vendor_payments_due_7d` (085) | Daily 9:00 IST | WhatsApp Send × 2 (Finance always, Vivek if >₹5L) |

### Tier 2 — daily digests (cron → Supabase view → morning summary)

| File | Source view (migration) | Schedule | To |
|------|-------------------------|----------|-----|
| `19-vivek-daily-7am.json` | `v_digest_leads_new_24h` (083) | Daily 7:00 IST | Vivek |
| `20-sales-head-daily-8am.json` | `v_digest_leads_stale_24h` (083) | Daily 8:00 IST | Sales head |
| `21-design-head-daily-8am.json` | `v_digest_proposals_design_backlog` (085) | Daily 8:00 IST | Design head |
| `22-projects-head-daily-8am.json` | `v_digest_milestones_overdue` (085) | Daily 8:00 IST | Projects head |
| `23-purchase-head-daily-8am.json` | `v_digest_pos_pending_approval` (085) | Daily 8:00 IST | Purchase head |
| `24-finance-head-daily-8am.json` | `v_digest_invoices_overdue_15d` (083) | Daily 8:00 IST | Finance head |
| `25-om-head-daily-8am.json` | `v_digest_om_tickets_open_48h` (085) | Daily 8:00 IST | O&M head |
| `26-liaison-head-daily-8am.json` | ⏳ Placeholder — no view yet | Daily 8:00 IST | Liaison head |
| `27-hr-head-daily-8am.json` | `v_digest_leave_pending` (085) | Daily 8:00 IST | HR head |
| `28-vivek-weekly-monday-8am.json` | ⏳ Placeholder — no weekly rollups yet | Monday 8:00 IST | Vivek |

Each digest has the same 4-node shape: `scheduleTrigger → httpRequest (Supabase REST) → Set (compose) → WhatsApp Send Message`. Placeholder workflows (`26`, `28`) drop the HTTP step, compose a documentation-style stub noting which views are missing, but still route to WhatsApp Send.

### Tier 6 — meta / infra

| File | Trigger | Purpose |
|------|---------|---------|
| `55-global-error-handler.json` | `errorTrigger` | Any workflow error → Gmail Vivek (see above) |
| `56-droplet-health.json` | Cron every 15 min | Shell exec CPU/RAM/disk on n8n host; WhatsApp Vivek when any ≥ 85% |
| `57-n8n-backup.json` | Cron daily 2:00 IST | tar ~/.n8n → Supabase Storage `n8n-backups/YYYY-MM-DD.tar.gz` with sha256 |
| `58-sentry-forwarder.json` | Webhook `/webhook/sentry-alert` | Sentry POSTs P0/P1 via WhatsApp to Vivek; lower severities logged + dropped |

Pre-reqs for Tier 6:
- **56:** Execute Command node requires `N8N_SECURE_MODE=false` or the container running as a user with shell access. The cloud-init stack already runs `docker-compose` with the default n8n image (shell available inside the container).
- **57:** Create a private Supabase Storage bucket named `n8n-backups` (Supabase dashboard → Storage → New bucket). Restore procedure: download the latest `.tar.gz`, verify `sha256sum`, `tar xzf` into a fresh `~/.n8n` volume, restart the container.
- **58:** In Sentry, configure an Alert Rule → Send notification via webhook → `https://n8n.shiroienergy.com/webhook/sentry-alert`, with a custom header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`. Set the alert rule to fatal/error level only; the Switch double-filters in case of misconfiguration.

### Still unbuilt

- Tier 3 monitoring (`29`–`37`)
- Tier 4 customer-facing (`38`–`49`)
- Tier 5 reports (`50`–`54`)
- Tier 6 #59 training microlearning

Build order per `docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md#build-order-recommended`.

### New env vars required on n8n droplet

Already needed: `N8N_WEBHOOK_SECRET` (matched by `x-webhook-secret` Header Auth credential).

Added April 20, 2026 for cron workflows (Tier 1 crons + all Tier 2 digests):
- `SUPABASE_PROJECT_ID` — e.g. `kfkydkwycgijvexqiysc` (prod) / `actqtzoxjilqnldnacqz` (dev)
- `SUPABASE_SECRET_KEY` — `sb_secret_*` value, used as `apikey` header
- `VIVEK_WHATSAPP` — E.164 phone (used by `08`, `19`, `28`)
- `FINANCE_HEAD_WHATSAPP` — E.164 phone (used by `08`, `24`)
- `SALES_HEAD_WHATSAPP` — E.164 phone (used by `20`)
- `DESIGN_HEAD_WHATSAPP` — E.164 phone (used by `21`)
- `PROJECTS_HEAD_WHATSAPP` — E.164 phone (used by `22`)
- `PURCHASE_HEAD_WHATSAPP` — E.164 phone (used by `23`)
- `OM_HEAD_WHATSAPP` — E.164 phone (used by `25`)
- `LIAISON_HEAD_WHATSAPP` — E.164 phone (used by `26`)
- `HR_HEAD_WHATSAPP` — E.164 phone (used by `27`)

Credentials to create:
- `Supabase service role` as type `httpHeaderAuth`, header `apikey: {sb_secret_*}`. Push script resolves `REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID`.
- `WhatsApp (Shiroi)` as type `whatsAppBusinessAccountApi` with System User permanent access token. Push script resolves `REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID`. All 18 WhatsApp send nodes reference this by name.

## The legacy standalone bug-report webhook

The original bug-report workflow tested on 2026-04-19 used its own webhook URL (`N8N_BUG_REPORT_WEBHOOK_URL`). ERP's `notifyBugReport` now fires through the event bus router (`bug_report.submitted` → `01 — Bug report`) whenever `N8N_EVENT_BUS_URL` is set, and only falls back to the legacy URL when it isn't. The standalone workflow can be retired once the router is activated in n8n — until then, leave `N8N_BUG_REPORT_WEBHOOK_URL` set as a safety net for local dev.
