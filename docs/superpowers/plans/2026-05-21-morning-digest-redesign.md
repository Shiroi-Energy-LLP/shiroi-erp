# Morning digest redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 8-workflow role-keyed morning digest set with 4 coordinator-led workflows that hit each direct report once with their actionable view, with Vivek cc'd on every one.

**Architecture:** Each workflow is a n8n `scheduleTrigger` → HTTP fetch(es) against Supabase REST → Code/Set "Compose digest" node → Send WhatsApp node(s) with `executeOnce: true`. One new SQL view (`v_digest_projects_active_for_pm`) needed for Manivel's workflow. Two existing RPCs (`get_expected_orders`, `get_expected_payments`) are called from Workflow B. Two old workflows deactivated (#25 O&M, #26 Liaison).

**Tech Stack:** n8n 2.16.1 (Cloud API workflows), Supabase PostgreSQL 16, Meta WhatsApp Cloud API template messaging (`erp_alert|en`), `scripts/push-n8n-workflows.ts` for deployment.

**Spec:** `docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md`

---

## File Structure

**Files created:**
- `supabase/migrations/0113_digest_projects_active_for_pm.sql` — new SQL view for Manivel's digest

**Files rewritten (preserve workflow IDs to update in place on push):**
- `infrastructure/n8n/workflows/19-vivek-daily-7am.json` — Vivek personal (3 content blocks)
- `infrastructure/n8n/workflows/20-sales-head-daily-8am.json` — Orders + Payments this week (rename body, file name stays for ID stability)
- `infrastructure/n8n/workflows/21-design-head-daily-8am.json` — In-design queue
- `infrastructure/n8n/workflows/22-projects-head-daily-8am.json` — Active project queue

**Files modified:**
- `packages/types/database.ts` — regenerated after the new view lands
- `docs/CHANGELOG.md` — one-line entry for today
- `docs/CURRENT_STATUS.md` — "Last updated" prepend

**Files left alone:**
- All other `infrastructure/n8n/workflows/*.json` files
- `infrastructure/n8n/workflows/25-om-head-daily-8am.json` — kept on disk, just deactivated on droplet
- `infrastructure/n8n/workflows/26-liaison-head-daily-8am.json` — same
- `infrastructure/n8n/workflows/56-droplet-health.json` — untouched
- `infrastructure/n8n/workflows/57-meta-delivery-webhook.json` — untouched

---

## Pre-flight environment requirements

These must hold true before Sonnet starts; verify via the first task:

- `.env.local` contains `N8N_API_KEY`, `N8N_BASE_URL=https://n8n.shiroienergy.com`, `SUPABASE_PROJECT_ID=actqtzoxjilqnldnacqz`, `SUPABASE_SECRET_KEY=sb_secret_...` for the DEV project
- droplet env at `/opt/shiroi-automation/.env` has all `*_WHATSAPP` recipient numbers populated
- n8n workflows #19, #20, #21, #22 are currently active on droplet (existing IDs):
  - #19: `eDxwDJb96e8szPI2`
  - #20: `8TRoulZcxG0zgTFw`
  - #21: `jyiz9c8UbDdxYKp8`
  - #22: `OkA5wYRnpUB6oR99`
- credentials in n8n: `Supabase service role` (id `d4DMha1ex7q95fw8`), `WhatsApp (Shiroi)` (id `V1tGCgqxxpiIprjI`)

---

## Task 0: Verify column shapes for the new view

**Files:** none (probe only)

- [ ] **Step 0.1: Verify `projects` actually exposes `customer_name`, `customer_phone` columns** (existing `v_digest_milestones_overdue` references them as `p.customer_name` — confirm before referencing in the new view)

Use the Supabase MCP tool `mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__execute_sql` against project_id `actqtzoxjilqnldnacqz` with this query:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'projects' AND table_schema = 'public'
  AND column_name IN ('customer_name', 'customer_phone', 'customer_id', 'project_name', 'project_value', 'project_manager_id')
ORDER BY ordinal_position;
```

Expected: at least `customer_name`, `customer_phone`, `project_manager_id` present. If `customer_name` is missing, the view's source is `leads.customer_name` joined via `projects.lead_id` — adjust the view definition in Task 1.

- [ ] **Step 0.2: Verify `employees.whatsapp_number` field name**

```sql
SELECT column_name FROM information_schema.columns WHERE table_name='employees' AND table_schema='public' AND column_name LIKE '%whatsapp%';
```

Expected: `whatsapp_number` exists (matches what `v_digest_milestones_overdue` already uses).

- [ ] **Step 0.3: Sanity-check the data exists**

```sql
SELECT status, COUNT(*)
FROM projects
WHERE deleted_at IS NULL AND status IN ('yet_to_start','in_progress','holding_shiroi')
GROUP BY status;
```

Expected: row counts for each status. If all are zero on dev, document this but proceed — the view will simply return zero rows and the workflow will render the "✅ no active projects" branch.

No commit at end of Task 0 — it's recon only.

---

## Task 1: Author migration 0113 — `v_digest_projects_active_for_pm`

**Files:**
- Create: `supabase/migrations/0113_digest_projects_active_for_pm.sql`

- [ ] **Step 1.1: Write the migration**

Create file `supabase/migrations/0113_digest_projects_active_for_pm.sql` with this exact content. **If Task 0.1 revealed `customer_name` lives on `leads` not `projects`, replace the SELECT in the view definition with the joined version noted at the bottom of the migration.**

```sql
-- Migration 0113: Active-project queue digest view for projects manager (Manivel)
--
-- Surfaces projects in yet_to_start | in_progress | holding_shiroi status with
-- their PM and time-in-stage. Drives workflow #22 (renamed to "Active project
-- queue"). Follows the v_digest_milestones_overdue pattern from migration 083.

