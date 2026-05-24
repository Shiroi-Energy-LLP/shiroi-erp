# H2 — Automated Handover

> Plan date: 2026-05-25
> Goal: once a project reaches the right state, the handover process runs end-to-end with no manual click.

---

## Today's state

What exists:
- **C11 `handover-pdf-actions.ts`** — `generateHandoverPackPdf(projectId)` renders a 3-page react-pdf doc and uploads to `project-files/handover-packs/<projectId>/...`. Manivel/PM clicks "Generate Handover Pack" on the project detail page.
- **C12 `dc-certificate-actions.ts`** — `signDcCertificate({projectId, certificateType, customerName, customerPhone, notes})` records a sign. Three types: `dc_completion`, `handing_over`, `net_metering_submission`. Mig 137 made these DB-immutable once signed.
- **`projects.status` enum** — `order_received | yet_to_start | in_progress | completed | holding_shiroi | holding_client | waiting_net_metering | meter_client_scope`
- **`project_milestones`** — 10 milestones per project (mig 042); the last one is `handover`.
- **`net_metering_applications.discom_status`** — `tneb_verified | tneb_inspected | tneb_estimated | installation_completed | service_effected`
- **AMC contracts** — `om_contracts` table (mig 043/044) with `amc_category` (`free_amc` / `paid_amc`).
- **`emitErpEvent('project.commissioned', …)`** — event is in `ErpEventName` union, routed by `00-event-bus-router.json`, but **no ERP code site emits it today**.

What doesn't exist:
- No trigger or orchestration tying these together.
- No "commissioned" status value (closest is `completed`).
- No automatic customer WhatsApp/email of the handover pack.
- No automatic AMC contract creation.
- No idempotency guard against repeated handover runs.

## Goal-state flow

When a project is ready for handover (definition below), this runs without human click:

```
1. Gate-check: all 3 DC certs signed + net_metering = service_effected
   ↓ (fail → notify PM, do nothing)
2. Generate handover pack PDF (reuse existing action server-side)
3. Verify PDF was uploaded successfully
4. Build customer message (template + project-specific tokens)
5. Emit project.commissioned event → n8n → customer WhatsApp + customer email
6. Mark project status = 'completed' (or new 'commissioned' value — see open Q1)
7. Create om_contracts row: amc_category='free_amc', start = today, end = today + 1 year
8. Schedule the first free AMC visit (a calendar entry / task for OM team)
9. Notify Manivel + Vivek via WhatsApp: "Handover completed for X. Free AMC active till Y."
```

If any step fails, the orchestration pauses with diagnostics. Manivel sees a "Handover stalled" banner on the project detail page with the failed step + retry button.

## "Ready for handover" — exact definition (open Q2)

Recommend trigger condition:

```sql
project.status IN ('completed', 'meter_client_scope') AND
(
  -- All required DC certs signed
  SELECT COUNT(*) FROM dc_certificates dc
  WHERE dc.project_id = NEW.id
    AND dc.signed_at IS NOT NULL
    AND dc.certificate_type IN ('dc_completion','handing_over')
) >= 2
AND
  -- Net metering done (or explicitly client-scope so doesn't apply)
  (NEW.status = 'meter_client_scope' OR EXISTS (
    SELECT 1 FROM net_metering_applications nma
    WHERE nma.project_id = NEW.id
      AND nma.discom_status IN ('installation_completed','service_effected')
  ))
AND
  -- Not already handed over
  NOT EXISTS (SELECT 1 FROM handover_orchestrations h
              WHERE h.project_id = NEW.id AND h.status = 'completed')
```

This avoids needing a new enum value. Open question for Vivek: should `net_metering_submission` (the 3rd DC cert) be required, or is dc_completion + handing_over enough?

## Architecture choice

**Server-action chain in ERP, NOT pure n8n orchestration.**

Reasons:
- The flow touches multiple Supabase tables in sequence with idempotency requirements — easier from `'use server'` code using the existing query/action conventions.
- Failure recovery is easier when state lives in one DB table (`handover_orchestrations`).
- n8n is used for the customer-side delivery (WhatsApp + email) via the existing event bus.

