# Service Ticket — Done By, create parity, single edit surface

**Date:** 2026-07-25
**Module:** om (Service Tickets)
**Migration:** none
**Supersedes nothing.** Builds on `2026-06-27-service-ticket-detail-and-timeline-design.md` (mig 199).

---

## Background

A requirements list arrived asking for 12 changes to the Service Ticket module:
9-column header, create button, project autosearch with free-text fallback,
row Edit/Delete, unchanged issue types, 3 KPI cards, 3 filters, clickable Title,
a detail page with description + documents + day-by-day history, and write-back
to the list.

**Ten of the twelve already shipped on 2026-06-27** (mig 199). The columns, KPI
RPC, filters, timeline, attachments and detail page all match the request
exactly. This spec covers only the genuine gaps.

## Gaps

1. **Create dialog omits Status, Done By and Amount** — three of the nine header
   columns. Status hardcodes to `open`, amount to 0. Logging an
   already-completed paid service takes two round trips (create, then edit).
2. **Row Edit is a subset dialog.** `edit-ticket-dialog.tsx` cannot set Project,
   Status or Done By. The detail page's `TicketEditPanel` is a strict superset,
   so the two forms have already drifted.
3. **Done By is not editable anywhere.** It renders `resolved_by`, which is
   auto-stamped with whoever clicked the status toggle — not necessarily the
   technician who did the work. An admin closing a ticket on someone's behalf
   puts the wrong name on the row.

## Design

### 1. Done By becomes an explicit employee picker

Storage reuses the existing `om_service_tickets.resolved_by` (UUID FK →
`employees`, from `005d_om.sql:388`). That column already backs the "Done By"
heading; adding a second column would leave two fields competing for one label.
**No migration.**

- `createServiceTicket` and `updateServiceTicket` gain an optional `doneBy`
  input (`string | null`). `null` clears; `undefined` leaves untouched.
- `applyStatusTransition` currently overwrites `resolved_by` on every
  resolve/close. It becomes **fill-if-empty**: the auto-stamp only applies when
  `resolved_by` is currently null. This requires threading the current
  `resolved_by` into the function, which means adding it to the `select` in
  `updateServiceTicket` and to `updateTicketStatus`'s own load.
- An explicit `doneBy` in the same save always beats the auto-stamp.
- **Behaviour change:** reopening a ticket (`→ open`) currently nulls
  `resolved_by`. It will now preserve it. Silently erasing a deliberately
  entered technician is data loss; the user can blank the picker explicitly.
  `resolved_at` and `closed_at` still clear on reopen, unchanged.

### 2. Row Edit opens the detail page

The Actions-column pencil becomes a `Link` to `/om/tickets/[id]`.
`edit-ticket-dialog.tsx` is **deleted** — the tickets list page is its only
importer, and every field it offers exists on the detail panel. One edit
surface, no drift.

### 3. Create dialog reaches header parity

The create form gains Status, Done By and Service Amount, so all nine header
columns are settable at creation.

- `createServiceTicket` accepts `status`, `serviceAmount` and `doneBy`.
- A ticket created directly as Resolved or Closed routes through the same
  `applyStatusTransition` stamping, so `resolved_at`/`closed_at` are set
  consistently rather than left null under a closed status.
- The create and edit dialogs each hardcode private copies of `ISSUE_TYPES` and
  `SEVERITY_OPTIONS` despite `ticket-constants.ts` already exporting both. Create
  switches to the shared import. Requirement "keep issue-type values unchanged"
  is far safer served by one list than by three.

### 4. Back-dated creation

`createServiceTicket` accepts an optional `createdAt` (`'YYYY-MM-DD'`), exposed
in the create dialog as a Created Date field defaulting to today. Service work
is often logged days after the visit, and the Created column is the only date on
the list.

Ticket-number generation orders by `created_at DESC` to find the last number. A
back-dated row cannot become that maximum in normal use, so numbering is
unaffected. The date is stored as an ISO timestamp at IST midday to avoid a
UTC-conversion day-shift on display.

### 5. Resolved webhook on create

When a ticket is created already `resolved` or `closed`, fire
`emitOmTicketResolved` alongside `emitOmTicketCreated`. Downstream n8n
consumers that react to resolution otherwise never see these tickets. Both emits
stay non-blocking `void` calls, matching existing practice.

## Files touched

| File | Change |
|---|---|
| `lib/service-ticket-actions.ts` | `doneBy`/`status`/`serviceAmount`/`createdAt` on create; `doneBy` on update; fill-if-empty `applyStatusTransition`; resolved emit on create |
| `components/om/create-ticket-dialog.tsx` | +Status, Done By, Amount, Created Date; shared constants import |
| `components/om/ticket-edit-panel.tsx` | +Done By picker |
| `app/(erp)/om/tickets/page.tsx` | Actions pencil → `Link`; drop `EditTicketDialog` |
| `components/om/edit-ticket-dialog.tsx` | **deleted** |

## Out of scope

Columns, KPI RPC, filters, timeline, attachments and the detail page layout are
untouched — they already satisfy the request. Issue-type values are unchanged.

## Verification

`pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh &&
pnpm build`, then manually: create a back-dated closed ticket with an explicit
Done By and an amount; confirm the row shows all nine columns correctly, that
toggling status does not overwrite Done By, and that reopening preserves it.
