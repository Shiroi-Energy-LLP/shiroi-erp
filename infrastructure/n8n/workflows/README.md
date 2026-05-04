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

## Current state (2026-05-02 night)

**Deployment status:** **32 of 34 workflows ACTIVE.** All 47 WhatsApp Send nodes flipped from text mode to template mode using the approved Meta `erp_alert` template (2 vars). Multi-line `message` strings flattened to title (line 1) + bullet-separated body for Meta compliance. End-to-end validated: webhook → router → Tier 1 sub-workflow → both founder phones in <2 sec. Still inactive: `57 — n8n nightly backup` (needs Supabase Storage bucket `n8n-backups`) and `58 — Sentry P0/P1 forwarder` (needs Sentry alert rule pointed at the webhook).

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
| `55-global-error-handler.json` | `errorTrigger` | Any workflow error → Gmail Vivek (see above) | ✅ Active (Gmail OAuth completed 2026-05-02) |
| `56-droplet-health.json` (renamed `56 — Droplet heartbeat`) | Cron daily 9 AM IST | Sends "n8n heartbeat — alive" WhatsApp to Vivek + Vinodh. Original 15-min CPU/RAM/disk check used `executeCommand` which n8n removed for security in current version. For metric thresholds, use DO's built-in monitoring (Droplets → shiroi-erp → Insights → Alerts) — free, integrated. | ❌ (active when Meta template approved) |
| `57-n8n-backup.json` | (retired) | Original `executeCommand`-based backup didn't work (n8n removed that node). **Replaced by host-side cron** at `infrastructure/n8n/backup/n8n-backup.{sh,cron}` — installed at `/opt/shiroi-automation/n8n-backup.sh` + `/etc/cron.d/n8n-backup`. Tars the n8n Docker volume directly, computes sha256, uploads to Supabase Storage via curl using `apikey: <sb_secret_*>` (NOT `Authorization: Bearer` — new sb_secret keys aren't JWTs and Storage rejects them with "Invalid Compact JWS"). Daily 02:00 IST (= 20:30 UTC cron). Bucket: `n8n-backups` on DEV project. | ✅ Active — first run 2026-05-02 17:22 UTC succeeded, 1.17 MB tar.gz uploaded |
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

Loaded into the n8n container via `env_file: - .env` in `docker-compose.yml`. As of 2026-05-02:

| Var | Status | Used by |
|-----|--------|---------|
| `N8N_ENCRYPTION_KEY` | ✅ set | n8n itself (encrypts credential storage) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | ✅ `false` (added 2026-05-02) | Without this, `$env.X` in workflow expressions throws `ExpressionError: access to env vars denied`. Default in n8n 1.x is to block; we need access for every cron + digest workflow. |
| `N8N_WEBHOOK_SECRET` | ✅ set (matched by `x-webhook-secret` credential) | Router #00, Sentry forwarder #58 |
| `SUPABASE_PROJECT_ID` | ✅ set (`kfkydkwycgijvexqiysc` prod) | Tier 1 cron #03, #08; Tier 2 digests `19–28` |
| `SUPABASE_SECRET_KEY` | ✅ set (`sb_secret_*` from prod) | Same — used as `apikey` header |
| `VIVEK_WHATSAPP` | ✅ `+919444414087` | `01`, `08`, `19`, `28`, `56`, `58` (founder) |
| `VINODH_WHATSAPP` | ✅ `+919444065787` | Same as VIVEK — co-founder cc |
| `SRIDHAR_WHATSAPP` | ✅ `+919444052787` (Chairman) | Report-tier only: `19` daily, `28` weekly, `08` vendor-payment-due |
| `SALES_HEAD_WHATSAPP` | ✅ `+919444060787` (Prem) | `02`, `03`, `05`, `14`, `20` |
| `DESIGN_HEAD_WHATSAPP` | ✅ `+919704514879` | `04`, `21` |
| `PROJECTS_HEAD_WHATSAPP` | ✅ `+919486801859` | `10`, `11`, `13`, `22` |
| `PURCHASE_HEAD_WHATSAPP` | ✅ `+919698685985` | `07`, `09`, `23` |
| `LIAISON_HEAD_WHATSAPP` | ✅ `+919444060787` (= Sales head — same person) | `12`, `26` |
| `FINANCE_HEAD_WHATSAPP` | ✅ `+919444414087` (= Vivek — until Finance head is hired) | `06`, `08`, `14`, `16`, `24` |
| `OM_HEAD_WHATSAPP` | ✅ `+919444414087` (= Vivek — until O&M head is hired) | `15`, `25` |
| `HR_HEAD_WHATSAPP` | ✅ `+919444414087` (= Vivek — until HR head is hired) | `17`, `18`, `27` |