Pattern: a server-side `runHandoverOrchestration(projectId)` that walks the 9 steps with checkpoints in `handover_orchestrations.current_step`. The trigger to call this is:

**Option A (recommended):** SQL trigger on `dc_certificates` AFTER UPDATE — when a cert gets signed AND all preconditions are met, enqueue a row in a `handover_trigger_queue` (mig 138) that an n8n cron polls every 5 min and POSTs to `/api/projects/<id>/handover-run`.

**Option B:** PG NOTIFY/LISTEN — Edge Function listens. More complex, no ops benefit at our scale.

**Option C:** ERP polling cron via Supabase pg_cron — runs every 15 min, finds projects matching the gate condition that aren't already in a handover_orchestrations row, kicks off. Simplest.

Recommend **Option C** (pg_cron) — fewest moving parts, no n8n dependency for the trigger.

## Schema additions (mig 139)

```sql
-- Single-row-per-project handover orchestration state
CREATE TABLE handover_orchestrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','paused_error','completed','manual_cancel')),
  current_step INT NOT NULL DEFAULT 0,
  -- 0: not yet started
  -- 1: gate-check
  -- 2: pdf-generated
  -- 3: pdf-verified
  -- 4: message-built
  -- 5: event-emitted
  -- 6: status-flipped
  -- 7: amc-created
  -- 8: amc-visit-scheduled
  -- 9: notified-internal
  step_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- array of {step, status, message, timestamp, retries}
  pdf_storage_path TEXT,
  om_contract_id UUID REFERENCES om_contracts(id),
  customer_message_id UUID REFERENCES customer_message_log(id),
  error_message TEXT,
  error_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_handover_status ON handover_orchestrations(status, started_at);
CREATE INDEX idx_handover_paused ON handover_orchestrations(status) WHERE status = 'paused_error';

ALTER TABLE handover_orchestrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY handover_read ON handover_orchestrations FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('founder','project_manager','om_technician','marketing_manager'))
);

CREATE POLICY handover_service_only_write ON handover_orchestrations
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- The pg_cron job
SELECT cron.schedule(
  'handover-orchestration-scan',
  '*/15 * * * *',
  $$
  -- Finds eligible projects + spawns orchestration rows
  INSERT INTO handover_orchestrations (project_id)
  SELECT p.id FROM projects p
  WHERE p.status IN ('completed','meter_client_scope')
    AND NOT EXISTS (SELECT 1 FROM handover_orchestrations h WHERE h.project_id = p.id)
    AND (
      SELECT COUNT(*) FROM dc_certificates dc
      WHERE dc.project_id = p.id AND dc.signed_at IS NOT NULL
        AND dc.certificate_type IN ('dc_completion','handing_over')
    ) >= 2
    AND (
      p.status = 'meter_client_scope' OR EXISTS (
        SELECT 1 FROM net_metering_applications nma
        WHERE nma.project_id = p.id
          AND nma.discom_status IN ('installation_completed','service_effected')
      )
    );
  -- pg_net then POSTs each new row's project_id to /api/projects/<id>/handover-run
  $$
);
```

## ERP API route + orchestration

**`apps/erp/src/app/api/projects/[id]/handover-run/route.ts`** — POST handler.

Validates `x-webhook-secret` header (called by pg_cron via pg_net), looks up the existing `handover_orchestrations` row, calls `runHandoverOrchestration(projectId, orchestrationId)`.

**`apps/erp/src/lib/handover-orchestration.ts`** — the orchestration logic:

