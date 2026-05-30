# Automated Handover Flow — Plan — 2026-05-30

> Builds on the May 25 H2 plan (`2026-05-25-automated-handover-plan.md`) — extends it from "auto-PDF + customer WhatsApp + free AMC" into the full end-to-end handover lifecycle: gate-checks with explicit blockers, magic-link customer portal, multi-channel delivery, post-handover drip touchpoints, and ongoing O&M monitoring schedule.
> Reuses: C11 (`handover-pdf-actions.ts`), C12 (`dc-certificate-actions.ts`), F1 (workflows 40-47), F7 (`proposal_share_tokens` portal pattern), the May 25 orchestration core (`handover_orchestrations`).
> Does NOT replace the May 25 plan — that plan delivers the core mechanical run; this plan layers the customer-facing and lifecycle pieces on top.

---

## Problem statement

Project handover today is a five-step manual ritual: Manivel clicks "Generate Handover Pack" on `/projects/[id]/Certificates`, the PDF lands in `project-files/handover-packs/`, he downloads it, attaches it to a one-off WhatsApp to the customer, and verbally hands over the warranty + monitoring credentials. Three things go wrong: (1) the human gate is unreliable — handover PDFs have been generated against projects where the 3rd DC cert was unsigned or the final invoice was unraised; (2) the customer never receives a structured digital pack — just an ad-hoc forward; (3) once handed over, the customer drops off our radar — no 90-day check-in, no annual performance summary, no proactive O&M monitoring. Result: customer satisfaction degrades silently, ~₹1.5L of final-invoice receivables sit unraised on average, and free-AMC visits get scheduled reactively when the customer complains. The May 25 H2 plan addresses items 1-2 partially (orchestration + customer template + free AMC contract). This plan completes that loop and adds the post-handover lifecycle.

---

## Today's state — what's already shipped or planned

What's live (May 30):
- **C11** — `generateHandoverPackPdf(projectId)` server action renders a 3-page react-pdf, uploads to `project-files/handover-packs/<projectId>/<safe-number>-handover.pdf`, writes `projects.handover_pdf_path`, returns a 1-hour signed URL. Founder + PM only.
- **C12** — `dc_certificates` table (3 types: `dc_completion`, `handing_over`, `net_metering_submission`) with `signDcCertificate` action. DB-immutable once signed (mig 137).
- **F7** — `proposal_share_tokens` (mig 133) + `/p/[token]` public portal + `acceptProposalFromPortal` action. Secure 64-hex tokens, view counter, no-auth read using admin client. This is the magic-link precedent.
- **F1** — Workflows 40-47 (8 customer drip templates) — 47 (`customer-commissioning-complete`) is closest to what we need; 40 (`customer-proposal-sent`) shows the template-vars + log-to-customer_message_log pattern. Templates pending Meta approval.
- **Event bus** — `project.commissioned` routes through `00-event-bus-router.json` → `13-project-commissioned.json` which currently fires internal WhatsApp to finance + (disabled) customer celebration. `emitErpEvent` is fire-and-forget with 3s timeout.
- **OM contracts** — `om_contracts` with `amc_category` (`free_amc`/`paid_amc`) + `om_visit_schedules` with `visit_type` (`scheduled_quarterly`, `scheduled_annual`, `emergency`, `follow_up`).
- **Customer messages** — `customer_message_log` (mig 129) for outbound WhatsApp tracking (template_name, meta_wamid, status).

What May 25 H2 plans (not yet implemented):
- `handover_orchestrations` audit table + 9-step `runHandoverOrchestration` + `advance()` checkpoint helper.
- pg_cron polling every 15 min → POST to `/api/projects/[id]/handover-run`.
- New Meta template `handover_complete` + workflow #49.
- Paused-orchestration banner + retry button on project detail.

