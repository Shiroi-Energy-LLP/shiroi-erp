# Purchase Module V2 — Design Spec

**Date:** 2026-04-17
**Author:** Claude (Opus) + Vivek
**Status:** Approved, ready for implementation plan
**Scope:** Replace the current procurement flow (BOQ → vendor-assign → PO) with a competitive 5-stage pipeline (BOQ → RFQ → Quote Comparison → PO → Dispatch Tracking).

## 1. Problem & Goal

### Problem
The current procurement module jumps straight from BOQ items to a single-vendor PO. There is no comparative quoting, no vendor response workflow, no price benchmarking, and no approval gate before a PO leaves the building. Manivel and the purchase team need a structured way to solicit quotes from multiple vendors, compare them side by side, enforce founder approval on POs above threshold, and track dispatch through to receipt.

### Goal
Ship a complete 5-tab workspace inside every project that supports:
1. BOQ review + vendor assignment
2. Multi-vendor RFQ dispatch (vendor self-serve + manual entry + Excel upload)
3. Side-by-side quote comparison with automatic L1 selection + override
4. Vendor-wise PO generation with founder approval gate
5. Dispatch tracking with automatic BOQ receipt updates

Existing direct-to-PO flow is preserved as "Quick PO" for emergencies and standing-price vendors — no forced workflow migration.

## 2. Decisions locked in brainstorming

| Decision | Resolution |
|---|---|
| Vendor portal authentication | Random UUID token stored in `rfq_invitations.access_token`, no session cookies, token validated on every action |
| Quote entry modes | Three: (a) vendor self-serve via secure link, (b) Purchase Engineer manual entry on vendor's behalf, (c) Excel upload with template download |
| Scope cut | Full vertical in one overnight run |
| Email dispatch | Gmail compose deep link (`https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...`) — no OAuth/SMTP/API key. Engineer hits Send in their own Gmail tab. |
| WhatsApp dispatch | `wa.me` deep link with prefilled text |
| Fallback for both | "Copy Link" button — always available |
| Purchase Engineer role | Maps to existing `purchase_officer` |
| Purchase Manager role | Maps to existing `founder` (Vinodh) — approves POs |
| 5-tab workspace route | Replaces `/procurement/project/[projectId]/page.tsx` |
| Audit log | New `procurement_audit_log` table, written on every mutation via helper function; read UI deferred to v2 |
| Notifications | Reuse existing `notifications` table from migration 014 |
| Vendor portal route | `/vendor-portal/rfq/[token]` — public, outside auth middleware |
| Three-way match (PO → DC → GRN) | Existing chain preserved; receipt updates flow through existing `vendor_delivery_challans` + `goods_receipt_notes` tables |

## 3. Data model

### Migration 060 — new tables

**`rfqs`** — header for an RFQ campaign
- `id UUID PK DEFAULT gen_random_uuid()`
- `rfq_number TEXT NOT NULL UNIQUE` — format `RFQ-YYYY-NNNN`, sequence resets April 1 (financial year boundary)
- `project_id UUID NOT NULL FK → projects(id) ON DELETE RESTRICT`
- `status TEXT NOT NULL DEFAULT 'draft'` — CHECK IN (`draft`, `sent`, `comparing`, `awarded`, `cancelled`)
- `deadline TIMESTAMPTZ NOT NULL`
- `notes TEXT`
- `created_by UUID NOT NULL FK → profiles(id)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- Indexes: `(project_id, created_at DESC)`, `(status)`, `(created_by)`

**`rfq_items`** — which BOQ items are in this RFQ
- `id UUID PK DEFAULT gen_random_uuid()`
- `rfq_id UUID NOT NULL FK → rfqs(id) ON DELETE CASCADE`
- `boq_item_id UUID NOT NULL FK → project_boq_items(id) ON DELETE RESTRICT`
- `quantity NUMERIC(14,3) NOT NULL` — snapshotted at RFQ creation (frozen even if BOQ qty changes)
- `item_description TEXT NOT NULL` — snapshot
- `unit TEXT NOT NULL` — snapshot
- `item_category TEXT NOT NULL` — snapshot
- `price_book_rate NUMERIC(14,2)` — snapshot from price book at RFQ creation time (nullable: rate pending items)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- UNIQUE `(rfq_id, boq_item_id)`
- Indexes: `(rfq_id)`, `(boq_item_id)`

**`rfq_invitations`** — one row per vendor invited to an RFQ
- `id UUID PK DEFAULT gen_random_uuid()`
- `rfq_id UUID NOT NULL FK → rfqs(id) ON DELETE CASCADE`
- `vendor_id UUID NOT NULL FK → vendors(id) ON DELETE RESTRICT`
- `access_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()`
- `status TEXT NOT NULL DEFAULT 'pending'` — CHECK IN (`pending`, `sent`, `viewed`, `submitted`, `declined`, `expired`)
- `sent_at TIMESTAMPTZ`
- `viewed_at TIMESTAMPTZ`
- `submitted_at TIMESTAMPTZ`
- `expires_at TIMESTAMPTZ NOT NULL` — defaults to RFQ deadline + 24h grace
- `submission_mode TEXT` — CHECK IN (`vendor_portal`, `manual_entry`, `excel_upload`) — NULL until submitted
- `submitted_by_user_id UUID FK → profiles(id)` — NULL when vendor self-submits
- `excel_file_path TEXT` — Supabase Storage path when mode = excel_upload
- `sent_via_channels TEXT[]` — array of `email`, `whatsapp`, `copy_link` (tracks which channels the engineer clicked)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- UNIQUE `(rfq_id, vendor_id)`
- Indexes: `(access_token)` (for token lookup), `(rfq_id)`, `(vendor_id)`, `(status, expires_at)` (partial index for expiry sweeper)

**`rfq_quotes`** — actual line-item quotes (one row per invitation × item)
- `id UUID PK DEFAULT gen_random_uuid()`
- `rfq_invitation_id UUID NOT NULL FK → rfq_invitations(id) ON DELETE CASCADE`
- `rfq_item_id UUID NOT NULL FK → rfq_items(id) ON DELETE CASCADE`
- `unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0)`
- `gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.0 CHECK (gst_rate >= 0 AND gst_rate <= 28)`
- `total_price NUMERIC(14,2) GENERATED ALWAYS AS (unit_price * (SELECT quantity FROM rfq_items WHERE id = rfq_item_id)) STORED` — note: Postgres generated columns can't reference other tables; use trigger instead (see Implementation section)
- `payment_terms TEXT NOT NULL` — CHECK IN (`advance`, `30_days`, `60_days`, `against_delivery`)
- `delivery_period_days INTEGER NOT NULL CHECK (delivery_period_days >= 0)`
- `notes TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- UNIQUE `(rfq_invitation_id, rfq_item_id)`
- Indexes: `(rfq_invitation_id)`, `(rfq_item_id)`