```ts
export async function runHandoverOrchestration(projectId: string, orchestrationId: string) {
  const op = '[runHandoverOrchestration]';
  const supabase = createAdminClient();

  // Step 1: gate-check (defensive — the pg_cron query already enforced this)
  await advance(1, 'gate-check', async () => {
    const ready = await isHandoverReady(supabase, projectId);
    if (!ready) throw new Error('Gate check failed');
  });

  // Step 2: generate handover pack PDF (reuse existing action)
  const pdfPath = await advance(2, 'generate-pdf', async () => {
    return await generateHandoverPackPdfInternal(supabase, projectId);
  });

  // Step 3: verify upload (HEAD request to storage)
  await advance(3, 'verify-pdf', async () => {
    const head = await supabase.storage.from('project-files').createSignedUrl(pdfPath, 60);
    if (head.error || !head.data?.signedUrl) throw new Error('PDF upload not verifiable');
  });

  // Step 4: build customer message body (template fill)
  const messageBody = await advance(4, 'build-message', async () => {
    return await buildCustomerHandoverMessage(supabase, projectId, pdfPath);
  });

  // Step 5: emit project.commissioned + log to customer_message_log
  await advance(5, 'emit-event', async () => {
    await emitErpEvent('project.commissioned', {
      project_id: projectId,
      pdf_storage_path: pdfPath,
      message_body: messageBody,
    });
  });

  // Step 6: flip project status (idempotent)
  await advance(6, 'flip-status', async () => {
    await supabase.from('projects').update({ status: 'completed' }).eq('id', projectId);
  });

  // Step 7: create the free AMC contract
  await advance(7, 'create-amc', async () => {
    const { data: contract, error } = await supabase
      .from('om_contracts')
      .insert({
        project_id: projectId,
        amc_category: 'free_amc',
        amc_duration_months: 12,
        start_date: new Date().toISOString().slice(0,10),
        end_date: addMonths(new Date(), 12).toISOString().slice(0,10),
      })
      .select('id').single();
    if (error) throw error;
    return contract.id;
  });

  // Step 8: schedule the first AMC visit (90-day mark by default)
  await advance(8, 'schedule-first-visit', async () => {
    await supabase.from('om_visits').insert({
      project_id: projectId,
      visit_type: 'amc_first_quarter',
      scheduled_date: addDays(new Date(), 90).toISOString().slice(0,10),
      status: 'scheduled',
    });
  });

  // Step 9: notify Manivel + Vivek via WhatsApp
  await advance(9, 'notify-internal', async () => {
    await emitErpEvent('handover.completed', { project_id: projectId });
  });

  // Mark orchestration as completed
  await supabase
    .from('handover_orchestrations')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', orchestrationId);
}

async function advance(step, label, fn) {
  // Checkpoint pattern — fetch current orch, fast-forward if current_step >= step
  // (idempotency: re-running picks up from where it stopped)
  // On error: status='paused_error', error_message + error_at + retry_count++
  // ...
}
```

## Failure handling

- **Step throws**: orchestration row → `status='paused_error'`, populate `error_message` + `error_at`. The error is non-fatal at the request level (POST returns 200 with `{paused:true, step, error}`).
- **`/projects/[id]` detail page** displays a "Handover paused at step N: <error>" banner with a "Retry" button.
- **Retry button** POSTs to `/api/projects/[id]/handover-retry` → flips orch.status back to `pending` + increments `retry_count`. Next pg_cron tick picks it up.
- **Max retries**: 5. After that, surface as a Sentry alert + WhatsApp ping to Vivek.

## Idempotency

- The `UNIQUE (project_id)` constraint on `handover_orchestrations` prevents double-spawn.
- Each `advance(step, ...)` function checks `current_step >= step` and skips if already done.
- The `om_contracts` insert is guarded by checking for an existing `free_amc` contract for the project first.
- Customer WhatsApp message has a `wamid` recorded in `customer_message_log` — n8n dedupes on it.

## Customer-side WhatsApp template

**Add to `infrastructure/n8n/templates.md`:** `handover_complete` (utility template).

```
Hi {{1}},

Your solar system at {{2}} is now commissioned and handed over!
Free O&M for the next 12 months — call {{3}} or WhatsApp anytime
for service. PDF handover pack: {{4}}

Thank you for choosing Shiroi Energy.
```

Variables: customer name / project address / Shiroi number / PDF signed URL.

Submitted by Vivek to Meta before workflow #49 (new) goes live.

## n8n workflow additions

**`infrastructure/n8n/workflows/49-customer-handover-delivery.json`**
- Listens for `project.commissioned` event from event bus
- Fetches customer details from Supabase REST
- Calls Meta API to send `handover_complete` template
- Logs result to `customer_message_log` with `channel='whatsapp'`, `template_name='handover_complete'`