**Routing strategy for unassigned heads (per Vivek 2026-05-02):** Finance/OM/HR all route to Vivek for now AND a parallel "Send WhatsApp to Vinodh" node was added to each digest workflow (`24`, `25`, `27`) and to `08` Vendor payment due so co-founder Vinodh sees every founder-routed message. When real Finance/O&M/HR heads are hired, just update the corresponding `*_HEAD_WHATSAPP` env var on the droplet — workflows will route to the new person, and the Vinodh parallel node continues to cc him.

**Chairman (Sridhar) report fan-out (added 2026-05-02 evening):** Sridhar gets WhatsApp reports but won't log into the ERP. Added as a parallel "Send WhatsApp to Sridhar" / "Send to Sridhar (always)" node on the **report-tier** workflows only — `19` Vivek daily 7AM, `28` Vivek weekly Monday 8AM, `08` Vendor payment due (financial report). Operational alerts (`01` bug-report, `56` droplet-heartbeat, `58` Sentry) are NOT sent to him. Pattern via `scripts/add-sridhar-chairman-fanout.ts`.

**Important: when updating any phone env var on the droplet, you MUST `docker compose up -d --force-recreate n8n` — a plain `docker compose restart n8n` does NOT reload `env_file`.**

**Equally important: rotating a credential's stored secret (e.g., Supabase key, Meta token) requires DELETE + CREATE via the n8n REST API — there's no UPDATE endpoint.** Once recreated with a new ID, all workflows that reference the old ID need to be re-pushed (push script's resolver looks up by name+type and substitutes the new ID). Otherwise the workflows continue using the old (stale/wrong) credential value cached at credential-creation time. Caught the hard way on 2026-05-04 morning when digests all returned `Authorization failed` — the Supabase credential was created with the PROD key on 2026-05-01, env var switched to DEV on 2026-05-02, but the credential held the original PROD key until deleted+recreated.

**And: changing `settings.timezone` on an already-active cron workflow is NOT enough — n8n caches the cron schedule at activation time.** Deactivate → reactivate is required for the schedule to re-register with the new TZ. Caught on 2026-05-04 morning when crons fired in UTC despite the workflow's `settings.timezone: "Asia/Kolkata"`. Verified the hard way 2026-05-02: a wrong-Vinodh-number was fixed via sed in `.env` + `restart`, but the container kept the old value cached and kept sending to the wrong number until force-recreate. Inspect with `docker exec shiroi-automation-n8n-1 env | grep VINODH` to confirm.

To update vars, SSH in (`ssh root@68.183.91.111`), edit `/opt/shiroi-automation/.env`, then `docker compose restart n8n`.

### Credentials in n8n (resolved at push time by name+type)

| Credential | Type | Purpose | Status |
|------------|------|---------|--------|
| `WhatsApp (Shiroi)` | `whatsAppApi` | All 22 WhatsApp Send nodes | ✅ Created (2026-05-01) |
| `x-webhook-secret` | `httpHeaderAuth` | Router auth + Sentry forwarder auth | ✅ Created (2026-05-01) |
| `Supabase service role` | `httpHeaderAuth` (`apikey: sb_secret_*`) | Tier 1 cron + Tier 2 digests fetch view rows | ✅ Created (2026-05-01) |
| `Gmail (Vivek)` | `gmailOAuth2` | Error handler #55 emails Vivek on workflow failure | ✅ Created (2026-05-02) — Google Cloud project `shiroi-n8n`, OAuth client `n8n Shiroi`, scope `gmail.send`. See "Gmail OAuth via SSH tunnel" section below for the workaround used to complete OAuth while DO ports were blocked. |

## Three runtime gotchas (caught + fixed 2026-05-02)

### 0. Meta forbids newlines/tabs/4+ spaces in template parameter VALUES

The Meta `erp_alert` template body itself uses literal `\n\n` between `{{1}}` and `{{2}}` — that's fine. But the values you SUBSTITUTE for `{{1}}` and `{{2}}` cannot contain `\n`, `\t`, or 4+ consecutive spaces. Hitting any of those returns Meta error code `132018`: "Param text cannot have new-line/tab characters or more than 4 consecutive spaces".

Our existing `message` fields are multi-line ERP-formatted text. The `flip-n8n-whatsapp-to-template.ts` script handles the flatten:

```js
// {{1}} = first line only
$json.message.split('\n')[0]

// {{2}} = remaining lines, filtered empty, joined with bullet separator
$json.message.split('\n').slice(1).filter(l => l.trim()).join(' · ') || ' '
```

When designing future workflow message strings, **don't bury the most important info past line 1** — the headline goes into `{{1}}`, everything else into `{{2}}` collapsed to a single line. Keep `{{2}}` informative but flat.



### 1. `$env.X` access is blocked by default in n8n 1.x

n8n's `N8N_BLOCK_ENV_ACCESS_IN_NODE` defaults to `true` in current versions, which throws `ExpressionError: access to env vars denied` whenever a workflow expression like `={{ $env.SUPABASE_PROJECT_ID }}` runs. Every cron + digest workflow in this repo uses `$env.X` (for Supabase config, recipient phone numbers, etc.), so this would silently break the entire cron tier on first scheduled run.

**Fix already applied:** `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is set in the n8n service env block on the droplet (`/opt/shiroi-automation/docker-compose.yml`).

### 2. Cron expressions interpret in `GENERIC_TIMEZONE`, not UTC

The droplet runs with `GENERIC_TIMEZONE=Asia/Kolkata`, so n8n interprets cron expressions in IST. **Always write cron expressions in IST wall-clock time**, not UTC. Example: for "fire at 7 AM IST daily", use `0 0 7 * * *` — NOT `0 30 1 * * *` (which would mean 01:30 IST since IST is the interpretation TZ).

If you ever change the droplet's `GENERIC_TIMEZONE`, run `scripts/fix-n8n-cron-timezones.ts` (extending the lookup map if needed) to keep cron expressions aligned.

## Gmail OAuth via SSH tunnel (workaround used 2026-05-02)

While DigitalOcean had ports 80/443/8080 blocked, the standard OAuth flow couldn't complete: n8n constructs the OAuth callback URL from `WEBHOOK_URL`, which on the droplet is set to `https://n8n.shiroienergy.com/...` — that URL was unreachable from the public internet, so Google's redirect after sign-in failed with `ERR_CONNECTION_TIMED_OUT`.

**Workaround that worked:**

1. Add **two** Authorized redirect URIs to the Google Cloud OAuth client (Credentials → OAuth 2.0 Client IDs → click client → edit):
   - `https://n8n.shiroienergy.com/rest/oauth2-credential/callback` (production)
   - `http://localhost:5679/rest/oauth2-credential/callback` (tunnel-time temporary)

2. SSH to droplet and temporarily switch n8n's OAuth callback base URL to localhost (kills the production URL routing for everything, but only briefly):
   ```bash
   cd /opt/shiroi-automation
   sed -i 's|WEBHOOK_URL=https://n8n.shiroienergy.com/|WEBHOOK_URL=http://localhost:5679/|' docker-compose.yml
   sed -i 's|N8N_EDITOR_BASE_URL=https://n8n.shiroienergy.com/|N8N_EDITOR_BASE_URL=http://localhost:5679/|' docker-compose.yml
   docker compose up -d n8n
   ```

3. From local machine, restart the SSH tunnel (`ssh -N -L 5679:172.18.0.2:5678 root@68.183.91.111`).

4. In browser at `http://localhost:5679`, create the Gmail OAuth credential — Google now redirects to `localhost:5679/...` which routes through the tunnel and completes successfully. The credential gets stored encrypted in n8n's DB and survives any future env-var changes.

5. **Revert** the env vars on droplet so the production URL is restored:
   ```bash
   sed -i 's|WEBHOOK_URL=http://localhost:5679/|WEBHOOK_URL=https://n8n.shiroienergy.com/|' docker-compose.yml
   sed -i 's|N8N_EDITOR_BASE_URL=http://localhost:5679/|N8N_EDITOR_BASE_URL=https://n8n.shiroienergy.com/|' docker-compose.yml
   docker compose up -d n8n
   ```

A helper script lives at `/tmp/oauth.sh` on the droplet during the OAuth flow (deleted after revert) — code is in `infrastructure/n8n/workflows/README.md` (this section).

**Why we don't leave this as the permanent setup:** with `WEBHOOK_URL=http://localhost:5679/`, all webhook URLs n8n hands out (e.g., for the event bus router, Sentry forwarder) point at `localhost:5679` instead of `https://n8n.shiroienergy.com/...`. That's only useful for the local SSH tunnel and breaks any external integration once DigitalOcean restores the public ports.

## The legacy standalone bug-report webhook

The original bug-report workflow tested on 2026-04-19 used its own webhook URL (`N8N_BUG_REPORT_WEBHOOK_URL`). ERP's `notifyBugReport` now fires through the event bus router (`bug_report.submitted` → `01 — Bug report`) whenever `N8N_EVENT_BUS_URL` is set, and only falls back to the legacy URL when it isn't. The standalone workflow can be retired once the router is activated in n8n AND the public-internet route to it is restored (DigitalOcean ports 80/443) — until then, leave `N8N_BUG_REPORT_WEBHOOK_URL` set as a safety net for local dev.

## DigitalOcean port-block status (2026-04-25 → ongoing)

On 2026-04-25, DigitalOcean's Trust & Safety automated system blocked **ports 80/443/8080** on the droplet in response to a Netcraft alert that flagged n8n's `executeCommand` node and webhook ingestion as "potential malware infrastructure." Detailed abuse responses were sent to tickets #12078644 and #12078645 explaining the legitimate use case; both tickets auto-closed without human review and ports remained blocked. A regular Support ticket was filed under Networking/Firewall on 2026-05-01 requesting manual port restoration — pending response.

**While ports are blocked:**
- Port 22 (SSH) is still open. All n8n management uses an SSH tunnel: `ssh -N -L 5679:172.18.0.2:5678 root@68.183.91.111` then point n8n REST API tooling and the editor UI at `http://localhost:5679/`.
- Workflows are activated and run on the droplet's internal cron, so digests fire daily at their scheduled IST times — they just can't be called from the public internet (e.g., ERP's `emitErpEvent` won't reach the router webhook until ports are restored).
- WhatsApp Send works fine — it's outbound traffic to Meta's servers, not affected by the inbound port block.
- Gmail send works fine for the same reason (outbound to Google).

**When ports are restored:**
- Wire `N8N_EVENT_BUS_URL=https://n8n.shiroienergy.com/webhook/event-bus` into Vercel env so ERP starts firing real events into the router.
- Configure Sentry alert rule to webhook `https://n8n.shiroienergy.com/webhook/sentry-alert` with `x-webhook-secret` header.
- Retire the legacy standalone bug-report webhook.
