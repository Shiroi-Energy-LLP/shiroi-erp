# Site Engineer Questions — Shiroi ERP

> Quick-reference FAQ for site engineers (`project_manager`, `om_technician`).
> The same Q&A content seeds the AI assistant via `scripts/seed-site-engineer-faq.ts`
> (see `rag_chunks` source_path `docs/training/site-engineer-faq.md`).
>
> Companion learning module — single quiz row in `learning_modules` titled
> "Project Execution & Operations — Shiroi ERP" — is seeded by
> `scripts/seed-site-engineer-training.ts`.

---

## Contents

- [Attendance](#attendance) (6)
- [Leave](#leave) (6)
- [Project Milestones](#project-milestones) (5)
- [Photos & GPS](#photos--gps) (6)
- [Documents & Storage](#documents--storage) (4)
- [Completion %](#completion-) (5)
- [Handover Pack](#handover-pack) (4)
- [DC Certificates](#dc-certificates) (3)
- [Cut-Length Tracking](#cut-length-tracking) (3)
- [O&M Tickets](#om-tickets) (4)
- [Inverters & Plant Monitoring](#inverters--plant-monitoring) (4)
- [Profile](#profile) (notes)

Total: **50 Q&A pairs**.

---

## Attendance

Screen: `/hr/attendance`. Mark statuses live in the `attendance` table
(mig 120 + mig 136 — see `apps/erp/src/lib/hr-actions.ts:202` for the
server action).

### How do I mark today's attendance?

Open `/hr/attendance`, find your row, click today's cell, and pick
`present`, `work_from_home`, or `half_day`. You can only self-mark those
three statuses; the system blocks `absent` and `on_leave` for self-mark
by RLS.

### Why can't I mark myself absent?

Migration 136 added a CHECK on the `attendance_insert` RLS policy that
restricts employee self-mark to `present`, `work_from_home`, and
`half_day`. `absent` goes through HR; `on_leave` must come from an
approved `leave_request`.

### I forgot to mark attendance for a day last week — can I add it now?

Yes — click the empty cell for that date in `/hr/attendance` and pick
one of the self-mark statuses. If the day should be `absent` or
`on_leave`, ask HR or the founder to mark it for you.

### What does "WFH" mean in the legend?

`WFH` is the short label for status `work_from_home`. You'll also see
`P` (present), `A` (absent), `L` (on_leave), `½` (half_day), and `H`
(holiday).

### How is my monthly attendance % calculated?

In `/hr/attendance` the right-most column shows P% for the month =
`(present + work_from_home + half_day × 0.5) ÷ total_marked_days × 100`.
It's greyed out until at least one day is marked.

### Can someone else mark attendance for me?

Only HR (`hr_manager` role) or the founder can mark attendance for
another employee, and only they can use any status. Everyone else is
locked to self-mark with the three "I'm at work" statuses.

---

## Leave

Screen: `/hr/leave` (HR manager view) and the request form on your
employee page. Schema: `leave_requests`, `leave_ledger`,
`leave_balances` (mig 005b + mig 136).

### How do I request leave for tomorrow?

Go to `/hr/leave` (or the leave request form on your employee page),
pick the `leave_type` (`casual`, `sick`, `earned`, etc.), set
`from_date` and `to_date`, and submit. The status starts at `pending`
and HR / founder approves it.

### Where do I see my leave balance?

Your own balance shows on `/hr/employees/[your-id]` (or wherever the
dashboard surfaces `get_leave_balances_for_employee`). The number per
type — casual, sick, earned, comp off — is read from `leave_balances`,
which is auto-refreshed by trigger after every ledger entry.

### How is leave taken from my balance?

When HR approves your request, `fn_approve_leave_request` RPC runs
atomically: it updates the `leave_request` row to `approved`, inserts a
`debit` entry in `leave_ledger` with `days` as negative, and the
`refresh_leave_balance` trigger updates `leave_balances`. Nothing is
computed at read time.

### Can I cancel my own leave request?

Yes — if the request is still `pending`, click Cancel.
`cancelLeaveRequest` verifies you own the request and that
`status === 'pending'` before flipping it to `cancelled`. Once it's
approved, only HR can reverse it.

### My manager rejected my leave. Where do I see why?

The `rejected_reason` text is stored on the `leave_requests` row when
HR/founder rejects it (a reason is required by `rejectLeaveRequest`).
It shows in the list at `/hr/leave/all` under your request row.

### What's the difference between leave_ledger and leave_balances?

`leave_ledger` is the double-entry source of truth — immutable rows for
`opening_balance`, `accrual`, `debit`, `reversal`, `adjustment`,
`lapse`, `encashment`. `leave_balances` is a per-employee-per-type
summary refreshed from the ledger by trigger. Disputes are resolved by
reading the ledger, never by editing `leave_balances`.

---

## Project Milestones

Screen: `/projects/[id]` → Execution tab. Schema: `project_milestones`
(mig 004a) with `milestone_status` enum (mig 004a:45).

### How do I mark a project milestone complete?

Open the project (`/projects/[id]`), go to the Execution tab, find the
milestone row, and toggle the status field from `in_progress` →
`completed`. The five status values are
`pending / in_progress / completed / blocked / skipped`
(`milestone_status` enum, mig 004a).

### What happens when I mark commissioning as finalized?

Two things fire automatically:
1. `fn_sync_plant_monitoring_from_commissioning` upserts
   `plant_monitoring_credentials` when status becomes
   `submitted`/`finalized` and the 3 monitoring fields are filled.
2. The first **Free AMC** contract is auto-created with 3 scheduled
   visits.

### Why are some milestones marked "payment gate"?

`is_payment_gate = true` on a `project_milestones` row means completing
that milestone unlocks an invoice. Gate 1 = `material_delivery`
(40% invoice), Gate 2 = mid-installation PM visit,
Gate 3 = pre-commissioning QC (commissioning invoice 20%).

### My milestone says "blocked" — what do I do?

Open the milestone in `/projects/[id]/Execution` and read
`blocked_reason` and `blocked_since` on the row. Resolve the issue
(e.g. customer payment, material arrival, weather) and toggle status
back to `in_progress` so the gate doesn't hold up downstream work.

### How do I see all 9 standard milestones for a project?

On `/projects/[id]/Execution` you'll see `project_milestones` rows (one
per CHECK value: `advance_payment`, `material_delivery`,
`structure_installation`, `panel_installation`, `electrical_work`,
`testing_commissioning`, `civil_work`, `net_metering`, `handover`).
They're auto-seeded when the project is created from an accepted
proposal.

---

## Photos & GPS

Server action: `uploadMilestonePhoto` at
`apps/erp/src/lib/milestone-photos-actions.ts`. Schema:
`milestone_photos` (mig 127) + `haversine_distance_m` SQL function.

### How do I upload a site photo?

Use the milestone photo uploader on the project detail page. Pick the
milestone (`panel_install_start`, `panel_install_complete`,
`inverter_install`, `commissioning`, `post_commissioning`), allow
browser geolocation, and select the file. `uploadMilestonePhoto` stores
it under `documents/milestone-photos/{project_number}/{milestone}/`.

### Why does the photo upload say location too far?

The server compares your phone's GPS coordinates to the project's
`site_latitude` / `site_longitude` using `haversine_distance_m` (SQL
function added in mig 127). If the distance is **> 100 m**,
`location_verified` is set to `false` and you get a warning. The photo
still saves so field conditions don't block you.

### What does the GPS gate check?

It compares two lat/lon pairs: the project's `site_latitude` /
`site_longitude` and the photo's `latitude` / `longitude` (from the
browser geolocation API). `haversine_distance_m` returns the
great-circle distance in metres; > 100 m fails the gate.

### My phone has GPS off. Can I still upload?

Yes — `uploadMilestonePhoto` accepts `null` latitude / longitude. In
that case `location_verified` is `null` (not `false`) and
`location_distance_m` is `null`. The photo uploads to documents bucket
and the `milestone_photos` row is created.

### Which milestones can I upload photos for?

Five: `panel_install_start`, `panel_install_complete`,
`inverter_install`, `commissioning`, `post_commissioning`. These come
from the `milestone_photos.milestone` CHECK constraint in mig 127.
`getMissingMilestones` tells you which of the five are still missing
for a project.

### Where are the milestone photos stored?

In Supabase Storage, in the `documents` bucket, at path
`documents/milestone-photos/{project_number}/{milestone}/{uuid}.{ext}`.
The DB row in `milestone_photos` has the `storage_path`; never the file
bytes (NEVER-DO rule #7).

---

## Documents & Storage

Screen: `/projects/[id]` → Documents tab. 20+ document categories defined
in `apps/erp/src/lib/documents-constants.ts`. Buckets: `project-files`,
`site-photos`, `documents`.

### How do I upload a project document?

Open `/projects/[id]`, go to the Documents tab, and drag-drop the file
into the right category card (Site Photo, Survey Report, Roof Layout,
Proposal PDF, Invoice, etc.). It uploads to the `project-files` or
`site-photos` bucket; the DB only stores the storage path.

### I dragged a PDF into the wrong category — can I move it?

Yes — drag-drop to the new category. The Documents tab uses Supabase
Storage `.move()` to recategorise (which is an UPDATE on
`storage.objects`). If you see "Object not found" it usually means the
UPDATE RLS policy is missing — that was fixed in mig 047
(`project-files`) and mig 054 (`site-photos`).

### What file types can I upload to a project?

The Documents tab accepts the common ones: PDF, JPG/JPEG, PNG, DWG,
DXF, XLSX, CSV. Files go to the `project-files` bucket for paperwork
and `site-photos` bucket for images (QC photos always go to
`site-photos` under `projects/{id}/qc/`).

### Where is the file actually stored once I upload?

Supabase Storage. The DB row only has a path string (NEVER-DO rule #7).
- `project-files/{whatever-path}` — most documents
- `site-photos/projects/{id}/qc/{section}_{ts}.{ext}` — QC photos
- `documents/milestone-photos/{project_number}/{milestone}/` —
  milestone photos

---

## Completion %

Screen: `/projects/[id]?tab=completion` (Progress tab). Schema:
`project_completion_items` (mig 121) + `get_project_completion_pct`
RPC. Constants mirrored in
`apps/erp/src/lib/project-completion-constants.ts`.

### What does completion % include?

Ten components on the Progress tab (`project_completion_items`),
weighted:

| Component               | Weight |
|-------------------------|-------:|
| panel_installation      | 25     |
| structure_mounting      | 20     |
| inverter_installation   | 15     |
| dc_wiring               | 10     |
| ac_wiring               | 10     |
| site_preparation        | 5      |
| earthing                | 5      |
| net_metering_applied    | 5      |
| commissioning           | 5      |
| handover                | 0      |
| **Total**               | **95** |

Sums to 95 + handover (marker only).

### I ticked everything but the bar shows 95%, not 100%. Why?

Handover has weight 0 — it's a milestone marker, not a weighted
component. The other 9 sum to 95. The `get_project_completion_pct` RPC
is intentionally capped at 95 once everything else is done; "100%" was
deliberately not modelled, because handover is qualitative.

### Who can tick completion items?

`founder`, `project_manager`, and `site_supervisor` — see the
`completion_items_insert` / `completion_items_update` RLS policies in
mig 121. Everyone authenticated can read; only those three can mutate.

### How do I roll back a component I ticked by mistake?

Click the green tick again. `markComponentIncomplete` clears
`completed_at` and `completed_by` — but only if you have the rollback
right (founder / project_manager / site_supervisor). The completion %
recomputes via `get_project_completion_pct`.

### Where is the completion % computed?

In SQL via the `get_project_completion_pct(project_id)` RPC. The
weights are hard-coded in that function and mirrored in
`apps/erp/src/lib/project-completion-constants.ts` so the bar in the
React UI matches the RPC value.

---

## Handover Pack

Screen: `/projects/[id]?tab=certificates` → "Generate Handover Pack".
Server action: `generateHandoverPackPdf` at
`apps/erp/src/lib/handover-pdf-actions.ts`. PDF source:
`apps/erp/src/lib/pdf/handover/handover-pack-pdf.tsx`.

### How do I generate the handover PDF?

On `/projects/[id]/Certificates` click "Generate Handover Pack".
`generateHandoverPackPdf` renders the 3-page PDF in-process, uploads to
`project-files/handover-packs/{id}/`, records the storage path in
`projects.handover_pdf_path`, and returns a 1-hour signed download URL.

### What's in the handover PDF?

3 pages:

1. **Cover** — customer name, site address, project number, system
   size, commissioned date.
2. **System** — brand/model of panels & inverter, performance estimate
   (Chennai 1450 kWh/kWp/year default), warranty summary table.
3. **Instructions** — O&M instructions, emergency contacts, documents
   checklist, signature block (customer + Shiroi rep + date).

### When should I generate the handover pack?

Only after commissioning is finalized — the PDF pulls
`commissioned_date` from the projects row, and pre-commissioning the
date is null. The action is gated to `founder` + `project_manager`.

### How does the customer get the handover PDF?

You share the signed URL the action returns (valid 1 hour). For a
longer-lived link, call `getHandoverPackDownloadUrl` again — it
re-signs the same storage path. The customer never sees the bucket
directly.

---

## DC Certificates

Screen: `/projects/[id]?tab=certificates`. Server action:
`signDcCertificate` at `apps/erp/src/lib/dc-certificate-actions.ts`.
Schema: `dc_certificates` (mig 122) + RLS gate in mig 137.

### How do I sign a DC certificate?

On `/projects/[id]/Certificates` pick the certificate type
(`dc_completion` / `handing_over` / `net_metering_submission`), type
the customer's name and phone, then click Sign. `signDcCertificate`
writes the row with `signed_at = now()` and the certificate is locked.

### I signed a DC certificate with the wrong customer name — can I re-sign?

**No.** Once `signed_at` is set, the certificate is immutable. The
app-level gate in `dc-certificate-actions.ts` (lines 50–68) returns an
error, and the DB-level gate (mig 137:
`USING (signed_at IS NULL) WITH CHECK (signed_at IS NULL)` on
`dc_certs_update`) also rejects the write. Ask the founder to use
service-role to correct it.

### Which certificate types are there?

Three:
- `dc_completion` — the system is electrically complete.
- `handing_over` — system handed over to customer.
- `net_metering_submission` — paperwork submitted to discom for net
  metering.

UNIQUE on `(project_id, certificate_type)` — one of each per project.

---

## Cut-Length Tracking

Screen: `/projects/[id]?tab=materials`. Server action:
`recordCutLength` at `apps/erp/src/lib/inventory-actions.ts`. Schema:
`inventory_cut_records` (mig 121).

### Where do I record cable cut lengths?

On `/projects/[id]?tab=materials` click "Record Cut". Pick
`material_type` (`dc_cable` / `ac_cable` / `earthing_wire` /
`conduit_pvc` / `conduit_gi` / `other`), enter specification, length
in metres, optional rolls count, and project stage.
`recordCutLength` writes to `inventory_cut_records`.

### Why do we record cut lengths?

To track actual material consumption vs the BOM estimate. The data
feeds `bom_actual_vs_budgetary` (mig 128) and the nightly cron computes
`correction_factor` to improve future BOM accuracy. It also gives the
PM real-time site visibility on cable waste.

### How do I see total cable used on this project?

The summary strip at the top of the Materials tab shows totals per
`material_type` from the `get_project_cable_summary` RPC. For example:
`142.5 m DC Cable · 86 m AC Cable · 28 m Earthing Wire`.

---

## O&M Tickets

Screen: `/om/tickets`. Schema: `om_service_tickets` (mig 005d + mig 043).
SLA rules in `docs/modules/om.md`.

### How do I create an O&M ticket?

Open `/om/tickets`, click + New Ticket, pick the project, set
`issue_type` (`no_generation` / `low_generation` / `inverter_fault` /
`panel_damage` / `wiring_issue` / etc.), set `severity` (`low` /
`medium` / `high` / `critical`), write the title + description,
optionally assign an engineer. `ticket_number` is auto-assigned
(`TKT-001`, `TKT-002`, …).

### What's the SLA for each severity?

| Severity  | SLA  |
|-----------|-----:|
| critical  |  4h  |
| high      | 24h  |
| medium    | 48h  |
| low       | 72h  |

The `sla_deadline` column gets stamped on insert; `sla_breached` flips
to `true` once the deadline passes without resolution. The dashboard
colour-codes breaches.

### How do I close a ticket once the fix is done?

On `/om/tickets` toggle status from `in_progress` → `resolved`. That
auto-sets `resolved_at` and `resolved_by`. Once the customer confirms,
flip `resolved` → `closed` (auto-sets `closed_at`). Both transitions
are inline on the row.

### Where do I see my SLAs?

For per-project profitability and SLA compliance, founders and
om_technicians can open `/om/profitability` — the table shows ticket
count, parts cost, service revenue, profit/loss, and SLA compliance %
per project (from the `get_om_profitability` RPC, mig 128).

---

## Inverters & Plant Monitoring

Screen: `/om/inverters` (list + healthcheck + recent failures),
`/om/plant-monitoring` (per-project credentials). Server action:
`healthCheckInverter` at `apps/erp/src/lib/inverters-actions.ts:164`.
Schema: `inverters`, `inverter_monitoring_credentials`,
`inverter_poll_failures` (mig 050).

### How do I run an inverter healthcheck?

Open `/om/inverters`. For each row you'll see a "Ping" button. Click
it; `healthCheckInverter` resolves the brand credential (Growatt from
`plant_monitoring_credentials` for the project; Sungrow from
`inverter_monitoring_credentials.config.access_token`), calls the brand
adapter, and shows a ✓ or ✗ next to the button.

### Why is the inverter healthcheck failing?

Most common causes:
1. No `plant_monitoring_credentials` row for the project (Growatt).
2. Sungrow `access_token` expired — re-authorize at `/om/plant-monitoring`.
3. Inverter physically offline (router or modem issue at site).
4. Brand API quota exhausted.

Read the message next to the ✗ for the exact reason.

### There's a red "Recent poll failures" box at the bottom of /om/inverters. What should I do?

Read each row's `error_message` and timestamp. The fix is almost always
credential-related: re-authorize the brand under
`/om/plant-monitoring`, or add a missing `plant_monitoring_credentials`
row for that project. The poll Edge Function logs every error to
`inverter_poll_failures` (mig 050).

### I see no readings for an inverter. Where do they come from?

Readings come from the `inverter-poll` Edge Function on a cron schedule
— it dispatches per-brand adapters and writes to `inverter_readings`
(partitioned monthly). The frontend never queries `inverter_readings`
directly; it reads `inverter_readings_hourly` / `_daily` rollups (mig 050).
No readings usually means poll failures or credentials missing.

---

## Profile

Screen: `/hr/employees/[id]`. (Notes — no formal Q&A in this batch.)

- Your own profile page shows personal info, leave balances, and
  certifications. Sensitive fields (Aadhar, PAN, bank account) are
  masked with a Show/Hide toggle and only visible to you, your manager
  (`reporting_to_id`), HR, and the founder.
- Compensation (`employee_compensation`) is RLS-restricted to the same
  four parties — peers cannot read your salary.
- Certifications gate site deployment: a certificate with
  `blocks_deployment = true` and `is_expired = true` will prevent
  assignment to a site project.

---

## Related docs

- `docs/modules/projects.md` — full 13-tab project lifecycle
- `docs/modules/om.md` — post-commissioning, AMC, telemetry
- `docs/modules/hr.md` — leave, attendance, payroll, sensitive fields
- `CLAUDE.md` — coding standards + the 21 NEVER-DO rules

---

## How this doc is used

- **Humans** — searchable Q&A reference; print one section for the
  Friday Tamil training session.
- **AI assistant** — same 50 Q&A pairs are embedded into `rag_chunks`
  via `scripts/seed-site-engineer-faq.ts` so the AI can answer them
  from the in-app chat surface.
- **Quiz** — same surfaces are covered by 20 MCQs in the
  `learning_modules` row seeded by
  `scripts/seed-site-engineer-training.ts`. Pass score 60%.
