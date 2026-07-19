# Service Ticket Module — Detail Page, Timeline, KPIs & Filters

**Date:** 2026-06-27
**Module:** O&M (`/om/tickets`)
**Migration:** 199 (dev-only; prod deferred per standing rule)

## Goal

Extend the existing Service Ticket module with a clickable **Title → detail page**, a combined
**activity/work timeline**, document **attachments**, **KPI cards**, a dedicated **project
autosearch filter**, a trimmed column set, and a true **hard delete**. Most list-level CRUD
(create, edit, status toggle, project autosearch+custom-name, total-amount stat) already exists —
this builds the detail experience and the surrounding polish on top of it.

## Decisions (locked in brainstorming)

- **History = one combined timeline** (`om_ticket_events`, `entry_type ∈ {note, system}`) — manual
  engineer notes and auto system events in a single chronological feed.
- **Attachments = ticket-level + per-entry.** Ticket holds an array of supporting documents; any
  timeline entry can carry one optional file. Files → Supabase Storage `project-files` bucket; DB
  holds path strings only.
- **Delete = hard delete** (with confirm). Closing a ticket stays a *status* (inline toggle).
- **Columns** trimmed to exactly: Project · Title · Issue Type · Assigned To · Status · Created ·
  Done By · Amount (₹) · Actions. Severity + SLA Due columns removed (severity still editable in the
  form). "Done By" = `resolved_by` employee.
- **KPI split**: Open = status NOT IN (resolved, closed); Closed = status IN (resolved, closed).

## Data model (migration 199)

**New `om_ticket_events`**
| column | type | notes |
|---|---|---|
| id | uuid PK | client-generated |
| ticket_id | uuid FK → om_service_tickets(id) **ON DELETE CASCADE** | |
| entry_type | text CHECK in ('note','system') | |
| body | text NOT NULL | note text / system text ("Status changed: Open → Resolved") |
| attachment_path | text null | one optional Storage path |
| attachment_name | text null | original filename |
| created_by | uuid FK → employees(id) null | actor |
| created_at | timestamptz default now() | |

Index `(ticket_id, created_at DESC)`. RLS: read for founder/PM/om_technician/finance; insert+delete
for founder/PM/om_technician (mirrors `om_service_tickets`).

**On `om_service_tickets`**: add `attachment_paths TEXT[] DEFAULT '{}'` + `attachment_names TEXT[]
DEFAULT '{}'` (ticket-level supporting docs).

**New DELETE policy `tickets_delete`** on `om_service_tickets` (founder/PM/om_technician) — none
exists today; required for hard delete under the user's session.

**New RPC `get_service_ticket_kpis()`** → `{ open_count BIGINT, closed_count BIGINT, total_amount
NUMERIC }` in one call (SQL aggregation; NEVER-DO #12). Replaces the standalone
`get_service_ticket_amount_total()` call on the list (that RPC stays for back-compat).

## Server actions (`service-ticket-actions.ts`)

- `deleteServiceTicket` → **hard DELETE**: collect all Storage paths (ticket-level array + every
  event `attachment_path`), best-effort `storage.remove`, then `DELETE` the row (events cascade).
- `createServiceTicket` / `updateTicketStatus` → also insert a `system` event.
- `updateServiceTicket` → extended to accept `projectId`/`projectNameCustom`/`status`; logs a
  `system` event summarizing changed fields.
- `addTicketEvent(ticketId, body, attachmentPath?, attachmentName?)` — manual note; `created_by =
  getCurrentEmployeeId()`.
- `deleteTicketEvent(eventId)` — remove a manual note (+ its Storage file).
- `addTicketAttachment(ticketId, path, name)` / `removeTicketAttachment(ticketId, path)` — manage
  ticket-level doc array.
- `getTicketDetail(id)` — ticket + project + assignee + resolver + ordered events.
- `getServiceTicketKpis()` — wraps the RPC.

All return `ActionResult<T>`, `op`-prefixed logs, separate error/null checks. Mutations
`revalidatePath('/om/tickets')` **and** `/om/tickets/[id]`.

## List page (`om/tickets/page.tsx`)

- 3 KPI cards at top (Open / Closed / Total Service Amount) from `getServiceTicketKpis()`.
- Columns trimmed per decision; **Title** rendered as `<Link href={/om/tickets/[id]}>` (Project stays
  linked to the project page).
- Filter bar gains a dedicated **project autosearch** control (`ticket-project-filter.tsx`,
  URL-aware `ProjectCombobox` wrapper pushing `?project=`). Free-text search box stays.

## Detail page (`om/tickets/[id]/page.tsx` + components)

- Header: ticket #, title, status toggle, meta (project link, issue type, assigned to, severity,
  created, SLA, amount, done by).
- **Edit panel** (`ticket-edit-panel.tsx`) — all fields editable (title, description, issue type,
  severity, assign to, service amount, resolution notes, status, project via combobox) →
  `updateServiceTicket`.
- **Supporting documents** (`ticket-attachments.tsx`) — multi-file upload + list + remove.
- **Timeline** (`ticket-timeline.tsx`) — composer (note text + optional single file) + reverse-chron
  combined feed; manual notes vs system events visually distinguished; manual entries show author +
  date + attachment chip + delete.
- Components stay < 500 LOC each (NEVER-DO #14).

## Standards / verification

- Money `NUMERIC(14,2)` + SQL aggregation. Uploads via browser client to `project-files`; DB stores
  paths only. `crypto.randomUUID()` for ids. Row types from `database.ts` (regen after migration).
- CI gates: `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm
  build`.
- Manual: create → click Title → detail; add note + photo; change status (system event appears);
  edit fields (reflected in list); delete with confirm (row + files gone); KPI counts + filters.