**Update `infrastructure/n8n/workflows/00-event-bus-router.json`**
- Add Switch case for `handover.completed` (internal notification) → existing `54-vivek-notification` or similar founder-ping workflow.

## Step-by-step build plan

### Session 1 — Schema + orchestration core (3-4 hours)

- [ ] T1.1 — Write mig 139 (`handover_orchestrations` + `om_visits` if it doesn't exist + pg_cron job + pg_net call). Apply to dev. Regen types. (60 min)
- [ ] T1.2 — Implement `apps/erp/src/lib/handover-orchestration.ts` with the 9-step `runHandoverOrchestration` + `advance()` checkpoint helper. (90 min)
- [ ] T1.3 — Implement the POST route `apps/erp/src/app/api/projects/[id]/handover-run/route.ts`. (30 min)
- [ ] T1.4 — Implement the POST route `apps/erp/src/app/api/projects/[id]/handover-retry/route.ts`. (15 min)
- [ ] T1.5 — Add "Handover paused" banner + retry button on project detail page. (30 min)
- [ ] T1.6 — Add `handover_complete` template to `infrastructure/n8n/templates.md` and submit to Meta. (15 min Vivek)

### Session 2 — n8n + end-to-end + testing (3 hours)

- [ ] T2.1 — Write `infrastructure/n8n/workflows/49-customer-handover-delivery.json`. (45 min)
- [ ] T2.2 — Update `00-event-bus-router.json` to route `project.commissioned` → #49 + `handover.completed` → founder ping. (15 min)
- [ ] T2.3 — Manual test: pick a dev project, sign all required DC certs, mark net metering installed, wait for next cron tick, verify orchestration completes. (60 min)
- [ ] T2.4 — Failure recovery test: force a step to fail, verify banner + retry button work, complete the retry. (30 min)
- [ ] T2.5 — Documentation: update `docs/modules/projects.md` with the automated handover flow. (15 min)
- [ ] T2.6 — CI gates + commit + push. (15 min)

## What's already there

- ✅ `handover-pdf-actions.ts` — PDF generation
- ✅ `dc-certificate-actions.ts` — cert signing (DB-immutable after mig 137)
- ✅ `om_contracts` + `amc_category` enum
- ✅ `emitErpEvent('project.commissioned', …)` — event in ErpEventName union, router case added by today's batch
- ✅ `customer_message_log` table
- ✅ `project-files` bucket for handover PDFs

## What's new

- Migration 139 (`handover_orchestrations` + pg_cron + pg_net)
- `runHandoverOrchestration` + `advance` helpers
- 2 new API routes (`handover-run` + `handover-retry`)
- 1 new n8n workflow (#49)
- New Meta template `handover_complete`
- Banner UI on project detail
- 1 new event in ErpEventName union (`handover.completed`)

## Open questions for Vivek

1. **Should we add a new `'commissioned'` status value to the project enum, or keep using `'completed'`?** Recommend keeping `'completed'` — adding a new enum value requires migrating UI dropdowns + filter chips everywhere.
2. **Is `net_metering_submission` (3rd DC cert) required, or are `dc_completion` + `handing_over` enough?** Recommend the 2-of-3 minimum.
3. **First AMC visit at 90 days?** Or 30 / 60? Recommend 90 — matches industry convention.
4. **AMC visit type enum** — does `om_visits.visit_type` already include `'amc_first_quarter'` or do we need a new value?
5. **Customer phone source** — `projects.customer_phone` or via the related `contacts` table via `primary_contact_id`? Need to confirm which is canonical for the customer drip path.
6. **Handover paused banner role** — show to founder + project_manager only, or also site_supervisor + om_technician?

## Ready-to-execute checklist

- [ ] Vivek answers the 6 open questions above
- [ ] Meta `handover_complete` template approved
- [ ] pg_cron extension enabled on the project (it is — already used by `inverter-poll`)
- [ ] pg_net extension enabled (verify — needed for the cron → API POST)
- [ ] `N8N_WEBHOOK_SECRET` env present in app + n8n + Vercel
- [ ] After session 2: pick 1–2 commissioning-ready dev projects and force-run to validate