CREATE OR REPLACE VIEW public.v_digest_projects_active_for_pm AS
SELECT
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.system_size_kwp,
  p.status,
  -- Stage order key: yet_to_start (0) before in_progress (1) before holding_shiroi (2)
  CASE p.status
    WHEN 'yet_to_start' THEN 0
    WHEN 'in_progress' THEN 1
    WHEN 'holding_shiroi' THEN 2
  END AS status_sort_order,
  -- How long the project has been in its current status (days)
  GREATEST(0, (CURRENT_DATE - COALESCE(p.status_updated_at::date, p.created_at::date))) AS days_in_status,
  pm.id AS project_manager_id,
  pm.full_name AS project_manager_name,
  pm.whatsapp_number AS project_manager_whatsapp_number
FROM projects p
LEFT JOIN employees pm ON pm.id = p.project_manager_id
WHERE p.deleted_at IS NULL
  AND p.status IN ('yet_to_start','in_progress','holding_shiroi')
ORDER BY status_sort_order, days_in_status DESC;

COMMENT ON VIEW public.v_digest_projects_active_for_pm IS
  'Active-project queue for the projects manager (Manivel). Excludes order_received (still in handoff), holding_client (not actionable for PM), waiting_net_metering (liaison concern), and completed. Ordered: yet_to_start first, then in_progress, then holding_shiroi; within group by days_in_status desc. Drives n8n workflow #22.';

-- If Task 0.1 showed customer_name lives on leads (not projects), replace the
-- view body above with the version below:
--   FROM projects p
--   LEFT JOIN leads l ON l.id = p.lead_id
--   LEFT JOIN employees pm ON pm.id = p.project_manager_id
-- and reference l.customer_name in the SELECT.
```

- [ ] **Step 1.2: Apply migration to DEV via MCP**

```
Tool: mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__apply_migration
project_id: actqtzoxjilqnldnacqz
name: 0113_digest_projects_active_for_pm
query: <paste the migration body above>
```

Expected: success response. If error mentions "column does not exist", revisit Task 0.1 — `customer_name` likely lives on `leads`. Switch to the JOINed body shown in the comment.

- [ ] **Step 1.3: Sanity check the new view**

```
Tool: mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__execute_sql
project_id: actqtzoxjilqnldnacqz
query: SELECT status, COUNT(*) AS n, MIN(days_in_status), MAX(days_in_status) FROM v_digest_projects_active_for_pm GROUP BY status ORDER BY status;
```

Expected: row counts for one or more of `yet_to_start`, `in_progress`, `holding_shiroi`. Numeric `days_in_status` columns are non-negative integers.

- [ ] **Step 1.4: Commit the migration file**

```bash
git add supabase/migrations/0113_digest_projects_active_for_pm.sql
git commit -m "$(cat <<'EOF'
feat(db): mig 0113 — v_digest_projects_active_for_pm view for Manivel digest

Surfaces yet_to_start + in_progress + holding_shiroi projects with PM and
days-in-status, sorted yet_to_start first then in_progress then holding,
within group by days_in_status desc. Drives n8n workflow #22 (renamed to
"Active project queue") per spec
docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Regenerate `packages/types/database.ts`

**Files:**
- Modify: `packages/types/database.ts`

- [ ] **Step 2.1: Pull fresh TypeScript types via MCP**

```
Tool: mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__generate_typescript_types
project_id: actqtzoxjilqnldnacqz
```

The response is JSON-wrapped (`{"types": "..."}`) and will land in the tool-results file because it's large. Note the path in the result message.

- [ ] **Step 2.2: Copy the raw JSON tool-results file to `packages/types/database.ts`**

Copy the tool-results file path printed in Step 2.1's output to `packages/types/database.ts`, overwriting the existing file.

- [ ] **Step 2.3: Unwrap the JSON to get raw types**

```bash
node -e "const fs=require('fs'); const obj=JSON.parse(fs.readFileSync('packages/types/database.ts','utf8')); fs.writeFileSync('packages/types/database.ts', obj.types);"
```

Expected: `packages/types/database.ts` is now valid TypeScript (starts with `export type Json = ...`).

- [ ] **Step 2.4: Strip view FK entries (required for `tsc` to not blow up)**

```bash
node scripts/strip-view-fk-entries.mjs
```

Expected: console output showing entries stripped.

- [ ] **Step 2.5: Verify type-check passes**

```bash
pnpm check-types
```

Expected: `Tasks:    5 successful, 5 total` and no TypeScript errors. If TS2589 ("Type instantiation excessively deep") appears, Step 2.4 wasn't run or didn't work — re-run it.

- [ ] **Step 2.6: Commit the regenerated types**