> **Correction:** `total_price` cannot be a STORED generated column referencing another table. Make it a plain `NUMERIC(14,2) NOT NULL` computed by the application (server action multiplies `unit_price * rfq_items.quantity` at insert time). Simpler + avoids trigger complexity.

**`rfq_awards`** — which vendor won which item
- `id UUID PK DEFAULT gen_random_uuid()`
- `rfq_id UUID NOT NULL FK → rfqs(id) ON DELETE CASCADE`
- `rfq_item_id UUID NOT NULL FK → rfq_items(id) ON DELETE CASCADE`
- `winning_invitation_id UUID NOT NULL FK → rfq_invitations(id) ON DELETE RESTRICT`
- `was_auto_selected BOOLEAN NOT NULL DEFAULT TRUE`
- `override_reason TEXT` — REQUIRED when `was_auto_selected = FALSE` (enforced via CHECK constraint)
- `awarded_by UUID NOT NULL FK → profiles(id)`
- `awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `purchase_order_id UUID FK → purchase_orders(id)` — populated after PO generation
- UNIQUE `(rfq_item_id)` — one winner per item
- CHECK `(was_auto_selected = TRUE OR override_reason IS NOT NULL)`
- Indexes: `(rfq_id)`, `(winning_invitation_id)`, `(purchase_order_id)`

**`procurement_audit_log`**
- `id BIGSERIAL PK`
- `entity_type TEXT NOT NULL` — CHECK IN (`rfq`, `rfq_invitation`, `rfq_quote`, `rfq_award`, `purchase_order`, `boq_item`)
- `entity_id UUID NOT NULL`
- `action TEXT NOT NULL` — free-form but conventional: `created`, `updated`, `sent`, `viewed`, `submitted`, `awarded`, `overridden`, `approved`, `rejected`, `dispatched`, `acknowledged`, `received`, `cancelled`, `deleted`
- `actor_id UUID FK → profiles(id)` — NULL for system actions
- `old_value JSONB`
- `new_value JSONB`
- `reason TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- Indexes: `(entity_type, entity_id, created_at DESC)`, `(actor_id, created_at DESC)`

### Migration 060 — column additions