What this plan adds on top:
- Explicit **gate-check rubric** with named blocker reasons (so "blocked" isn't a black box).
- **Multi-channel delivery** — WhatsApp template AND email (today the May 25 plan is WhatsApp-only).
- **Customer portal extension** — `/p/[token]` already serves proposals; extend to serve handover packs with an acknowledgement button.
- **Post-handover drip** — schedule 90-day / 6-month / 12-month customer touchpoints leveraging F1 infra.
- **O&M monitoring schedule** — auto-create monthly inverter-performance-review tasks for the first 12 months.
- **Reopen flow** — admin "rollback" if the customer disputes within 7 days.

---

## Prerequisite gate logic

Eight gates evaluated when the orchestration starts (or when the cron picks up a candidate project). Each gate maps to a named blocker reason that surfaces on the project detail page when handover is paused. Truthy required; falsy = block.

| # | Check | Source table / field | Failure label | Notifies |
|---|-------|----------------------|---------------|----------|
| G1 | `project_completion_items` has 9 of 10 components marked complete (handover itself is the 10th, weight 0 — see mig 121 RPC) | `get_project_completion_pct(project_id) >= 95` | `completion_below_95` | PM (WhatsApp) |
| G2 | All required DC certs signed: `dc_completion` AND `handing_over` (and `net_metering_submission` if `ceig_scope = 'shiroi'`) | `dc_certificates` `signed_at IS NOT NULL` per type | `dc_certs_unsigned` (with list of missing types) | PM (WhatsApp) |
| G3 | Net metering done OR explicitly client-scope | `projects.status = 'meter_client_scope'` OR `net_metering_applications.discom_status IN ('installation_completed','service_effected')` | `net_metering_pending` | PM (WhatsApp) |
| G4 | Required documents uploaded: at least one each of `customer_documents` (signed contract), `invoices` (any tax_invoice for the project), `warranty_cards`, `documents_approvals` (CEIG cert / inspection report if `ceig_scope='shiroi'`) | `storage.objects` under `project-files/{projectId}/{category}/*` — categories from `documents-tab.tsx` | `documents_missing` (with list) | PM (WhatsApp) |
| G5 | Final invoice raised: at least one `invoice_type='tax_invoice'` row in `invoices` with milestone_name matching the final-milestone label, status not `cancelled` | `invoices` table | `final_invoice_unraised` | Finance (WhatsApp) |
| G6 | Customer contact reachable: `projects.customer_phone` non-null AND looks like a 10/12-digit IN number; `projects.customer_email` non-null AND valid format. If only phone, allow but log email-missing. | `projects.customer_phone`, `projects.customer_email` (fall back to `contacts` via `primary_contact_id`) | `contact_missing` | PM (WhatsApp) |
| G7 | Commissioning report finalized (not just submitted) | `commissioning_reports.status = 'finalized'` | `commissioning_not_finalized` | PM (WhatsApp) |
| G8 | Not already handed over (idempotency) | `handover_orchestrations.status = 'completed'` does not exist for this project | `already_handed_over` | none (silent skip) |

**Gate evaluation order:** G8 first (cheap), then G2/G7 (most likely to fail in early-stage projects), then G3/G5/G4, then G1/G6. Short-circuit on first failure — the customer sees one blocker at a time, the PM sees the full set in the dashboard.

**Function:** `evaluateHandoverGates(supabase, projectId) → { ready: boolean, blockers: Array<{ gate: string, label: string, details?: unknown }> }` — lives in `apps/erp/src/lib/handover-gates.ts`. Pure read; safe for the cron pre-filter AND the manual "Check handover readiness" button.

---

## DB schema (new — additive to May 25's mig 139)

May 25 already adds mig 139 with `handover_orchestrations`. This plan adds **mig 140** for the customer portal + drip + monitoring tail, plus 3 new columns on `projects` and 1 extension to `proposal_share_tokens`.

### Mig 140 outline (no SQL, just description)

**New table — `handover_runs`** (light audit log, distinct from May 25's `handover_orchestrations`; the orchestrations table stores live state for the current run, this table appends an immutable record per attempt for trend analysis):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | indexed |
| `attempt_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `gate_results` | JSONB NOT NULL | output of `evaluateHandoverGates` — full blocker list |
| `succeeded` | BOOLEAN NOT NULL | |
| `pdf_path` | TEXT | nullable — null when gates failed |
| `share_token` | TEXT | the magic-link token minted for this run |
| `sent_channels` | TEXT[] | e.g. `{whatsapp, email}` |
| `triggered_by` | TEXT NOT NULL CHECK IN ('cron', 'manual', 'retry') | |
| `error_message` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |

Index: `(project_id, attempt_at DESC)`. RLS: read = founder + project_manager + om_technician (`USING role IN (...)`); insert/update = service_role only (cron + API route).

**Extend `proposal_share_tokens`** with a type discriminator — minimal change, avoids a parallel `handover_share_tokens` table:

- Add `share_type TEXT NOT NULL DEFAULT 'proposal' CHECK (share_type IN ('proposal','handover'))`.
- Add `project_id UUID REFERENCES projects(id) ON DELETE CASCADE` (nullable — null for proposal tokens).
- Add CHECK constraint: `(share_type = 'proposal' AND proposal_id IS NOT NULL) OR (share_type = 'handover' AND project_id IS NOT NULL)`.
- Rename table in a future migration if it gets ugly; for now extension is cheapest. Existing rows backfill `share_type = 'proposal'` (default already does this).
- Update `proposal-share-actions.ts` allowed-roles list to also accept `project_manager` for handover tokens. Add a `createHandoverShareToken(projectId, expiresInDays=90)` companion. Default 90-day expiry (vs 30 for proposals) — handover packs are reference docs, not time-bounded offers.

**Extend `projects`** with three columns:

- `handover_status TEXT DEFAULT 'not_started' CHECK IN ('not_started','blocked','generated','sent','acknowledged','closed','disputed')` — independent of `projects.status` (which is the workflow enum). `handover_status` tracks the post-commissioning customer-side state.
- `handover_completed_at TIMESTAMPTZ` — set on transition to `closed`.
- `handover_acknowledged_at TIMESTAMPTZ` — set when customer clicks the portal acknowledgement button.

**State transitions for `handover_status`:**

```
not_started → blocked (gates fail)
not_started → generated (PDF render succeeds)
blocked → generated (manual retry after blocker fixed)
generated → sent (WhatsApp + email queued + meta_wamid recorded)
sent → acknowledged (customer clicks acknowledgement button in /p/[token])
acknowledged → closed (admin closes — or auto after 30 days)
sent → disputed (customer flags via portal "I have an issue" link in first 7 days)
disputed → not_started (admin reopens project)
```

**Indexes added in mig 140:**
- `handover_runs(project_id, attempt_at DESC)`
- `handover_runs(succeeded) WHERE succeeded = FALSE` (partial — blocker dashboard query)
- `projects(handover_status) WHERE handover_status IN ('sent','generated')` (partial — dashboard active list)
- `proposal_share_tokens(share_type, project_id)` (composite for handover token lookups)

**RLS sketch:**
- `handover_runs` — read = founder/PM/om_technician, write = service_role only.
- `proposal_share_tokens` — no RLS (existing pattern: admin client only). The share-actions.ts already enforces role per share_type.
- `projects.handover_status` — readable by anyone who can read projects (existing RLS). Update gated by the orchestration runner (service_role) or admin actions for reopen.

---

## Event flow (text sequence diagram)

```
[ERP] User finalizes commissioning report
   ↓
[ERP] commissioning-actions.ts emitErpEvent('project.commissioned', { project_id, customer_name, customer_phone, system_size_kwp, ... })
   ↓
[n8n 00-event-bus-router] Switch on event = project.commissioned
   ↓
[n8n 13-project-commissioned] (existing) → internal WhatsApp ping to finance + Manivel
   ↓
   AND IN PARALLEL via the same router cron
   ↓
[Supabase pg_cron, every 15 min] handover-orchestration-scan (from May 25 mig 139)
   ↓ finds projects matching gates G1-G8
   ↓ inserts row into handover_orchestrations
   ↓ pg_net POST to /api/projects/{id}/handover-run with x-webhook-secret
   ↓
[ERP /api/projects/{id}/handover-run] runHandoverOrchestration(projectId, orchestrationId)
   ↓ Step 1: evaluateHandoverGates() — DEFENSIVE recheck
   ├─ IF FAIL: write handover_runs (succeeded=false, gate_results), update projects.handover_status='blocked',
   │           emit handover.blocked event → n8n 90-handover-blocker-notify → PM WhatsApp with named blockers
   │           + create blocker task in `tasks` table (entity_type='project', entity_id=projectId, title="Handover blocked: <reasons>")
   └─ IF PASS: continue
   ↓ Step 2-3: generateHandoverPackPdf() — reuse existing C11 path, verify upload via signed URL HEAD
   ↓ Step 4: createHandoverShareToken(projectId, 90) → mint token via extended proposal_share_tokens insert
   ↓ Step 5: emitErpEvent('handover.ready_to_send', { project_id, pdf_storage_path, share_token, customer_phone, customer_email })
   ↓ Step 6: flip projects.handover_status = 'sent'
   ↓ Step 7: create free_amc om_contract (existing May 25 step)
   ↓ Step 8: emitErpEvent('handover.post_drip_schedule', { project_id, commissioned_at }) → workflow 92
   ↓ Step 9: emitErpEvent('handover.om_schedule_create', { project_id }) → workflow 93
   ↓ Step 10: write handover_runs (succeeded=true, sent_channels=['whatsapp','email'])
   ↓
[n8n 91-customer-handover-dispatcher] Listens for handover.ready_to_send
   ├─ Branch A: Meta WhatsApp API → handover_complete template
   │           variables: customer_name, system_size, shiroi_phone, portal_url (= ERP_URL + /p/ + token)
   │           on success: insert into customer_message_log (template_name, meta_wamid, status='sent')
   └─ Branch B: SMTP send via existing notification credential → handover_email_v1 HTML template
               subject: "Your solar plant handover pack — {{customer_name}}"
               body: portal link + PDF attachment (signed URL valid 7 days, regenerated nightly via workflow 92)
               on success: insert into customer_message_log with template_name='handover_email_v1', channel='email'
   ↓
[Customer] Receives WhatsApp + email
   ↓ Clicks portal link → /p/{token}
   ↓
[ERP /p/[token]/page.tsx] Token lookup (admin client)
   ├─ IF share_type = 'proposal': existing proposal view
   └─ IF share_type = 'handover': HandoverPortalClient
       - Renders handover pack PDF inline (iframe to /p/{token}/pdf/route.ts)
       - Shows system summary, warranty grid, emergency contact, "Download PDF" button
       - "I acknowledge receipt" button + optional satisfaction rating (1-5)
       - "I have an issue" button (creates dispute, opens free-text)
   ↓
[Customer clicks acknowledge]
   ↓ acknowledgeHandoverFromPortal(token, rating?) — admin client, no auth
   ↓ updates projects.handover_status = 'acknowledged' + handover_acknowledged_at
   ↓ inserts into handover_acknowledgements table (token, rating, ip, ua, ts)
   ↓ emitErpEvent('handover.acknowledged', { project_id, rating })
   ↓
[n8n 91 acknowledged branch] → internal WhatsApp to PM + founder: "Customer X acknowledged handover. Rating: 5/5"
```

---

## n8n workflows needed

Numbered to fit the existing convention (40-49 reserved for customer drip; 50-69 for ops; we go 90+ for handover-specific because >47 collides with `47-customer-commissioning-complete`).

- **`90-handover-blocker-notify.json`** — listens for `handover.blocked` event. Fetches PM's WhatsApp from `employees` table via REST. Sends WhatsApp template `handover_blocked_v1` with body listing the named blockers (G1-G8 labels). Creates a row in `tasks` table via REST with `entity_type='project'`, `entity_id={project_id}`, `title="Handover blocked: <reasons>"`, `priority='high'`, `due_date=today+2d`. Idempotent — checks `tasks` first for an existing open task on the same project with title prefix "Handover blocked:" before creating a duplicate.

- **`91-customer-handover-dispatcher.json`** — listens for `handover.ready_to_send`. Two parallel branches (WhatsApp + email), both log to `customer_message_log`. Failure on either branch enqueues into a retry queue (`message_retry_queue` — reuse existing if present, else simple table with `next_retry_at`).

- **`92-handover-post-drip-scheduler.json`** — listens for `handover.post_drip_schedule`. Schedules three future executions via n8n's wait+resume pattern OR inserts three rows into a new `scheduled_customer_messages` table that another cron polls daily:
  - +90 days: send `customer_3month_checkin_v1` (template not yet in F1 — new, 9th template)
  - +180 days: send `customer_6month_summary_v1` (new, 10th template — first generation summary)
  - +365 days: trigger workflow `46-customer-annual-checkup` (existing F1)

- **`93-handover-om-schedule.json`** — listens for `handover.om_schedule_create`. Creates 12 monthly `om_visit_schedules` rows (visit_type='scheduled_quarterly' for months 3/6/9/12; for the other 8 months, creates rows in a new lightweight `om_monitoring_tasks` table — see "O&M monitoring schedule" below). Idempotent on `(project_id, scheduled_date)`.

- **Update `00-event-bus-router.json`** — add Switch cases for: `handover.blocked` → 90, `handover.ready_to_send` → 91, `handover.post_drip_schedule` → 92, `handover.om_schedule_create` → 93, `handover.acknowledged` → 91 (acknowledged branch), `handover.disputed` → new `94-handover-disputed.json` (paging Vivek immediately).

Total new workflows: 5 (90, 91, 92, 93, 94). May 25's planned #49 is replaced by #91 (cleaner naming) — note this consolidation in the May 25 plan when implementing.

---

## Customer portal extension

The `/p/[token]` page already runs unauthenticated via the admin client. Three changes to support handover packs:

1. **`apps/erp/src/app/(public)/p/[token]/page.tsx`** — after the token lookup, branch on `shareToken.share_type`:
   - `'proposal'` → existing `ProposalPortalClient` (no change).
   - `'handover'` → new `HandoverPortalClient` rendering project summary, warranty grid, PDF embed.
2. **`apps/erp/src/app/(public)/p/[token]/pdf/route.ts`** — already exists for proposals. Extend to fetch the handover PDF when `share_type='handover'`: serve `project-files/handover-packs/{projectId}/{safeNumber}-handover.pdf` as `application/pdf` inline. Reuse the 7-day signed URL refresh pattern.
3. **`apps/erp/src/lib/handover-share-actions.ts`** — new file with:
   - `createHandoverShareToken(projectId, expiresInDays=90)` — gated to `project_manager` + `founder` roles (uses the regular client for auth check, then admin client for insert).
   - `acknowledgeHandoverFromPortal(token, rating?)` — admin client, no auth. Validates token → flips `projects.handover_status='acknowledged'` (CAS guard: only from `'sent'`) → inserts into new `handover_acknowledgements` table → emits `handover.acknowledged`.
   - `disputeHandoverFromPortal(token, reason)` — same pattern, but flips status to `'disputed'`, inserts into `handover_disputes` table with the reason text, emits `handover.disputed`.

**View-counter reuse:** `proposal_share_tokens` already has `viewed_count`, `last_viewed_at`, `last_viewed_ip`. Handover tokens inherit this for free.

**New tiny tables (in mig 140):**
- `handover_acknowledgements` — id PK, token TEXT FK to proposal_share_tokens.token, project_id, rating INT CHECK (1-5), comment TEXT, ip_address TEXT, user_agent TEXT, acknowledged_at TIMESTAMPTZ.
- `handover_disputes` — id PK, token, project_id, reason TEXT NOT NULL, ip, ua, disputed_at, resolved_at, resolved_by, resolution_notes.

---

## Failure handling

Five failure classes, each with a defined recovery path:

1. **Gate failure (G1-G8).** Non-error condition. `handover_runs.succeeded=false`, blocker list written to `gate_results` JSONB. Orchestration row marked `status='blocked'`. PM gets WhatsApp via workflow 90 with the named blockers + a deep link to `/projects/{id}?tab=completion`. A blocker task is created in `tasks` table. Next cron tick re-checks; if blockers cleared, runs through. PM can manually click "Re-check handover readiness" button on project detail (calls the same `evaluateHandoverGates` action).

2. **PDF generation failure (Step 2 throws).** Retry once with 30s delay (inside `runHandoverOrchestration`). On second failure, mark orchestration `status='paused_error'`, set `error_message = "PDF render failed: <msg>"`, page Vivek via existing Sentry hook + WhatsApp. The May 25 retry button on project detail covers this.

3. **Share-token mint failure (Step 4).** Rare — only fails on unique constraint collision (statistically impossible with 256-bit tokens). Retry with fresh token. On second failure: page Vivek.

4. **Send failure — WhatsApp or email (n8n workflow 91).** Each branch logs to `customer_message_log` with `status='failed'` + `failed_reason`. The orchestration itself does NOT roll back (we're at-least-once for sends, customer already has the portal link from whichever channel succeeded). A daily cron (`message-retry-cron`, reuse the existing payment-followup cron infra) scans `customer_message_log WHERE status='failed' AND created_at > now()-interval '24h'` and retries with exponential backoff (1h / 4h / 24h). After 3 retries on a single message, write a `tasks` row for PM to manually contact the customer.

5. **Customer disputes within 7 days.** Customer hits the "I have an issue" button on `/p/{token}`. Flips `handover_status='disputed'`, fires `handover.disputed` event → workflow 94 pages Vivek + Manivel immediately + creates high-priority `tasks` row with the dispute reason. Admin can then click "Reopen project" on detail page (see Rollback below).

Catch-all: any unhandled throw inside the orchestration writes to `handover_orchestrations.error_message` and to `handover_runs` with `succeeded=false`, error_message populated. Sentry captures via existing instrumentation.

---

## Rollback story

Two distinct rollback paths, both founder-only:

**Soft reopen** (customer dispute, mistake, scope creep):
- Button on `/projects/{id}` header: "Reopen handover" (only visible when `handover_status IN ('sent','acknowledged','disputed','closed')`).
- Action: `reopenHandover(projectId, reason)` in `handover-actions.ts`.
- Effect: flips `handover_status='not_started'`, sets `projects.status` back to `in_progress` (or `completed` if commissioning is preserved), writes a row to `handover_runs` with `succeeded=false, error_message="reopened: <reason>"`, voids the share token (extend mig 140: add `revoked_at` to `proposal_share_tokens`), fires `handover.reopened` event → notifies customer via WhatsApp ("We're investigating your issue and will be in touch.").
- Free AMC contract: paused (new `om_contracts.paused_at` column) rather than deleted — so days don't tick down during the dispute.
- Drip touchpoints scheduled in workflow 92: cancelled via update on `scheduled_customer_messages.status='cancelled'`.

**Hard reset** (admin debugging, double-trigger artifact):
- CLI-only via `scripts/handover-hard-reset.ts` — service-role direct. Deletes the `handover_orchestrations` row, leaves `handover_runs` (audit). For developers, never customer-facing.

---

## Phase breakdown

Each phase is independently shippable. Each ends with a working end-to-end test on at least one real project.

### P1 — Gate checker only (read-only surfacing — no auto-send)

Goal: Manivel can see which projects are "ready" without anything actually firing. Builds the gate logic + the dashboard surface.

- Build `evaluateHandoverGates` + `handover-gates.ts`. Pure function, no DB writes.
- Mig 140 partial: add `handover_status` + `handover_completed_at` + `handover_acknowledged_at` to `projects`. Add `handover_runs` table. **Do NOT add cron yet.**
- New dashboard widget on `/projects` list: "Handover readiness" filter chip — shows projects with `status='completed'` AND `handover_status='not_started'`, with a per-project badge ("Ready" / "Blocked: G3, G5"). Calls `evaluateHandoverGates` per row (acceptable — N is small, <20 active projects at a time).
- "Re-check handover" button on `/projects/[id]` Certificates tab — runs `evaluateHandoverGates` synchronously, shows blockers inline with deep links to fix each (e.g. G2 → Certificates tab section anchor, G5 → /finance/invoices/new?project_id=).
- Nightly cron (separate from May 25's mig 139): runs `evaluateHandoverGates` against every `status='completed'` project, writes a snapshot row to `handover_runs` with `succeeded=false, triggered_by='cron'` if blocked. Surfaces in a new daily digest section.

Ships independently. No customer-facing change. Two weeks safe-mode observation before P2.

### P2 — Auto-PDF + portal mint + email (no WhatsApp yet)

Goal: when gates pass, the PDF is generated, the portal token is minted, the customer gets an email. WhatsApp is held back until Meta templates approved.

- Mig 140 full: add `share_type` + `project_id` to `proposal_share_tokens`, the two new ack/dispute tables, the `revoked_at` column.
- Implement the May 25 mig 139 orchestration core (`handover_orchestrations`, `runHandoverOrchestration`, `advance()`). Wire to existing C11 action (Steps 1-3).
- Add Step 4 (createHandoverShareToken). Extend `proposal-share-actions.ts` with the handover variant. Update allowed-roles + the `share_type` discriminator.
- Implement `/p/[token]/page.tsx` handover branch + `HandoverPortalClient` + `/pdf/route.ts` handover branch.
- Implement email-only send path: SMTP via existing notification cred. Template `handover_email_v1` (HTML, with brand header pulled from `docs/design/brand-guide.html`). Log to `customer_message_log` with `channel='email'`.
- pg_cron job (from May 25 mig 139) enabled, polling every 15 min. **Customer phone gate G6 only requires email at this phase — phone optional.**
- Acknowledgement flow live. Customer can click "I have an issue" but no dispute notification yet (just records).
- Test on 2 real recently-commissioned projects. Confirm email lands, portal loads, ack button works.

### P3 — Multichannel + WhatsApp templates

Goal: add WhatsApp send via Meta + dispute notification.

- Submit `handover_complete` (utility) + `handover_blocked_v1` (internal alert) + `handover_disputed_v1` (internal alert) templates to Meta. Wait for approval (typical 24-48h).
- Build n8n workflows 90 (blocker notify), 91 (customer dispatcher — both branches), 94 (dispute notify).
- Update `00-event-bus-router.json` with the 5 new event routes.
- Enable G6 phone-required gate.
- Test on 2 more projects. Confirm WhatsApp + email both land, message log records both, dispute path pages Vivek.

### P4 — Post-handover drip + O&M monitoring schedule

Goal: customer touchpoints continue automatically for 12 months; O&M team gets monthly review tasks.

- Submit `customer_3month_checkin_v1`, `customer_6month_summary_v1` templates to Meta.
- Build workflow 92 (drip scheduler). Implement `scheduled_customer_messages` table + the daily-poll cron.
- Build workflow 93 (O&M monitoring). New table `om_monitoring_tasks` (id, project_id, scheduled_date, status, assigned_to, completed_at, notes) — or extend `om_visit_schedules` with `visit_type='monitoring_review'`. The latter is simpler — pick that.
- 6-month summary requires the monthly-performance-report AI feature (separate roadmap item — Wave 4 AI plan). For now stub the template with generic copy; wire the real AI summary in a follow-up.
- Test: pick a project handed-over in P3, manually fire `handover.post_drip_schedule`, confirm 3 future-dated rows in `scheduled_customer_messages` + 4 quarterly + 8 monthly OM rows.

---

## Dispatch-ready agent tasks per phase

### P1 (3 tasks)

- **P1-T1 (60 min)** — write `apps/erp/src/lib/handover-gates.ts` with `evaluateHandoverGates(supabase, projectId)` returning `{ ready, blockers }`. Cover G1-G8. Pure read, no writes. Include unit-test-style assertions in a sibling `.test.ts` (vitest pattern from existing tests). Add types from `Database['public']['Tables']` — no `any`.
- **P1-T2 (90 min)** — write mig 140 partial (just the `projects` columns + `handover_runs` table). Apply to dev. Regenerate types via the MCP tool + strip-view-fk script. Build the `/projects` list filter chip + the `/projects/[id]` re-check button. Wire it to `evaluateHandoverGates`.
- **P1-T3 (45 min)** — nightly cron via pg_cron (separate function, NOT the May 25 polling). Writes `handover_runs` snapshots. Surfaces in `19-vivek-daily-7am.json` digest as a new "Handover-blocked projects" section. Test with one known-blocked project.

### P2 (4 tasks)

- **P2-T1 (75 min)** — mig 140 remainder (share_token extensions + ack/dispute/revoke tables). Regenerate types. Backfill existing `proposal_share_tokens.share_type='proposal'` via migration UPDATE.
- **P2-T2 (120 min)** — `apps/erp/src/lib/handover-orchestration.ts` (May 25 spec) + `apps/erp/src/lib/handover-share-actions.ts` (new) + `/api/projects/[id]/handover-run/route.ts` + `/handover-retry/route.ts` + pg_cron job from May 25 mig 139.
- **P2-T3 (90 min)** — `/p/[token]/page.tsx` branch + `HandoverPortalClient` + PDF route extension. Test that proposal tokens still render correctly (regression check).
- **P2-T4 (60 min)** — email send branch. Reuse existing SMTP cred. Template `handover_email_v1`. End-to-end test on a dev project.

### P3 (3 tasks)

- **P3-T1 (90 min)** — write 3 n8n workflows (90, 91, 94) + update event-bus-router. Test each via manual event emit from a console script.
- **P3-T2 (30 min)** — submit Meta templates (Vivek does this — agent prepares the wording in `infrastructure/n8n/templates.md`).
- **P3-T3 (60 min)** — end-to-end test on a fresh project. Validate WhatsApp + email both arrive, dispute path pages Vivek.

### P4 (3 tasks)

- **P4-T1 (75 min)** — `scheduled_customer_messages` table + daily poll cron + workflow 92. Two new Meta templates submitted (Vivek does the Meta side).
- **P4-T2 (45 min)** — workflow 93 + `om_visit_schedules` insert of 12 rows with `visit_type='monitoring_review'`. Idempotent on `(project_id, scheduled_date)`.
- **P4-T3 (30 min)** — end-to-end test: pick a project, force-fire the events, verify drip + OM rows present + scheduled correctly.

---

## Open questions for Vivek

1. **Exact required-document categories for G4.** Today we plan to require: `customer_documents` (signed contract), `invoices` (any tax invoice), `warranty_cards`, `documents_approvals` (CEIG/inspection if `ceig_scope='shiroi'`). Should we also require `layouts_designs` (final AS-built) and the commissioning report PDF? Manivel may push back if older projects don't have all of these uploaded — back-compat flag?
2. **Final invoice — auto-raise or just nudge finance?** Current plan: nudge finance via existing `13-project-commissioned.json` WhatsApp + block handover until invoice raised. Alternative: trigger an auto-create-draft-invoice action with the final-milestone amount pulled from `proposal_payment_schedule`, leave it for finance to send. Auto-create reduces friction but risks wrong amounts.
3. **Customer acknowledgement required to flip 'sent' → 'closed', or auto-close after N days?** Recommend auto-close after 30 days from `sent_at` if no ack and no dispute — keeps the project lifecycle moving. Manual override possible.
4. **Post-handover drip cadence — confirm intervals.** Plan: +90d (check-in), +180d (6-month performance summary), +365d (annual checkup via existing workflow 46). Should we add +30d (settling-in check)? Industry default is yes, but adds template count + Meta approval cycle.
5. **Customer satisfaction survey embedded in portal — yes / no.** Plan: simple 1-5 star rating on the acknowledgement button + optional comment. Or a separate full survey (NPS, support quality, install experience)? Latter is more useful but adds friction; could split into "ack now" + "survey emailed at +30d."
6. **`ceig_scope='client'` projects — gate G2 should require which DC certs?** Today we'd require `dc_completion` + `handing_over` and skip `net_metering_submission` when scope=client. Confirm.
7. **Reopen 7-day window — is 7 days right?** Customer rarely catches issues within 7. Plan to make it 30 days post-acknowledgement (or unlimited if never acknowledged), with the "I have an issue" link always present on the portal. Confirm.
8. **Email template — branded HTML or plain text?** Plan: branded HTML using `docs/design/brand-guide.html` palette + inline CSS + PNG logo from Storage. Plain-text fallback for Gmail dark-mode quirks. Vivek's call on whether brand investment is warranted here.
9. **Drip messages — should they include the customer's actual generation data?** Requires inverter data integration (already shipped in `inverter-adapters/`). 6-month summary becomes much stronger with "you generated X kWh, saved Y kg CO2". Tie-in to AI Wave 4 roadmap.
10. **O&M monitoring task assignee.** Auto-assign to the project's `site_supervisor`? Or always to OM head (`role='om_technician'`)? Current OM module pattern: assigned to `om_technician` by default with PM as escalation.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| False-positive gate pass — handover fires on an incomplete project | High (reputation + invoice loss) | P1 shadow-mode runs nightly for 2 weeks before P2 enables sends. Gate logic has unit tests + Manivel reviews each P1 snapshot for first 50 runs. |
| Customer never opens portal (low engagement) | Medium (lost touchpoint) | Email + WhatsApp both link to portal — at least one usually opens. Track `viewed_count`; if zero at +14d, fire an internal nudge to PM to follow up by phone. |
| Spammy drip cadence — customer reports as spam to Meta | High (Meta penalizes WABA number) | Templates are "utility" category (transactional), not "marketing." Customer can opt-out per message. Cap at the 3 planned touchpoints — no upsell. |
| Email goes to spam (Gmail filtering) | Medium | Use existing transactional sender domain (must be configured in DNS — SPF/DKIM/DMARC). Track open rate via tracking pixel; if <30%, switch to dedicated transactional provider (SendGrid/Postmark). |
| Meta template approval delays P3 | Medium (blocks WhatsApp send) | Submit templates during P1/P2 build so they're ready when P3 lands. Have email-only fallback for any customer where WhatsApp template rejected. |
| Race condition: PM signs the last DC cert just as cron evaluates → orchestration starts before commissioning report finalized | Low | Idempotency check (G7 + G8) on every step. The 15-min cron interval is wide enough that the race is rare; defensive recheck inside `runHandoverOrchestration` catches it. |
| Customer disputes after `handover_status='closed'` | Low | "I have an issue" link present indefinitely on portal. Founder can manually reopen even after close — `handover_status='closed' → 'disputed' → 'not_started'` path is allowed. |
| `proposal_share_tokens` discriminator approach gets ugly as a third use-case is added | Low | Acceptable for v1. Refactor to a dedicated `share_tokens` table with polymorphic FK (target_type + target_id) when we add a third type (e.g. invoice sharing). Tracked as a follow-up. |
| pg_cron + pg_net race on Supabase dev branch refresh — cron continues firing against stale function definitions | Low | All function definitions in mig 140 use `CREATE OR REPLACE` semantics; cron job re-resolves on each tick. |

---

## Dependencies & cross-references

- **Builds on:** `docs/superpowers/plans/2026-05-25-automated-handover-plan.md` — implement that first (it provides mig 139 + orchestration core). This plan is the layer above.
- **Coordinates with:** `docs/superpowers/plans/2026-05-25-ai-roadmap-plan.md` — Wave 4 monthly performance report feeds the 6-month drip summary.
- **Reuses:** C11 (`handover-pdf-actions.ts`), C12 (`dc-certificate-actions.ts`), F1 workflows 40-47, F7 (`proposal_share_tokens` + `/p/[token]`), `customer_message_log` (mig 129), `tasks` table (universal entity model).
- **Files added (estimate):**
  - 3 new server-action files (`handover-gates.ts`, `handover-share-actions.ts`, extension to `handover-actions.ts` for reopen).
  - 1 new client component (`HandoverPortalClient`).
  - 1 new API route extension (`/p/[token]/pdf/route.ts` handover branch).
  - 5 n8n workflow JSONs (90, 91, 92, 93, 94).
  - 1 migration (mig 140).
  - 3 new Meta templates (`handover_email_v1` is email so doesn't count; `customer_3month_checkin_v1`, `customer_6month_summary_v1`, `handover_blocked_v1`, `handover_disputed_v1` — 4 WhatsApp templates).
- **Estimated total dev time:** P1 ≈ 4h, P2 ≈ 6h, P3 ≈ 3h + Meta wait, P4 ≈ 3h + Meta wait. ~16h coding + ~3-5 days Meta-template wait windows.

---

*Plan owner: Vivek. Drafted 2026-05-30 by Claude Code. Do not implement before May 25 H2 plan ships — this plan assumes mig 139 + `handover_orchestrations` exist.*