```bash
git add packages/types/database.ts
git commit -m "$(cat <<'EOF'
chore(types): regenerate database.ts after mig 0113

Adds Database['public']['Views']['v_digest_projects_active_for_pm'] Row
type. Post-processed via scripts/strip-view-fk-entries.mjs.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rewrite workflow #19 — Vivek's daily personal

**Files:**
- Modify: `infrastructure/n8n/workflows/19-vivek-daily-7am.json` (full rewrite, but workflow ID `eDxwDJb96e8szPI2` preserved via name match)

The new workflow fetches three sources (new leads, tasks done, activities logged), merges them in a Code node, composes a single digest, and sends one WhatsApp to Vivek.

- [ ] **Step 3.1: Replace the file with the new structure**

Use the `Write` tool to overwrite `infrastructure/n8n/workflows/19-vivek-daily-7am.json` with the following exact content:

```json
{
  "name": "19 — Vivek daily 7AM digest",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 0 7 * * *" }
          ]
        },
        "timezone": "Asia/Kolkata"
      },
      "id": "node-cron",
      "name": "Daily 7:00 IST",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 300]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/v_digest_leads_new_24h",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http-leads",
      "name": "Fetch new leads (24h)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 200],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/tasks?is_completed=eq.true&completed_at=gte.{{ DateTime.now().minus({hours: 24}).toISO() }}&deleted_at=is.null&select=id,title,assigned_to,completed_at,category,entity_type",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http-tasks",
      "name": "Fetch tasks done (24h)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 300],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/lead_activities?created_at=gte.{{ DateTime.now().minus({hours: 24}).toISO() }}&select=id,lead_id,performed_by,activity_type,summary,activity_date",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http-activities",
      "name": "Fetch lead activities (24h)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 400],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "// Merge the three upstream HTTP fetches into one digest item.\n// $input.all() returns [leadsItems, tasksItems, activitiesItems] — one item per source.\nconst all = $input.all();\nconst leads = (all[0]?.json || []);\nconst tasks = (all[1]?.json || []);\nconst activities = (all[2]?.json || []);\n\nconst dateLine = DateTime.now().setZone('Asia/Kolkata').toFormat('EEE, dd LLL yyyy');\n\nlet body = `🌅 *Vivek's morning* — ${dateLine}\\n`;\n\nbody += `\\n*New leads (24h):* ${leads.length}\\n`;\nif (leads.length === 0) {\n  body += `(quiet night — no new leads)\\n`;\n} else {\n  for (const [i, l] of leads.slice(0, 8).entries()) {\n    body += `${i+1}. ${l.customer_name} · ${l.city || '—'} · ${l.estimated_size_kwp || '—'}kWp · ${l.assigned_employee_name || 'unassigned'}\\n`;\n  }\n  if (leads.length > 8) body += `…+${leads.length - 8} more\\n`;\n}\n\nbody += `\\n*Tasks done (24h):* ${tasks.length}\\n`;\nif (tasks.length === 0) {\n  body += `(none closed)\\n`;\n} else {\n  for (const [i, t] of tasks.slice(0, 8).entries()) {\n    body += `${i+1}. ${t.title}\\n`;\n  }\n  if (tasks.length > 8) body += `…+${tasks.length - 8} more\\n`;\n}\n\nbody += `\\n*Activities logged (24h):* ${activities.length}\\n`;\nif (activities.length === 0) {\n  body += `(none logged)\\n`;\n} else {\n  for (const [i, a] of activities.slice(0, 8).entries()) {\n    body += `${i+1}. ${a.activity_type} — ${(a.summary || '').slice(0, 50)}\\n`;\n  }\n  if (activities.length > 8) body += `…+${activities.length - 8} more\\n`;\n}\n\nbody += `\\nOpen: https://erp.shiroienergy.com`;\n\nconst title = `🌅 Morning summary — ${dateLine}`;\n\nreturn [{\n  json: {\n    title,\n    body: body.slice(0, 900),\n    to_phone: $env.VIVEK_WHATSAPP || '',\n  },\n}];"
      },
      "id": "node-compose",
      "name": "Compose digest",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300]
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-vivek",
      "name": "Send WhatsApp to Vivek",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 300],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    }
  ],
  "connections": {
    "Daily 7:00 IST": {
      "main": [
        [
          { "node": "Fetch new leads (24h)", "type": "main", "index": 0 },
          { "node": "Fetch tasks done (24h)", "type": "main", "index": 0 },
          { "node": "Fetch lead activities (24h)", "type": "main", "index": 0 }
        ]
      ]
    },
    "Fetch new leads (24h)": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Fetch tasks done (24h)": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Fetch lead activities (24h)": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Compose digest": {
      "main": [[{ "node": "Send WhatsApp to Vivek", "type": "main", "index": 0 }]]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID",
    "timezone": "Asia/Kolkata"
  },
  "pinData": {}
}
```

The `REPLACE_WITH_*` placeholders are resolved by `scripts/push-n8n-workflows.ts` against existing credentials/workflows on the droplet.

- [ ] **Step 3.2: Commit**

```bash
git add infrastructure/n8n/workflows/19-vivek-daily-7am.json
git commit -m "$(cat <<'EOF'
feat(n8n): rewrite #19 — Vivek daily 7AM with 3 content blocks

New leads (24h) + Tasks completed (24h) + Lead activities logged (24h)
merged into single digest. Single send to VIVEK_WHATSAPP. executeOnce:true
on the Send node prevents per-item fanout.