**`purchase_orders`**
- `rfq_id UUID FK → rfqs(id)` — nullable (direct POs still supported)
- `requires_approval BOOLEAN NOT NULL DEFAULT TRUE`
- `approval_status TEXT NOT NULL DEFAULT 'pending_approval'` — CHECK IN (`pending_approval`, `approved`, `rejected`, `not_required`)
- `approval_rejection_reason TEXT`
- `dispatched_at TIMESTAMPTZ`
- `acknowledged_at TIMESTAMPTZ`
- `vendor_tracking_number TEXT`
- `vendor_dispatch_date DATE`
- Backfill: existing POs → `requires_approval = FALSE`, `approval_status = 'not_required'` (they're already in production)
- Index: `(approval_status)`, `(rfq_id)`

**`purchase_order_items`**
- `rfq_quote_id UUID FK → rfq_quotes(id)` — nullable, traceability back to winning quote
- Index: `(rfq_quote_id)`

### RLS policies

Pattern matches existing procurement tables (use `get_my_role()` from migration 008a):

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `rfqs` | founder, purchase_officer, project_manager, site_supervisor | founder, purchase_officer | founder, purchase_officer | founder only |
| `rfq_items` | same | same | none (frozen after creation) | cascade from rfqs |
| `rfq_invitations` | same | founder, purchase_officer | founder, purchase_officer | founder only |
| `rfq_quotes` | same | founder, purchase_officer (manual/excel modes); public via token (vendor mode) | founder, purchase_officer (amend); public via token (within same invitation) | founder only |
| `rfq_awards` | same | founder, purchase_officer | founder, purchase_officer | founder only |
| `procurement_audit_log` | founder only (read); INSERT allowed for all authenticated users via RLS bypass in helper function | n/a | n/a | n/a |

Vendor portal access pattern: `vendor-portal-actions.ts` uses `createAdminClient()` (bypasses RLS) but every action first calls `validateToken(token)` which re-queries the DB and checks `rfq_invitations.access_token = $1 AND expires_at > NOW() AND status != 'submitted'`. This is defense-in-depth: the bypass is scoped, and the token check uses a unique index.

### Indexes summary (rule #17 — filterable/joinable columns must have indexes in same migration)

Total new indexes in migration 060: 17
- 3 on `rfqs`
- 2 on `rfq_items`
- 5 on `rfq_invitations` (incl. access_token unique + expiry partial)
- 2 on `rfq_quotes`
- 3 on `rfq_awards`
- 2 on `procurement_audit_log`
- 2 added to `purchase_orders` + 1 on `purchase_order_items`

### Type regeneration

After migration 060 applies on dev, run:
```
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```
Commit the regenerated file alongside the migration (rule #20).

## 4. UI + User flow

### 5-tab workspace — `/procurement/project/[projectId]`

Tabs controlled via `?tab=boq|rfq|comparison|po|dispatch` (defaults to `boq`). Tab header shows completion state:
- ✓ (green) — prerequisites met
- 🔒 (muted) — locked; tooltip explains what's needed

### Tab 1 — BOQ

**Default view:** read-only styled table of approved BOQ items. Columns: #, Item Description, Unit, Qty, Price Book Rate, Estimated Amount.

**Toggle:** "Edit & Assign Vendors" button flips to editable mode.

**Editable mode columns:** same as above + `Vendor` dropdown + `Select` checkbox.

**Vendor dropdown** is a combobox sourcing from `vendors` table (filtered `deleted_at IS NULL`, sorted by name). Last option is always "+ Add new vendor" — opens `create-vendor-ad-hoc-dialog.tsx` (Name, Contact, Email, WhatsApp). Creates a `vendors` row via `createVendorAdHoc` action, selects it in the dropdown, and re-renders.

**Action buttons:**
- `Send RFQ` — enabled when ≥1 item selected AND each selected item has a vendor assigned. Pre-loads items + vendor list into Tab 2.
- `Quick PO` — preserved from existing flow. Skips RFQ entirely. Opens existing create-PO dialog.

### Tab 2 — RFQ

Two-column layout:

**Left: items panel** — pre-selected from Tab 1, read-only.

**Right: vendor selection panel** — multi-select checkbox list from vendor master. Vendors pre-assigned in Tab 1 are pre-checked; engineer can add more.

**Below both panels:**
- `Deadline` — date picker, defaults to today + 7 days
- `Notes` — textarea (instructions, warranty requirements, site info)
- `Create RFQ & Send` — button

**On click:**
1. Server creates `rfqs` + `rfq_items` (snapshotted from selected BOQ) + `rfq_invitations` (with fresh access tokens)
2. Opens **Send Modal** listing every invitation:

```
┌─────────────────────────────────────────────────┐
│ Vendor ABC Enterprises        Status: Pending  │
│ Portal: https://erp.shiroienergy.com/vendor-   │
│         portal/rfq/550e8400-e29b-...            │
│ [📋 Copy Link]  [✉ Gmail]  [💬 WhatsApp]        │
├─────────────────────────────────────────────────┤
│ Vendor XYZ Metals             Status: Sent     │
│ ...                                             │
```

Each dispatch action:
- `Copy Link` — `navigator.clipboard.writeText(url)` + calls `markInvitationSent(id, 'copy_link')`
- `Gmail` — opens `https://mail.google.com/mail/?view=cm&fs=1&to={vendor.email}&su={subject}&body={body}` in a new tab, calls `markInvitationSent(id, 'email')`
- `WhatsApp` — opens `https://wa.me/{vendor.phone}?text={encoded}`, calls `markInvitationSent(id, 'whatsapp')`

`sent_via_channels` tracks every channel clicked (array append — engineer can send via multiple channels).

**Below the create flow:** existing RFQs for this project, grouped as expandable rows. Each RFQ shows per-vendor invitation status with timestamps. Each row has:
- `Enter Quote Manually` button → `manual-quote-entry-dialog.tsx` — engineer fills in the form on vendor's behalf (phone call scenario). Sets `submission_mode = 'manual_entry'`, `submitted_by_user_id = auth.uid()`.
- `Upload Excel` button → `excel-quote-upload-dialog.tsx` — two-step dialog: (a) download template, (b) upload filled sheet. Parser validates, shows preview, on confirm saves quotes + stores the file in `rfq-excel-uploads` bucket. Sets `submission_mode = 'excel_upload'`, `submitted_by_user_id = auth.uid()`.

### Tab 3 — Quote Comparison

Renders only when at least one RFQ has ≥1 submitted quote. Otherwise shows "Waiting for vendor quotes" empty state with a link back to Tab 2.

**Top: pricing matrix**. Rows = RFQ items. Columns = Item, Qty, Price Book Rate, then paired columns per invited vendor (Price, Total), then L1 Vendor.

- **L1 auto-highlight**: cell with lowest `total_price` for that row gets green bg + "L1" badge
- **Price Book variance**: each vendor total cell has `(+12.3%)` or `(−4.1%)` in muted text vs `price_book_rate`; amber text if variance > +5%
- **Unquoted cells**: show `—` in muted text
- **Per-row override**: clicking the L1 badge opens a dropdown: `Use Vendor A / Use Vendor B / Use Vendor C`. Selecting non-L1 requires a reason textarea. On save: writes `rfq_awards` row with `was_auto_selected = FALSE` + `override_reason`.

**Below: per-vendor summary cards** (one card per vendor invited to any item):
- Grand total (quoted items only)
- Payment terms
- Delivery period (max across items, in days)
- Overall variance vs price book (weighted by quantity)
- Past performance score — renders only if `vendors.performance_score IS NOT NULL`

**Bottom: action bar**
- `Auto-Award All L1` — awards every item to its L1 vendor in one click
- `Generate POs` — enabled only when every RFQ item has an award. Groups awards by `winning_invitation.vendor_id` → creates one PO per vendor with items sourced from winning quotes → `status = draft`, `approval_status = pending_approval` (unless founder is creating, in which case skip approval). Writes `rfq_awards.purchase_order_id`.

### Tab 4 — Purchase Order

Compact list of POs under this project. Columns: PO Number, Vendor, Items count, Total, Status, Approval, Actions.

**Status progression**: `draft` → `pending_approval` → `approved` → `sent` → `acknowledged` → `partially_delivered` → `fully_delivered` → `closed`
(existing enum + new states)

**Per-row actions (conditional)**:
- `View` — always — opens modal with PDF preview (existing route)
- `Edit` — only while `status = draft` — opens editable items table
- `Download PDF` — always — existing route
- `Delete` — only while `status = draft` — soft delete (status = cancelled)
- `Send for Approval` — only while `status = draft` — sets `status = pending_approval`, inserts founder notification
- `Approve` / `Reject` — only while `status = pending_approval` AND viewer is founder
- `Send to Vendor` — only while `status = approved` — opens Gmail/WhatsApp/Copy modal same as RFQ send; on channel click, sets `status = sent`, `dispatched_at = NOW()`

### Tab 5 — Dispatch Tracking

One row per PO. Horizontal timeline:
```
PO Sent ─── Acknowledged ─── Dispatched ─── Received
2 Apr         4 Apr             8 Apr          12 Apr
```

Timeline states:
- **PO Sent** — from `dispatched_at`
- **Acknowledged** — from `acknowledged_at`
- **Dispatched** — from `vendor_dispatch_date`
- **Received** — from GRN records (any GRN exists with status `passed` or `conditional`)

Row actions:
- `Mark Acknowledged` — records `acknowledged_at = NOW()` (vendor confirmed via phone/WhatsApp)
- `Mark Dispatched` — `mark-dispatched-dialog.tsx`: vendor_dispatch_date (required), tracking_number (optional)
- `Record Receipt` — opens existing DC/GRN dialog (three-way match flow)

**DB trigger `fn_boq_auto_update_on_grn_complete`** (part of migration 060):
- Fires AFTER INSERT OR UPDATE on `goods_receipt_notes` when `status IN ('passed', 'conditional')`
- Sums delivered quantities across all GRNs for each PO → if `sum(grn.quantity) >= po_item.quantity_ordered`, sets `purchase_order_items.quantity_delivered` accordingly
- If all PO items fully delivered → sets `purchase_orders.status = 'fully_delivered'`
- Updates linked `project_boq_items.procurement_status = 'received'` via `rfq_awards → purchase_order_id → rfq_award.rfq_item_id → rfq_items.boq_item_id`
- When every non-cancelled BOQ item for the project has `procurement_status = 'received'` → sets `projects.procurement_status = 'received'` + inserts notification (recipient: project's `project_manager_id`)
- Idempotent: `WHERE old.status IS DISTINCT FROM new.status` guard prevents re-fires

### Vendor portal — `/vendor-portal/rfq/[token]`

Public route, bypasses auth middleware. Server component flow:

1. **Page load** (server):
   - `validateToken(token)` → returns `{ rfqId, vendorId, expired, alreadySubmitted }` OR error
   - If expired: render "This RFQ link has expired" page
   - If alreadySubmitted: render "Your quote was already submitted on {date}" page with read-only summary
   - If invalid: render "Invalid link" page
   - On first valid load: `markInvitationViewed(token)` sets `status = 'viewed'`, `viewed_at = NOW()`
2. **Render form**:
   - Header (read-only): project name, RFQ number, deadline, vendor name, notes
   - Table of items (read-only rows) with empty input cells per row: `Unit Price`, `GST %`
   - Below table: `Payment Terms` dropdown, `Delivery Period (days)` number, `Notes` textarea
   - `Submit Quote` button
3. **On submit** (`submitQuoteFromVendor` action):
   - Re-validates token + not-submitted + not-expired
   - Inserts `rfq_quotes` rows (one per item)
   - Updates `rfq_invitation.status = 'submitted'`, `submitted_at = NOW()`, `submission_mode = 'vendor_portal'`
   - Fires notification to RFQ creator
   - Redirects to `/vendor-portal/rfq/[token]/thank-you`

### Empty states & locked tabs

Every tab has a defined empty state:
- Tab 1 — BOQ empty: "No BOQ items yet. The Project Manager needs to finalize the BOQ first."
- Tab 2 — No RFQs: "No RFQs yet. Select items in the BOQ tab and click Send RFQ."
- Tab 3 — No quotes: "Waiting for vendor quotes. Send RFQs and check back once vendors submit."
- Tab 4 — No POs: "No purchase orders yet. Award items in the Comparison tab to generate POs."
- Tab 5 — No dispatches: "No POs dispatched yet. Approve and send POs to vendors first."

## 5. Server actions & queries — full signatures

All actions return `ActionResult<T>` from `apps/erp/src/lib/types/actions.ts` (rule #19).

### `apps/erp/src/lib/rfq-queries.ts`

```typescript
listRfqsForProject(projectId: string): Promise<Rfq[]>
getRfqWithInvitations(rfqId: string): Promise<RfqDetail>
getRfqComparisonData(projectId: string): Promise<ComparisonMatrix>
getPendingApprovalPOs(): Promise<PurchaseOrder[]>
getProcurementAuditLog(entityType: string, entityId: string): Promise<AuditLogEntry[]>
```

### `apps/erp/src/lib/rfq-actions.ts`

```typescript
createRfqWithInvitations(input: {
  projectId: string
  boqItemIds: string[]
  vendorIds: string[]
  deadline: string
  notes?: string
}): Promise<ActionResult<{ rfqId: string; invitations: RfqInvitation[] }>>

markInvitationSent(invitationId: string, channel: 'email' | 'whatsapp' | 'copy_link'): Promise<ActionResult<void>>

submitQuoteManually(input: {
  invitationId: string
  lineItems: Array<{ rfqItemId: string; unitPrice: number; gstRate: number }>
  paymentTerms: string
  deliveryPeriodDays: number
  notes?: string
}): Promise<ActionResult<void>>

submitQuoteFromExcel(input: {
  invitationId: string
  filePath: string
  parsedRows: ParsedQuoteRow[]
  paymentTerms: string
  deliveryPeriodDays: number
}): Promise<ActionResult<void>>

awardRfqItem(input: {
  rfqItemId: string
  winningInvitationId: string
  overrideReason?: string
}): Promise<ActionResult<void>>

autoAwardL1(rfqId: string): Promise<ActionResult<{ awarded: number }>>

generatePOsFromAwards(rfqId: string): Promise<ActionResult<{ poIds: string[] }>>

cancelRfq(rfqId: string, reason: string): Promise<ActionResult<void>>
```

### `apps/erp/src/lib/procurement-actions.ts` (additions)

```typescript
sendPOForApproval(poId: string): Promise<ActionResult<void>>
approvePO(poId: string): Promise<ActionResult<void>>
rejectPO(poId: string, reason: string): Promise<ActionResult<void>>
markPODispatched(input: { poId: string; channel: 'email' | 'whatsapp' | 'copy_link' }): Promise<ActionResult<void>>
markPOAcknowledged(poId: string): Promise<ActionResult<void>>
recordVendorDispatch(input: { poId: string; dispatchDate: string; trackingNumber?: string }): Promise<ActionResult<void>>
createVendorAdHoc(input: { name: string; contact?: string; email?: string; whatsapp?: string }): Promise<ActionResult<{ vendorId: string }>>
```

### `apps/erp/src/lib/vendor-portal-queries.ts` (public, no auth)

```typescript
validateToken(token: string): Promise<
  | { ok: true; rfqId: string; vendorId: string; invitationId: string; expired: false; alreadySubmitted: boolean; rfq: PublicRfqShape }
  | { ok: false; reason: 'invalid' | 'expired' }
>
```

### `apps/erp/src/lib/vendor-portal-actions.ts` (public, no auth)

```typescript
markInvitationViewed(token: string): Promise<ActionResult<void>>
submitQuoteFromVendor(input: {
  token: string
  lineItems: Array<{ rfqItemId: string; unitPrice: number; gstRate: number }>
  paymentTerms: string
  deliveryPeriodDays: number
  notes?: string
}): Promise<ActionResult<void>>
```

### `apps/erp/src/lib/procurement-audit.ts`

```typescript
logProcurementAudit(
  supabase: SupabaseClient,
  input: {
    entityType: 'rfq' | 'rfq_invitation' | 'rfq_quote' | 'rfq_award' | 'purchase_order' | 'boq_item'
    entityId: string
    action: string
    actorId: string | null
    oldValue?: unknown
    newValue?: unknown
    reason?: string
  }
): Promise<void>  // fire-and-forget; never throws (logs internally on failure)
```

### `apps/erp/src/lib/excel-quote-parser.ts`

```typescript
parseQuoteExcel(buffer: ArrayBuffer): Promise<
  | { ok: true; rows: ParsedQuoteRow[]; warnings: string[] }
  | { ok: false; error: string }
>

type ParsedQuoteRow = {
  sNo: number
  itemDescription: string  // for matching back to rfq_items
  unitPrice: number
  gstRate?: number
}
```

### `apps/erp/src/lib/gmail-whatsapp-links.ts`

```typescript
buildGmailComposeUrl(input: { to: string; subject: string; body: string }): string
buildWhatsAppUrl(input: { phone: string; text: string }): string
buildRfqEmailSubject(rfqNumber: string, projectName: string): string
buildRfqEmailBody(input: { vendorName: string; rfqNumber: string; projectName: string; deadline: string; portalUrl: string }): string
buildRfqWhatsAppText(input: { vendorName: string; rfqNumber: string; portalUrl: string; deadline: string }): string
buildPoEmailBody(input: { vendorName: string; poNumber: string; projectName: string; portalUrl?: string; pdfUrl?: string }): string
```

## 6. Storage

**New bucket: `rfq-excel-uploads`**
- Created in migration 060 via `INSERT INTO storage.buckets`
- Max file size: 10 MB
- Allowed mime types: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel`, `text/csv`
- RLS: founder + purchase_officer full CRUD; no public access
- Path convention: `{rfq_id}/{invitation_id}/{timestamp}-{filename}`

## 7. Notifications

Written to existing `notifications` table:

| Event | Recipients | Message template |
|---|---|---|
| Project sent to purchase team | all `purchase_officer` users | "New Purchase Request for Project {X}" |
| Vendor submits quote | RFQ creator (`rfqs.created_by`) | "{vendor_name} submitted a quote for {rfq_number}" |
| PO sent for approval | all `founder` users | "PO {po_number} pending your approval for Project {X}" |
| PO approved | PO creator (`purchase_orders.prepared_by`) | "PO {po_number} approved — ready to send" |
| PO rejected | PO creator | "PO {po_number} rejected: {reason}" |
| All materials received | project's `project_manager_id` | "Project {X} — all materials received, ready to dispatch" |

Notification writes are best-effort — wrapped in try/catch, failures log but don't block the primary mutation.

## 8. Permissions matrix

| Role | RFQ tables | purchase_orders | vendor-portal |
|---|---|---|---|
| founder | full CRUD + approve/reject | full CRUD + approve/reject/override | n/a (signs in as founder) |
| purchase_officer | full CRUD | CRUD except approve/reject | n/a |
| project_manager | SELECT | SELECT | n/a |
| site_supervisor | SELECT on rfqs (context only) | SELECT | n/a |
| designer, finance, sales, hr, om | SELECT where relevant (e.g., finance sees POs for payments) | varies | n/a |
| vendor (anonymous) | n/a | n/a | token-gated access only |

## 9. Audit log contract

Every mutation in `rfq-actions.ts`, `vendor-portal-actions.ts`, and the new additions to `procurement-actions.ts` calls `logProcurementAudit(...)` after a successful DB write, before returning. Actions logged:

| Action | entity_type | action | old_value | new_value |
|---|---|---|---|---|
| RFQ created | rfq | created | null | `{ project_id, item_count, vendor_count }` |
| RFQ sent | rfq | sent | `{ status: 'draft' }` | `{ status: 'sent' }` |
| Invitation channel clicked | rfq_invitation | sent | `{ sent_via_channels: [...] }` | `{ sent_via_channels: [...] }` |
| Vendor viewed link | rfq_invitation | viewed | `{ status }` | `{ status: 'viewed', viewed_at }` |
| Quote submitted (any mode) | rfq_invitation | submitted | `{ status }` | `{ status: 'submitted', submission_mode, submitted_by_user_id }` |
| Item awarded (auto) | rfq_award | awarded | null | `{ winning_invitation_id, was_auto_selected: true }` |
| Item award overridden | rfq_award | overridden | `{ winning_invitation_id: prev }` | `{ winning_invitation_id: new, override_reason }` |
| POs generated | rfq | awarded | `{ status: 'comparing' }` | `{ status: 'awarded', po_count }` |
| PO sent for approval | purchase_order | sent_for_approval | `{ approval_status }` | `{ approval_status: 'pending_approval' }` |
| PO approved | purchase_order | approved | `{ approval_status: 'pending_approval' }` | `{ approval_status: 'approved', approved_by }` |
| PO rejected | purchase_order | rejected | `{ approval_status: 'pending_approval' }` | `{ approval_status: 'rejected', approval_rejection_reason }` |
| PO sent to vendor | purchase_order | dispatched | `{ status: 'approved' }` | `{ status: 'sent', dispatched_at, channel }` |
| PO acknowledged | purchase_order | acknowledged | `{ acknowledged_at: null }` | `{ acknowledged_at }` |
| Vendor dispatch recorded | purchase_order | vendor_dispatched | null | `{ vendor_dispatch_date, vendor_tracking_number }` |
| GRN completes PO | purchase_order | received | `{ status: 'partially_delivered' }` | `{ status: 'fully_delivered' }` (system action, actor_id = null) |

`actor_id = auth.uid()` for user-initiated actions, `NULL` for trigger-fired system actions.

## 10. File tree (new)

```
supabase/migrations/
└── 060_purchase_module_v2.sql

packages/types/
└── database.ts  (regenerated)

apps/erp/src/
├── app/
│   ├── (erp)/procurement/project/[projectId]/
│   │   ├── page.tsx                              (rewrite — 5-tab shell)
│   │   ├── loading.tsx                           (new)
│   │   ├── _tabs/
│   │   │   ├── tab-boq.tsx
│   │   │   ├── tab-rfq.tsx
│   │   │   ├── tab-comparison.tsx
│   │   │   ├── tab-po.tsx
│   │   │   └── tab-dispatch.tsx
│   │   └── _client/
│   │       ├── boq-editable-table.tsx
│   │       ├── send-rfq-panel.tsx
│   │       ├── send-rfq-modal.tsx
│   │       ├── manual-quote-entry-dialog.tsx
│   │       ├── excel-quote-upload-dialog.tsx
│   │       ├── comparison-matrix.tsx
│   │       ├── po-approval-actions.tsx
│   │       ├── po-send-modal.tsx
│   │       ├── dispatch-timeline-row.tsx
│   │       ├── mark-dispatched-dialog.tsx
│   │       └── create-vendor-ad-hoc-dialog.tsx
│   └── vendor-portal/rfq/[token]/
│       ├── page.tsx                              (public)
│       ├── _client/
│       │   └── quote-submit-form.tsx
│       └── thank-you/page.tsx
├── lib/
│   ├── rfq-queries.ts
│   ├── rfq-actions.ts
│   ├── vendor-portal-queries.ts
│   ├── vendor-portal-actions.ts
│   ├── procurement-audit.ts
│   ├── excel-quote-parser.ts
│   └── gmail-whatsapp-links.ts
└── middleware.ts                                 (edit: add /vendor-portal to public routes)

e2e/
└── smoke.spec.ts                                 (edit: add 3 new tests)
```

## 11. CI & discipline gates

All new code complies with CLAUDE.md NEVER-DO rules:
- Rule #11 — no `as any` in Supabase queries; use `Database['public']['Tables'][X]['Row']`
- Rule #12 — no JS money aggregation; L1 detection + totals computed via SQL or explicit `Decimal` library
- Rule #13 — no `count: 'exact'`; all paginated lists use `count: 'estimated'`
- Rule #14 — no form component >500 LOC; components stay under threshold (split tab client components where needed)
- Rule #15 — no inline Supabase in pages/components; all through `*-queries.ts` / `*-actions.ts`
- Rule #17 — every filterable column in migration 060 has an index in same migration
- Rule #18 — no long background work in server actions; Excel parsing done client-side before submit; notification sends are fire-and-forget inserts
- Rule #19 — all actions return `ActionResult<T>`
- Rule #20 — types regenerated in same commit as migration

Forbidden-pattern baseline expected to stay flat (no regressions). Target: leave at 61 or lower.

## 12. Testing strategy

1. **Type-check + lint** — `pnpm check-types` + `pnpm lint --max-warnings 0`
2. **Migration verification** — apply 060 to dev; spot-check tables/indexes/RLS via MCP `execute_sql`
3. **Playwright smoke tests** — 3 new tests in `e2e/smoke.spec.ts` (skipped when login env missing)
4. **Manual checklist** — 18-item checklist documented below (Section 13)
5. **Audit log spot-check** — after manual run, query `procurement_audit_log` and verify rows

### Section 13 — Manual verification checklist

Run by Vivek after overnight execution completes:

- [ ] Create a test RFQ with 2 BOM items + 3 vendors
- [ ] Copy-link button copies correct URL to clipboard
- [ ] Gmail button opens Gmail compose with correct to/subject/body prefilled
- [ ] WhatsApp button opens wa.me with correct phone + text prefilled
- [ ] Manual quote entry saves without the vendor touching the portal
- [ ] Excel upload parses a sample sheet correctly (template downloadable, upload works)
- [ ] Vendor portal opens with valid token, shows the right items
- [ ] Vendor portal rejects expired token (manually expire via SQL)
- [ ] Vendor portal rejects already-submitted token
- [ ] Vendor submits quote — shows up in comparison tab immediately
- [ ] L1 auto-highlight picks lowest per-line total correctly
- [ ] Manual L1 override requires a reason before save
- [ ] Generate POs creates one PO per vendor grouping
- [ ] PO PDF download works end-to-end
- [ ] Send for Approval → founder gets notification in notifications table
- [ ] Founder approves → Engineer gets notification
- [ ] Mark Dispatched records vendor dispatch date + tracking number
- [ ] GRN creation auto-updates BOQ item status when all items received
- [ ] All BOQ items received → PM notification fires

## 14. Rollout

**Build order** (enforced via implementation plan's dependency graph):

- **Phase 0**: Migration 060 + types regeneration [blocking]
- **Phase 1**: Vendor portal public route + token validation [independent of Phase 2]
- **Phase 2**: RFQ queries + actions [depends on Phase 0]
- **Phase 3**: Tabs 1–2 UI (BOQ editable, RFQ create + send modal, manual/Excel entry) [depends on Phase 2]
- **Phase 4**: Tab 3 UI (comparison matrix + award + generate POs) [depends on Phase 3]
- **Phase 5**: Tab 4 UI (PO approval actions + extensions to existing procurement-actions) [depends on Phase 4]
- **Phase 6**: Tab 5 UI (dispatch tracking) + GRN auto-update trigger (already in migration 060) [depends on Phase 5]
- **Phase 7**: Notifications wiring across Phases 2–6 [cross-cutting]
- **Phase 8**: Audit log integration across all new actions [cross-cutting, last]
- **Phase 9**: Playwright smoke tests + manual checklist documentation [final]

Parallelization: Phase 1 runs in parallel with Phase 2. Within Phases 3–6, client components can be built by parallel subagents once the server actions exist.

**Prod deployment**: dev only for now. Migration 060 batched with 013–059 for post-testing-week promotion.

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vendor portal token abuse (guessing) | UUID v4 = 122 bits of entropy; expired tokens DB-level rejected; one-shot (submission flips status) |
| Excel parser fails on vendor-specific formats | Defensive parser, graceful row-level errors, fallback to manual entry |
| Founder approval bottleneck | `requires_approval` per-PO toggleable; nightly reminder if stuck >24h (future enhancement, v2) |
| Gmail deep link fails (not signed in) | Copy Link + WhatsApp always available; `mailto:` fallback as last resort |
| GRN trigger double-fires | Idempotency guard `WHERE old.status IS DISTINCT FROM new.status` |
| Vendor submits quote twice (race) | Unique constraint `(rfq_invitation_id, rfq_item_id)` + `status = 'submitted'` check in action |
| Manually-entered quote overwrites vendor's real submission | Manual entry only allowed when `status IN ('pending', 'sent', 'viewed')` — not when already submitted |
| Direct-to-PO flow (Quick PO) bypasses new approval gate | `requires_approval = TRUE` by default; direct POs still go through approval unless founder explicitly overrides |

## 16. Out of scope for v1

Deferred to future iterations:
- Audit log reader UI (the table is written; visualization is a future `/procurement/audit` page)
- WhatsApp Business API integration (v1 uses wa.me deep link)
- Programmatic email via SMTP/Resend/SendGrid (v1 uses Gmail deep link)
- Vendor portal "Acknowledge PO" flow (v1 has only manual "Mark Acknowledged" by engineer)
- RFQ deadline auto-expiration background job (v1 relies on action-time check)
- Rate limiting on `/vendor-portal/*` (v1 relies on UUID entropy + one-shot design)
- Past performance score computation (v1 only reads `vendors.performance_score` if set; population is out of scope)
- Multi-currency (everything is INR for v1)

---

**End of spec.**