Replaces the old single-block "new leads" digest. Per spec
docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite workflow #20 — Orders + Payments this week

**Files:**
- Modify: `infrastructure/n8n/workflows/20-sales-head-daily-8am.json` (file path stays; workflow ID `8TRoulZcxG0zgTFw`)

Calls two RPCs and sends to Vivek + Prem (both via `SALES_HEAD_WHATSAPP` and `VIVEK_WHATSAPP`).

- [ ] **Step 4.1: Overwrite the file**

Use `Write` tool with this exact content:

```json
{
  "name": "20 — Orders + Payments this week",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 0 8 * * *" }
          ]
        },
        "timezone": "Asia/Kolkata"
      },
      "id": "node-cron",
      "name": "Daily 8:00 IST",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/rpc/get_expected_orders",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Content-Type", "value": "application/json" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"window_days\": 7}",
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http-orders",
      "name": "Fetch expected orders (7d)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 200],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/rpc/get_expected_payments",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Content-Type", "value": "application/json" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"window_days\": 7}",
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http-payments",
      "name": "Fetch expected payments (7d)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 400],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "// Compose orders + payments digest. $input.all() = [orders, payments].\nconst all = $input.all();\nconst orders = (all[0]?.json || []);\nconst payments = (all[1]?.json || []);\n\nconst dateLine = DateTime.now().setZone('Asia/Kolkata').toFormat('EEE, dd LLL yyyy');\n\nconst fmtL = (n) => `₹${(Number(n) / 100000).toFixed(1)}L`;\nconst fmtCr = (n) => `₹${(Number(n) / 10000000).toFixed(1)}Cr`;\n\nconst ordersTotal = orders.reduce((s, o) => s + Number(o.derived_value || 0), 0);\nconst paymentsTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);\n\nlet body = `📈 *This week's pipeline* — ${dateLine}\\n`;\n\nbody += `\\n*Orders closing (next 7d):* ${orders.length} · ${fmtCr(ordersTotal)} total\\n`;\nif (orders.length === 0) {\n  body += `(none expected this week)\\n`;\n} else {\n  for (const [i, o] of orders.slice(0, 10).entries()) {\n    const dueLabel = (o.expected_close_date || '').slice(5); // MM-DD\n    body += `${i+1}. ${o.customer_name} · ${o.estimated_size_kwp || '—'}kWp · ${fmtL(o.derived_value)} · ${o.close_probability}% · ${dueLabel}\\n`;\n  }\n  if (orders.length > 10) body += `…+${orders.length - 10} more\\n`;\n}\n\nbody += `\\n*Payments expected (next 7d):* ${payments.length} · ${fmtL(paymentsTotal)} total\\n`;\nif (payments.length === 0) {\n  body += `(none scheduled)\\n`;\n} else {\n  for (const [i, p] of payments.slice(0, 10).entries()) {\n    const dueLabel = (p.expected_payment_date || '').slice(5); // MM-DD\n    body += `${i+1}. ${p.project_number} · ${p.customer_name} · ${fmtL(p.amount)} · ${dueLabel}\\n`;\n  }\n  if (payments.length > 10) body += `…+${payments.length - 10} more\\n`;\n}\n\nbody += `\\nOpen: https://erp.shiroienergy.com`;\n\nconst title = `📈 This week's pipeline — ${dateLine}`;\n\nreturn [{\n  json: {\n    title,\n    body: body.slice(0, 900),\n    to_phone_vivek: $env.VIVEK_WHATSAPP || '',\n    to_phone_prem: $env.SALES_HEAD_WHATSAPP || '',\n  },\n}];"
      },
      "id": "node-compose",
      "name": "Compose digest",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300]
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_vivek }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-vivek",
      "name": "Send to Vivek",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 200],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_prem }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-prem",
      "name": "Send to Prem",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 400],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    }
  ],
  "connections": {
    "Daily 8:00 IST": {
      "main": [
        [
          { "node": "Fetch expected orders (7d)", "type": "main", "index": 0 },
          { "node": "Fetch expected payments (7d)", "type": "main", "index": 0 }
        ]
      ]
    },
    "Fetch expected orders (7d)": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Fetch expected payments (7d)": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Compose digest": {
      "main": [
        [
          { "node": "Send to Vivek", "type": "main", "index": 0 },
          { "node": "Send to Prem", "type": "main", "index": 0 }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID",
    "timezone": "Asia/Kolkata"
  },
  "pinData": {}
}
```

- [ ] **Step 4.2: Commit**

```bash
git add infrastructure/n8n/workflows/20-sales-head-daily-8am.json
git commit -m "$(cat <<'EOF'
feat(n8n): rewrite #20 — Orders + Payments this week (Vivek + Prem)

Calls get_expected_orders(window_days=7) + get_expected_payments(window_days=7)
RPCs. Merges into single digest with ₹ totals + per-line breakdown. Two
parallel sends with executeOnce:true. Workflow name changed from "Sales
head daily 8AM" to "Orders + Payments this week" to reflect new scope.

Per spec docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rewrite workflow #21 — In-design queue

**Files:**
- Modify: `infrastructure/n8n/workflows/21-design-head-daily-8am.json` (workflow ID `jyiz9c8UbDdxYKp8`)

Same shape as the existing #21 but adds a parallel send to Vivek and updates `executeOnce: true`.

- [ ] **Step 5.1: Overwrite the file**

Use `Write` tool with this exact content:

```json
{
  "name": "21 — In-design queue",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 0 8 * * *" }
          ]
        },
        "timezone": "Asia/Kolkata"
      },
      "id": "node-cron",
      "name": "Daily 8:00 IST",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 300]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/v_digest_proposals_design_backlog",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http",
      "name": "Fetch design backlog",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 300],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const rows = $input.first()?.json || [];\nconst dateLine = DateTime.now().setZone('Asia/Kolkata').toFormat('EEE, dd LLL yyyy');\n\nlet body = `🎨 *In-design queue* — ${dateLine}\\n`;\nbody += `\\nProposals in design (>24h old): ${rows.length}\\n`;\nif (rows.length === 0) {\n  body += `✅ caught up — nothing aging in design`;\n} else {\n  for (const [i, p] of rows.slice(0, 15).entries()) {\n    body += `${i+1}. ${p.proposal_number} · ${p.customer_name} · ${p.estimated_size_kwp || '—'}kWp · ${Math.floor(p.hours_in_draft || 0)}h · ${p.prepared_by_name || 'unassigned'}\\n`;\n  }\n  if (rows.length > 15) body += `…+${rows.length - 15} more\\n`;\n}\nbody += `\\nOpen: https://erp.shiroienergy.com/design`;\n\nconst title = `🎨 In-design queue — ${dateLine}`;\n\nreturn [{\n  json: {\n    title,\n    body: body.slice(0, 900),\n    to_phone_vivek: $env.VIVEK_WHATSAPP || '',\n    to_phone_shravan: $env.DESIGN_HEAD_WHATSAPP || '',\n  },\n}];"
      },
      "id": "node-compose",
      "name": "Compose digest",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300]
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_vivek }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-vivek",
      "name": "Send to Vivek",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 200],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_shravan }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-shravan",
      "name": "Send to Shravan",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 400],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    }
  ],
  "connections": {
    "Daily 8:00 IST": {
      "main": [[{ "node": "Fetch design backlog", "type": "main", "index": 0 }]]
    },
    "Fetch design backlog": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Compose digest": {
      "main": [
        [
          { "node": "Send to Vivek", "type": "main", "index": 0 },
          { "node": "Send to Shravan", "type": "main", "index": 0 }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID",
    "timezone": "Asia/Kolkata"
  },
  "pinData": {}
}
```

- [ ] **Step 5.2: Commit**

```bash
git add infrastructure/n8n/workflows/21-design-head-daily-8am.json
git commit -m "$(cat <<'EOF'
feat(n8n): rewrite #21 — In-design queue (Vivek + Shravan)

Same v_digest_proposals_design_backlog data source as before, but rewritten
with Code-node Compose for consistency with other digests, and now sends
to Vivek (coordinator) in parallel to Shravan (Design head). executeOnce:true
on both sends.

Per spec docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite workflow #22 — Active project queue

**Files:**
- Modify: `infrastructure/n8n/workflows/22-projects-head-daily-8am.json` (workflow ID `OkA5wYRnpUB6oR99`)

Fetches the new view and groups output by status. Two parallel sends.

- [ ] **Step 6.1: Overwrite the file**

Use `Write` tool with this exact content:

```json
{
  "name": "22 — Active project queue",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 0 8 * * *" }
          ]
        },
        "timezone": "Asia/Kolkata"
      },
      "id": "node-cron",
      "name": "Daily 8:00 IST",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 300]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://{{ $env.SUPABASE_PROJECT_ID }}.supabase.co/rest/v1/v_digest_projects_active_for_pm",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "apikey", "value": "={{ $env.SUPABASE_SECRET_KEY }}" },
            { "name": "Accept", "value": "application/json" }
          ]
        },
        "options": { "response": { "response": { "responseFormat": "json" } } }
      },
      "id": "node-http",
      "name": "Fetch active projects",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 300],
      "credentials": {
        "httpHeaderAuth": {
          "id": "REPLACE_WITH_SUPABASE_SERVICE_ROLE_CRED_ID",
          "name": "Supabase service role"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const rows = $input.first()?.json || [];\nconst dateLine = DateTime.now().setZone('Asia/Kolkata').toFormat('EEE, dd LLL yyyy');\n\nconst byStatus = { yet_to_start: [], in_progress: [], holding_shiroi: [] };\nfor (const r of rows) {\n  if (byStatus[r.status]) byStatus[r.status].push(r);\n}\n\nconst section = (label, list, maxRows) => {\n  if (list.length === 0) return `\\n*${label}:* 0\\n(none)\\n`;\n  let out = `\\n*${label}:* ${list.length}\\n`;\n  for (const [i, r] of list.slice(0, maxRows).entries()) {\n    out += `${i+1}. ${r.project_number} · ${r.customer_name} · ${r.system_size_kwp || '—'}kWp · ${r.days_in_status}d in stage\\n`;\n  }\n  if (list.length > maxRows) out += `…+${list.length - maxRows} more\\n`;\n  return out;\n};\n\nlet body = `🏗️ *Active projects* — ${dateLine}\\n`;\nbody += section('Yet to start', byStatus.yet_to_start, 5);\nbody += section('In progress', byStatus.in_progress, 10);\nbody += section('Holding (Shiroi)', byStatus.holding_shiroi, 5);\nbody += `\\nOpen: https://erp.shiroienergy.com/projects`;\n\nconst title = `🏗️ Active projects — ${dateLine}`;\n\nreturn [{\n  json: {\n    title,\n    body: body.slice(0, 900),\n    to_phone_vivek: $env.VIVEK_WHATSAPP || '',\n    to_phone_manivel: $env.PROJECTS_HEAD_WHATSAPP || '',\n  },\n}];"
      },
      "id": "node-compose",
      "name": "Compose digest",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300]
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_vivek }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-vivek",
      "name": "Send to Vivek",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 200],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "sendTemplate",
        "phoneNumberId": "1140448799143790",
        "recipientPhoneNumber": "={{ $json.to_phone_manivel }}",
        "template": "erp_alert|en",
        "components": {
          "component": [
            {
              "type": "body",
              "bodyParameters": {
                "parameter": [
                  { "type": "text", "text": "={{ $json.title }}" },
                  { "type": "text", "text": "={{ ($json.body || ' ').slice(0, 900) }}" }
                ]
              }
            }
          ]
        }
      },
      "id": "node-whatsapp-manivel",
      "name": "Send to Manivel",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1.1,
      "position": [750, 400],
      "executeOnce": true,
      "credentials": {
        "whatsAppApi": {
          "id": "REPLACE_WITH_WHATSAPP_BUSINESS_CLOUD_CRED_ID",
          "name": "WhatsApp (Shiroi)"
        }
      }
    }
  ],
  "connections": {
    "Daily 8:00 IST": {
      "main": [[{ "node": "Fetch active projects", "type": "main", "index": 0 }]]
    },
    "Fetch active projects": {
      "main": [[{ "node": "Compose digest", "type": "main", "index": 0 }]]
    },
    "Compose digest": {
      "main": [
        [
          { "node": "Send to Vivek", "type": "main", "index": 0 },
          { "node": "Send to Manivel", "type": "main", "index": 0 }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID",
    "timezone": "Asia/Kolkata"
  },
  "pinData": {}
}
```

- [ ] **Step 6.2: Commit**

```bash
git add infrastructure/n8n/workflows/22-projects-head-daily-8am.json
git commit -m "$(cat <<'EOF'
feat(n8n): rewrite #22 — Active project queue (Vivek + Manivel)

Pulls from new v_digest_projects_active_for_pm view (mig 0113). Groups
output by status (yet_to_start, in_progress, holding_shiroi) with per-group
caps to stay under Meta's 900-char body limit. Sends to Vivek + Manivel
with executeOnce:true on both. Workflow name changed from "Projects head
daily 8AM" to "Active project queue".

Per spec docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Push the 4 workflows to n8n

**Files:** none modified

- [ ] **Step 7.1: Push via existing script**

```bash
pnpm tsx scripts/push-n8n-workflows.ts 19 20 21 22
```

Expected output: 4 `[updt]` lines for each of the 4 files. Look for "Done." at the end and zero `[fail]` lines. The script uses placeholder resolution so `REPLACE_WITH_*` strings should turn into real IDs in the upload.

If any `[fail]` line appears, capture the error message and stop — the credential IDs or workflow names don't match what's on the droplet. Investigate before continuing.

- [ ] **Step 7.2: Verify the workflows updated**

Pull the workflow names from n8n's REST API to confirm new names landed:

```bash
N8N_KEY=$(grep -E "^N8N_API_KEY=" .env.local | sed 's/N8N_API_KEY=//')
curl -s "https://n8n.shiroienergy.com/api/v1/workflows?limit=50" -H "X-N8N-API-KEY: ${N8N_KEY}" | grep -oE '"name":"[^"]*(daily|queue|Orders|active|In-design)[^"]*"'
```

Expected substrings:
- `19 — Vivek daily 7AM digest`
- `20 — Orders + Payments this week`
- `21 — In-design queue`
- `22 — Active project queue`

If old names show up, the push didn't update them — re-run Step 7.1.

No commit at end of Task 7 — push is idempotent and the JSONs are already committed in tasks 3-6.

---

## Task 8: Deactivate #25 (O&M head) and #26 (Liaison head)

**Files:** none modified

- [ ] **Step 8.1: Deactivate via REST API**

```bash
N8N_KEY=$(grep -E "^N8N_API_KEY=" .env.local | sed 's/N8N_API_KEY=//')

echo "Deactivating #25 O&M head..."
curl -s -X POST "https://n8n.shiroienergy.com/api/v1/workflows/28EV2RHYs8gau9ay/deactivate" \
  -H "X-N8N-API-KEY: ${N8N_KEY}" -H "content-type: application/json" \
  | grep -oE '"active":(true|false)' | head -1

echo "Deactivating #26 Liaison head..."
curl -s -X POST "https://n8n.shiroienergy.com/api/v1/workflows/PvE4cRvigxlLlGxO/deactivate" \
  -H "X-N8N-API-KEY: ${N8N_KEY}" -H "content-type: application/json" \
  | grep -oE '"active":(true|false)' | head -1
```

Expected: both lines print `"active":false`.

- [ ] **Step 8.2: Verify final active list**

```bash
ssh root@68.183.91.111 'sqlite3 /var/lib/docker/volumes/shiroi-automation_n8n_data/_data/database.sqlite "SELECT id, name FROM workflow_entity WHERE active = 1 ORDER BY name;"'
```

Expected exactly six rows (in some order):
- `eDxwDJb96e8szPI2|19 — Vivek daily 7AM digest`
- `8TRoulZcxG0zgTFw|20 — Orders + Payments this week`
- `jyiz9c8UbDdxYKp8|21 — In-design queue`
- `OkA5wYRnpUB6oR99|22 — Active project queue`
- `YrtdipeLMCM2M8e9|56 — Droplet heartbeat`
- `0vHUF8pDxVdUAAiD|57 — Meta WhatsApp delivery webhook`

If any other workflow shows active OR if any of the above are missing, stop and reconcile before continuing.

No commit at end of Task 8 — this is droplet state, not repo state.

---

## Task 9: Smoke-test each rewritten workflow

**Files:** none modified

We test each by manually firing the workflow's webhook trigger via n8n REST API. Since these are `scheduleTrigger` workflows (no inbound webhook), use n8n's `/api/v1/workflows/{id}/execute` endpoint (manual execution).

If `/execute` isn't available (n8n version limitations), skip to Step 9.5 (next-morning verification).

- [ ] **Step 9.1: Trigger #19 manually**

```bash
N8N_KEY=$(grep -E "^N8N_API_KEY=" .env.local | sed 's/N8N_API_KEY=//')
echo "=== Trigger #19 ==="
RESP=$(curl -s -X POST "https://n8n.shiroienergy.com/api/v1/workflows/eDxwDJb96e8szPI2/execute" \
  -H "X-N8N-API-KEY: ${N8N_KEY}" -H "content-type: application/json" -d '{}')
echo "$RESP" | head -c 300
```

If response is a 404 / "not found", the manual execute endpoint isn't available — log this and proceed to Step 9.5.

If response includes `"data": {...}` or an executionId, the workflow ran. Wait 10 seconds and check the execution log:

```bash
sleep 10
ssh root@68.183.91.111 'sqlite3 /var/lib/docker/volumes/shiroi-automation_n8n_data/_data/database.sqlite "SELECT id, status, startedAt FROM execution_entity WHERE workflowId = \"eDxwDJb96e8szPI2\" ORDER BY id DESC LIMIT 1;"'
```

Expected: most recent execution shows `status=success`. If `error`, capture the exec id and inspect:

```bash
ssh root@68.183.91.111 'sqlite3 /var/lib/docker/volumes/shiroi-automation_n8n_data/_data/database.sqlite "SELECT substr(data, 1, 2000) FROM execution_data WHERE executionId = <EXEC_ID>;"' | grep -oE '"executionStatus":"[a-z]+"|"errorMessage":"[^"]*"|"node":"[^"]+"' | head -10
```

Investigate the error before proceeding. The most likely failure is a missing env var (e.g., one of the `*_WHATSAPP` variables) or a typo in the URL — fix in the workflow JSON, push again, retry.

- [ ] **Step 9.2: Trigger #20 manually**

Same shape as Step 9.1, with `8TRoulZcxG0zgTFw` as the workflow ID.

- [ ] **Step 9.3: Trigger #21 manually**

Same shape, with `jyiz9c8UbDdxYKp8`.

- [ ] **Step 9.4: Trigger #22 manually**

Same shape, with `OkA5wYRnpUB6oR99`.

- [ ] **Step 9.5: If `/execute` is unavailable, document and fall back**

If Step 9.1 returned a 404, add a comment in the task list noting "smoke test deferred to tomorrow's natural cron fire at 7-8 AM IST" — proceed to Task 10. The next morning's normal execution will exercise everything, and the user can verify by checking received WhatsApps and #57 webhook execution logs.

No commit at end of Task 9.

---

## Task 10: Update docs + final commit + push

**Files:**
- Modify: `docs/CHANGELOG.md` (prepend new entry)
- Modify: `docs/CURRENT_STATUS.md` (prepend new "Last updated" block)

- [ ] **Step 10.1: Append CHANGELOG entry**

Open `docs/CHANGELOG.md`. Find the line `## May 2026` near the top. Immediately after that line and the following blank line, insert this new entry as the FIRST bullet under "## May 2026":

```markdown
- **[2026-05-21] — n8n: morning digest redesign — coordinator-led model.** Replaced the eight role-keyed Tier 2 digests (most of which aliased to Vivek's phone or were placeholders) with **four coordinator-led workflows**, per spec `docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md`. **Migration 0113** ships `v_digest_projects_active_for_pm` view — projects in `yet_to_start | in_progress | holding_shiroi` with PM + days-in-status, ordered yet_to_start → in_progress → holding_shiroi (within group by days_in_status desc). Excludes `holding_client` (PM can't unblock those), `waiting_net_metering` (liaison), `order_received` (still in handoff). **Workflow rewrites**: `#19 Vivek daily 7AM digest` → 3 content blocks (new leads 24h + tasks completed 24h + lead_activities logged 24h) into a single message to Vivek; `#20 Orders + Payments this week` → calls existing RPCs `get_expected_orders(7)` + `get_expected_payments(7)`, sends to Vivek + Prem; `#21 In-design queue` → existing `v_digest_proposals_design_backlog` view, sends to Vivek + Shravan; `#22 Active project queue` → new view, sends to Vivek + Manivel. All Send WhatsApp nodes have `executeOnce: true`. **Deactivated** #25 (O&M head, head not hired) and #26 (Liaison head, placeholder — depends on task #23 to author Liaison digest views). JSONs remain in `infrastructure/n8n/workflows/` for future reactivation. **Active state going forward**: 6 workflows (#19, #20, #21, #22 senders + #56 heartbeat + #57 Meta webhook receiver). **Daily volume**: 9 messages across 5 unique numbers (Vivek 5, Vinodh 1, Prem 1, Shravan 1, Manivel 1) — well under Meta's 2K/24h tier limit. `packages/types/database.ts` regenerated via MCP + `scripts/strip-view-fk-entries.mjs`. Discipline gates green. → migration 0113 · spec `2026-05-21-morning-digest-redesign-design.md` · plan `2026-05-21-morning-digest-redesign.md`
```

- [ ] **Step 10.2: Prepend CURRENT_STATUS entry**

Open `docs/CURRENT_STATUS.md`. Find the line that starts with `> Last updated: **May 21, 2026 (n8n setup complete`. Replace ONLY the text "May 21, 2026 (n8n setup complete — Workspace OAuth + Sentry skipped + workflow audit closure)** —" (everything up to and including the dash after the existing parenthetical, before the body text). Replace with this new opening, which appends the previous summary as a "prior" reference:

Replace `> Last updated: **May 21, 2026 (n8n setup complete — Workspace OAuth + Sentry skipped + workflow audit closure)** — ` with:

```
> Last updated: **May 21, 2026 (morning digest redesign — coordinator-led model + mig 0113)** — Replaced the 8-workflow role-keyed morning digest set with 4 coordinator-led workflows per spec `docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md`. Vivek (coordinator) gets a personal digest at 07:00 IST (new leads + tasks done + activities logged in the last 24h) plus copies of each direct report's 08:00 digest: Orders + Payments this week (Vivek + Prem), In-design queue (Vivek + Shravan), Active project queue from new view `v_digest_projects_active_for_pm` (Vivek + Manivel). Workflows #19, #20, #21, #22 rewritten; #25 (O&M, no head) and #26 (Liaison, placeholder until digest views are authored — see task #23) deactivated. Migration 0113 adds the new view (yet_to_start + in_progress + holding_shiroi projects with PM + days-in-status). Active n8n state: 6 workflows (4 senders + #56 heartbeat + #57 Meta webhook receiver). Daily volume: 9 messages across 5 numbers. **Last updated** prior: **May 21, 2026 (n8n setup complete — Workspace OAuth + Sentry skipped + workflow audit closure)** — 
```

The rest of the line (the existing body text starting with "Today closed out the remaining loose ends...") stays exactly as-is.

- [ ] **Step 10.3: Run CI gates locally before committing**

```bash
pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh
```

Expected: all three pass. Specifically:
- `check-types`: `5 successful, 5 total`
- `lint`: `2 successful, 2 total`
- forbidden-pattern: `✓ Forbidden-pattern check passed (baseline: 63 violations grandfathered)`

If any fail, fix before committing. The most likely failure is a type error in `database.ts` if Task 2's regenerate didn't include the new view — re-run Task 2.

- [ ] **Step 10.4: Stage and commit the docs**

```bash
git add docs/CHANGELOG.md docs/CURRENT_STATUS.md
git commit -m "$(cat <<'EOF'
docs(n8n): morning digest redesign — 2026-05-21 entries

CHANGELOG + CURRENT_STATUS updated for today's coordinator-led digest
rewrite. Reference spec docs/superpowers/specs/2026-05-21-morning-digest-redesign-design.md
and plan docs/superpowers/plans/2026-05-21-morning-digest-redesign.md.

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10.5: Push to remote main**

```bash
git push origin main
```

Expected output ends with `<old-commit>..<new-commit>  main -> main`. If push is rejected because of remote changes, run `git pull --rebase origin main` first, then push again.

---

## Self-review summary

Spec coverage:
- ✅ Workflow A (Vivek personal) → Task 3
- ✅ Workflow B (Orders + Payments) → Task 4
- ✅ Workflow C (In-design queue) → Task 5
- ✅ Workflow D (Active project queue) → Task 6
- ✅ New view → Task 1
- ✅ Type regen → Task 2
- ✅ Push → Task 7
- ✅ Deactivations → Task 8
- ✅ Smoke test → Task 9
- ✅ Docs + commit + push → Task 10

Placeholder scan: clean — no TBD/TODO leftover in plan steps. The `REPLACE_WITH_*` placeholders in the JSON files are resolved by `scripts/push-n8n-workflows.ts`, which is the documented mechanism.

Type consistency: every column referenced in Code nodes matches what `get_expected_orders` / `get_expected_payments` actually return (verified via probe before writing this plan): `customer_name`, `estimated_size_kwp`, `derived_value`, `close_probability`, `expected_close_date`, `project_number`, `milestone_name`, `amount`, `expected_payment_date`.

Risk: `customer_name` on `projects` table — Task 0.1 verifies before Task 1 commits.
