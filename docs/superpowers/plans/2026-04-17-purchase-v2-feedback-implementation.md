# Purchase v2 Feedback — Implementation Plan

> Plan date: 2026-04-17
> Spec: `docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md`
> Target migration: **062**
> Executor: Sonnet agent, run inside repo with full edit permissions.

This plan is file-by-file, top-down. Work through the phases in order — each phase leaves the tree in a compilable state.

---

## Phase 0 — Migration 062 + type regen

**1. Create `supabase/migrations/062_purchase_v2_feedback.sql`.**

File contents (copy-paste baseline — adjust as needed):

```sql
-- =============================================================================
-- Migration 062 — Purchase v2 feedback pass
-- =============================================================================
-- Context: Post-ship feedback on v2 (migration 060 + 061 hotfix).
-- See docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md.
-- Change summary:
--   1. Add sent_to_vendor_at + sent_via_channels columns to purchase_orders.
--   2. Add generated dispatch_stage column (derived from timestamps).
--   3. Back-fill sent_to_vendor_at for already-dispatched POs.
--   4. Add fn_cascade_po_approval_to_boq + fn_cascade_po_receipt_to_boq SQL
--      helpers so approval/receipt transitions are re-usable from both server
--      actions and the existing GRN trigger.
-- =============================================================================

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS sent_to_vendor_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sent_via_channels TEXT[] NOT NULL DEFAULT '{}';

-- ─── 2. Generated dispatch_stage ─────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS dispatch_stage TEXT GENERATED ALWAYS AS (
    CASE
      WHEN acknowledged_at IS NOT NULL THEN 'received'
      WHEN vendor_tracking_number IS NOT NULL THEN 'in_transit'
      WHEN vendor_dispatch_date IS NOT NULL THEN 'shipped'
      WHEN sent_to_vendor_at IS NOT NULL THEN 'draft'
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_po_dispatch_stage
  ON purchase_orders (dispatch_stage)
  WHERE dispatch_stage IS NOT NULL;

-- ─── 3. Back-fill ────────────────────────────────────────────────────────────
UPDATE purchase_orders
   SET sent_to_vendor_at = COALESCE(dispatched_at, updated_at)
 WHERE status IN ('dispatched', 'acknowledged')
   AND sent_to_vendor_at IS NULL;

-- ─── 4. Cascade helpers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_cascade_po_approval_to_boq(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Competitive path: via rfq_awards → rfq_items → project_boq_items
  UPDATE project_boq_items
     SET procurement_status = 'order_placed'
   WHERE procurement_status = 'yet_to_place'
     AND id IN (
       SELECT ri.boq_item_id FROM rfq_awards a
         JOIN rfq_items ri ON ri.id = a.rfq_item_id
        WHERE a.purchase_order_id = p_po_id
     );

  -- Quick-PO path: direct purchase_order_id on project_boq_items
  UPDATE project_boq_items
     SET procurement_status = 'order_placed'
   WHERE procurement_status = 'yet_to_place'
     AND purchase_order_id = p_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_cascade_po_receipt_to_boq(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_unfinished INTEGER;
BEGIN
  SELECT project_id INTO v_project_id FROM purchase_orders WHERE id = p_po_id;
  IF v_project_id IS NULL THEN RETURN; END IF;

  -- Competitive path
  UPDATE project_boq_items
     SET procurement_status = 'received'
   WHERE procurement_status = 'order_placed'
     AND id IN (
       SELECT ri.boq_item_id FROM rfq_awards a
         JOIN rfq_items ri ON ri.id = a.rfq_item_id
        WHERE a.purchase_order_id = p_po_id
     );

  -- Quick-PO path
  UPDATE project_boq_items
     SET procurement_status = 'received'
   WHERE procurement_status = 'order_placed'
     AND purchase_order_id = p_po_id;

  -- Project-level rollup
  SELECT COUNT(*) INTO v_unfinished
    FROM project_boq_items
   WHERE project_id = v_project_id
     AND procurement_status IN ('yet_to_place', 'order_placed');

  IF v_unfinished = 0 THEN
    UPDATE projects
       SET procurement_status = 'ready_to_dispatch'
     WHERE id = v_project_id;
    UPDATE project_boq_items
       SET procurement_status = 'ready_to_dispatch'
     WHERE project_id = v_project_id
       AND procurement_status = 'received';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cascade_po_approval_to_boq(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_cascade_po_receipt_to_boq(UUID) TO authenticated;

-- =============================================================================
-- Verification
-- =============================================================================
-- After apply, run:
--   SELECT dispatch_stage, COUNT(*) FROM purchase_orders GROUP BY 1;
--   SELECT COUNT(*) FROM purchase_orders
--     WHERE sent_to_vendor_at IS NULL AND status IN ('dispatched','acknowledged');
--   -- should be 0
-- =============================================================================
```

**2. Apply to dev via Supabase MCP** (`mcp__..._apply_migration`). Verify:
- `SELECT dispatch_stage, COUNT(*) FROM purchase_orders GROUP BY 1;`
- `SELECT COUNT(*) FROM purchase_orders WHERE sent_to_vendor_at IS NULL AND status IN ('dispatched','acknowledged');` → must be 0.

**3. Regenerate types.** Run the existing script / `supabase gen types typescript --linked > packages/types/database.ts`. New columns must appear on `purchase_orders`.

---

## Phase 1 — BOQ inline edit + PDF (Tab 1)

**1. `apps/erp/src/lib/procurement-actions.ts` — add `updateBoqItemQtyRate`.**

```typescript
export async function updateBoqItemQtyRate(input: {
  boqItemId: string;
  quantity: number;
  unitPrice: number;
}): Promise<ActionResult<{ totalPrice: number }>> {
  const op = '[updateBoqItemQtyRate]';
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Role gate
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role;
    if (!role || !['founder', 'project_manager', 'purchase_officer'].includes(role)) {
      return err('Not authorised to edit BOQ');
    }

    // Validate inputs
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return err('Quantity must be > 0');
    if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) return err('Rate must be ≥ 0');

    // Read current for audit + state guard
    const { data: current, error: readErr } = await supabase
      .from('project_boq_items')
      .select('id, project_id, quantity, unit_price, total_price, procurement_status, gst_rate')
      .eq('id', input.boqItemId)
      .maybeSingle();
    if (readErr) return err(readErr.message, readErr.code);
    if (!current) return err('BOQ item not found');
    if (current.procurement_status !== 'yet_to_place') {
      return err(`Cannot edit — item is ${current.procurement_status.replace('_', ' ')}`);
    }

    // Compute new total (GST exclusive to match existing schema; adjust if total_price is GST inclusive — check existing rows first)
    const newSubtotal = input.quantity * input.unitPrice;
    const gstRate = Number(current.gst_rate ?? 0);
    const newTotal = newSubtotal * (1 + gstRate / 100);

    const { error: updErr } = await supabase
      .from('project_boq_items')
      .update({
        quantity: input.quantity,
        unit_price: input.unitPrice,
        total_price: newTotal,
      })
      .eq('id', input.boqItemId);
    if (updErr) return err(updErr.message, updErr.code);

    await logProcurementAudit(supabase, {
      entityType: 'boq_item',
      entityId: input.boqItemId,
      action: 'qty_rate_edited',
      actorId: user.id,
      oldValue: {
        quantity: current.quantity,
        unit_price: current.unit_price,
        total_price: current.total_price,
      },
      newValue: {
        quantity: input.quantity,
        unit_price: input.unitPrice,
        total_price: newTotal,
      },
    });

    revalidatePath(`/procurement/project/${current.project_id}`);
    return ok({ totalPrice: newTotal });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
```

**2. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/boq-editable-table.tsx` — add inline edit.**

- Add `editingId` + `draft: { quantity: string; rate: string }` state.
- Inside each row's qty/rate cells, when `editingId === item.id`: render `<input>`s. Otherwise: current read-only display plus a pencil icon button (lucide `Pencil`).
- Pencil click: set `editingId=item.id`, seed draft from current values.
- Two inline buttons: `Save` (calls `updateBoqItemQtyRate`), `Cancel` (resets draft).
- Disable pencil (render greyed with tooltip) if `item.procurement_status !== 'yet_to_place'`.
- Only show pencil for roles that can edit — pass `viewerRole` through; gate: `['founder','project_manager','purchase_officer'].includes(viewerRole)`.

**3. `apps/erp/src/lib/pdf/boq-pdf.tsx` — new BOQ PDF document.**

Pattern-match the existing `purchase-order-pdf.tsx`. Props:

```typescript
export interface BoqPdfProps {
  project: {
    project_number: string;
    customer_name: string;
    site_address?: string | null;
  };
  items: Array<{
    line_number: number;
    item_category: string;
    item_description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    hsn_code?: string | null;
  }>;
  generatedBy: string;
  generatedAt: string; // ISO
}
```

Layout: Shiroi letterhead (logo + company name from `apps/erp/public` — re-use same assets as the PO PDF), project header block (number + customer + site), item table (# / Category / Description / HSN / Unit / Qty / Rate / Amount), grand total footer, "Generated by {user}, {timestamp} IST".

**4. `apps/erp/src/components/procurement/boq-download-button.tsx` — client button.**

Fetches current BOQ state from props, calls `pdf(<BoqPdf {...} />).toBlob()`, triggers browser download with filename `BOQ-{project_number}-{YYYYMMDD}.pdf`.

**5. Wire the download button into `tab-boq.tsx` or `boq-editable-table.tsx` action bar**, passing `projectNumber`, `customerName`, `items`, and the current user's full name (pull from profiles, passed down from the page).

---

## Phase 2 — Vendor typeahead (Tab 2)

**1. `apps/erp/src/lib/procurement-queries.ts` — add `searchVendors`.**

```typescript
export async function searchVendors(q: string, limit = 10) {
  const supabase = await createClient();
  const query = q.trim();
  if (query.length < 2) return [];
  const { data, error } = await supabase
    .from('vendors')
    .select('id, company_name, contact_person, phone, email')
    .or(`company_name.ilike.%${query}%,contact_person.ilike.%${query}%`)
    .eq('is_active', true)
    .order('company_name')
    .limit(limit);
  if (error) {
    console.error('[searchVendors]', error);
    return [];
  }
  return data ?? [];
}
```

(If `is_active` column doesn't exist on vendors, drop that filter — the existing `getVendorsList` implementation will tell you.)

**2. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/vendor-search-combobox.tsx` — new client component.**

- Controlled text input → debounced 250ms → calls `searchVendors` via a server action wrapper (or a fetch to a small `/api/procurement/vendor-search` route).
- Dropdown: list of matches, "+ Add new vendor" row at the bottom when query is 2+ chars (always visible, even if matches exist).
- Selection: adds vendor to a parent-controlled `selectedVendors` array (chip list above input).
- "+ Add new vendor" opens `CreateVendorAdHocDialog` — reuse existing component.
- Escape / click-outside closes dropdown.

**3. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/send-rfq-panel.tsx` — replace the vendor table.**

- Delete the existing `<table>` for vendors.
- Insert `<VendorSearchCombobox selected={...} onChange={...} />`.
- Everything else (BOQ items selector, deadline picker, submit) unchanged.

---

## Phase 3 — RFQ list: invitation-level rows (Tab 2)

**1. `apps/erp/src/lib/rfq-queries.ts` — extend `listRfqsForProject`.**

Already returns `invitationCount` + `submittedCount`. Add a nested `invitations` array per RFQ, shape:

```typescript
Array<{
  id: string;
  status: string;
  vendor: { id: string; company_name: string; contact_person: string | null };
  categories: string[]; // distinct categories from rfq_items on the parent
  itemCount: number;
  sent_via_channels: string[];
  access_token: string; // for the public portal link
}>
```

**2. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-rfq.tsx` — expandable list.**

- Parent row columns: RFQ # | Status | Vendors count | Submitted count | Deadline | Created | Expand chevron.
- Child row columns (renders when expanded): Vendor Name | Category | Items | Created Date | Deadline | Status | Actions.
- Category cell: `rfq.invitations[i].categories.slice(0,2).join(', ') + (len > 2 ? ' +' + (len-2) + ' more' : '')` with full list in tooltip.
- Actions cell: reuse the Gmail / WhatsApp / Copy buttons from `send-rfq-modal.tsx`. Extract these into a small `<InvitationActionButtons invitation={...} />` component at `_client/invitation-action-buttons.tsx` so they can be re-used.
- "Created Date" format: `DD-MMM-YYYY HH:mm` — extend `formatDate` or use a new `formatDateTime`.

---

## Phase 4 — Comparison tab: three new rows (Tab 3)

**1. `apps/erp/src/lib/rfq-queries.ts` — extend `getRfqComparisonData`.**

On each quote entry in the matrix, add `paymentTerms: string | null`, `deliveryDays: number | null`, `notes: string | null`. Pull from `rfq_quotes.payment_terms / delivery_period_days / notes`.

Because these fields can vary by line item within a vendor's quote, compute a per-vendor rollup: mode value across all line items for that vendor. If all match, that's the value. If not, set a flag `varies: true`.

Expected shape at the vendor level:

```typescript
vendorSummary: Array<{
  invitationId: string;
  vendorName: string;
  paymentTerms: string | null;
  paymentTermsVaries: boolean;
  deliveryDays: number | null;
  deliveryDaysVaries: boolean;
  notes: string | null;
  grandTotal: number;
  // ... existing fields
}>
```

**2. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/comparison-matrix.tsx` — render three new rows.**

After the `<tbody>` that renders item rows, add three more `<tr>` elements below (before the matrix closes), each with `<td>` cells aligned to the vendor columns.

- Row 1: "Payment Terms" | (ignore qty/PB rate cols) | per-vendor value with label lookup: `advance → "Full advance"`, `30_days → "Net 30"`, `60_days → "Net 60"`, `against_delivery → "Against delivery"`. Append "(varies)" in small text if `paymentTermsVaries`.
- Row 2: "Delivery Time" | ... | `{days} days` or "—" if null.
- Row 3: "Notes" | ... | truncated to 60 chars + tooltip; "—" if null/empty.

Visually separate these rows from the item grid with a top border.

---

## Phase 5 — PO Send button + dialog (Tab 4)

**1. `apps/erp/src/lib/po-actions.ts` — add `sendPOToVendor`.**

```typescript
export async function sendPOToVendor(input: {
  poId: string;
  channels: Array<'email' | 'whatsapp'>;
}): Promise<ActionResult<void>> {
  const op = '[sendPOToVendor]';
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Role gate
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role;
    if (!role || !['founder', 'project_manager', 'purchase_officer'].includes(role)) {
      return err('Not authorised to send POs');
    }

    if (input.channels.length === 0) return err('Select at least one channel');
    const allowed = new Set(['email', 'whatsapp']);
    const channels = input.channels.filter((c) => allowed.has(c));
    if (channels.length === 0) return err('Invalid channel');

    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id, po_number, project_id, approval_status, sent_to_vendor_at')
      .eq('id', input.poId)
      .maybeSingle();
    if (poErr) return err(poErr.message, poErr.code);
    if (!po) return err('PO not found');
    if (po.approval_status !== 'approved') return err('PO must be approved before sending');
    if (po.sent_to_vendor_at) return err('PO already sent');

    const { error: updErr } = await supabase
      .from('purchase_orders')
      .update({
        sent_to_vendor_at: new Date().toISOString(),
        sent_via_channels: channels,
        status: 'dispatched', // reuses existing enum
      })
      .eq('id', input.poId);
    if (updErr) return err(updErr.message, updErr.code);

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: input.poId,
      action: 'sent_to_vendor',
      actorId: user.id,
      newValue: { channels, sent_to_vendor_at: new Date().toISOString() },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${input.poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
```

**2. `apps/erp/src/lib/po-actions.ts` — modify `approvePO` to call cascade helper.**

After the PO update + notification + audit block, before the final `revalidatePath`:

```typescript
// Cascade approval → BOQ line items flip to order_placed
const { error: cascadeErr } = await supabase.rpc('fn_cascade_po_approval_to_boq', { p_po_id: poId });
if (cascadeErr) {
  console.error(`${op} cascade to BOQ failed`, cascadeErr);
  // Not fatal — log it and continue. Audit trail logs the approval.
}
await logProcurementAudit(supabase, {
  entityType: 'purchase_order',
  entityId: poId,
  action: 'approval_cascade_to_boq',
  actorId: user.id,
});
```

**3. `apps/erp/src/lib/po-actions.ts` — modify `markPOAcknowledged` to call cascade helper + widen role.**

- Role gate: accept `founder | purchase_officer | project_manager`.
- After PO update:

```typescript
const { error: cascadeErr } = await supabase.rpc('fn_cascade_po_receipt_to_boq', { p_po_id: poId });
if (cascadeErr) console.error(`${op} cascade to BOQ failed`, cascadeErr);

await logProcurementAudit(supabase, {
  entityType: 'purchase_order',
  entityId: poId,
  action: 'receipt_cascade_to_boq',
  actorId: user.id,
});
```

**4. `apps/erp/src/lib/po-actions.ts` — widen `recordVendorDispatch` role gate** to include `project_manager`.

**5. `apps/erp/src/lib/procurement-actions.ts` — conditionalise BOQ flip in `createPOsFromAssignedItems`.**

Find the two `update({ procurement_status: 'order_placed' })` sites. Gate them by the PO's `approval_status`:

```typescript
// Only flip BOQ state if the PO doesn't need approval (founder-created)
if (po.approval_status === 'approved' || po.approval_status === 'not_required') {
  await supabase.from('project_boq_items').update({ ... }).in('id', boqItemIds);
}
```

**6. `apps/erp/src/lib/rfq-actions.ts` — same conditional flip in `generatePOsFromAwards`.**

If the file currently sets BOQ items to `order_placed` on PO generation, wrap it in the same `approval_status` check.

**7. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/po-send-dialog.tsx` — new client dialog.**

Props:
```typescript
{ po: { id, po_number }, vendor: { company_name, email, phone }, onDone: () => void }
```

Dialog body:
- PO # + vendor name (read-only).
- Vendor email (read-only, with checkbox "Send via Email").
- Vendor phone (read-only, with checkbox "Send via WhatsApp").
- Error if both unchecked on submit.
- On submit: `sendPOToVendor({ poId, channels })`. On success: open email/WhatsApp deep links in new tabs (reuse the Gmail/wa.me URL builders from `send-rfq-modal.tsx`), then `router.refresh()` and close.

**8. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-po.tsx` — render Send button.**

In the Actions column for each PO row:
- If `po.approval_status === 'approved' && !po.sent_to_vendor_at && ['founder','project_manager','purchase_officer'].includes(viewerRole)`: render `<Button>` that opens `<PoSendDialog />`. Place it *before* the existing action icons.
- If already sent: show small "Sent {formatDate(sent_to_vendor_at)}" text instead.

---

## Phase 6 — Dispatch tab: derived status + cascade (Tab 5)

**1. `apps/erp/src/lib/procurement-queries.ts` — `POListItem` type.**

Add `sent_to_vendor_at`, `sent_via_channels`, `dispatch_stage` to the select list and the type. The type regen from Phase 0 provides these, so it's mostly about propagating them through the query.

**2. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_tabs/tab-dispatch.tsx` — re-wire the Status column.**

- Replace the `<POStatusBadge status={po.status} />` in the Status column with a `<DispatchStageBadge stage={po.dispatch_stage} />` — new small component (can live in the same file).
- Mapping:
  - `draft` → grey "Draft"
  - `shipped` → blue "Shipped"
  - `in_transit` → amber "In transit"
  - `received` → green "Received"
  - `null` (PO not yet sent) → fall back to PO's overall status
- Replace the existing `dispatched_at` display in the "Sent to vendor" column with `sent_to_vendor_at`, falling back to `dispatched_at` if `sent_to_vendor_at` is null (legacy POs that weren't back-filled).

**3. `apps/erp/src/app/(erp)/procurement/project/[projectId]/_client/dispatch-actions.tsx` — role widening.**

Change `const canAct = viewerRole === 'purchase_officer' || viewerRole === 'founder';` to include `project_manager`.

---

## Phase 7 — Verification + docs

**1. Typecheck + lint.**
```
pnpm check-types
pnpm lint
```
Zero warnings / errors. Regenerate types if TS errors come from missing columns.

**2. Smoke-test the four main flows on dev:**
- BOQ inline edit → audit row appears.
- Vendor typeahead finds a real vendor and a fake one (shows "+ Add new").
- Comparison tab shows payment terms / delivery / notes for an RFQ with submitted quotes.
- Founder approves a PM-created PO → BOQ items flip to order_placed → PM sees Send button → sends → dispatch_stage='draft'.

**3. Update docs (Phase 8 below).**

---

## Phase 8 — Documentation + commit

### Files to update (in this order)

1. **`docs/modules/purchase.md`**
   - Add a "2026-04-17 — Feedback pass" row at the top of Past Decisions with a short bullet of each change.
   - Update the role matrix to match §6 of the spec.
   - Extend the Key Files list: `boq-pdf.tsx`, `vendor-search-combobox.tsx`, `po-send-dialog.tsx`, `invitation-action-buttons.tsx`, `boq-download-button.tsx`.
   - Add a "Status lifecycle" subsection that lists the four dispatch_stage values and when they fire.

2. **`docs/CURRENT_STATUS.md`**
   - Dev migration: 061 → 062.
   - Prod pending: 49 → 50.
   - Update the "In flight this week" table — add a new row "Purchase v2 feedback pass — shipped Apr 17".

3. **`docs/CHANGELOG.md`**
   - Add one line (two max) under today's date: `**Apr 17 — Purchase v2 feedback pass (migration 062)**. Inline-edit BOQ qty/rate, BOQ PDF, vendor typeahead, invitation-level RFQ list, payment/delivery/notes in Compare, explicit Send button with channel picker, derived dispatch_stage, BOQ cascade on approve/receive. See docs/modules/purchase.md + docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md + plans/2026-04-17-purchase-v2-feedback-implementation.md.`

4. **`docs/SHIROI_MASTER_REFERENCE.md`** — only if §5.2 data-flow diagram needs the new `sent_to_vendor_at` / `dispatch_stage` columns spelled out. Add one line if so.

### Commit strategy

Squash into logical commits:

1. `feat(procurement): migration 062 + cascade helpers`
2. `feat(procurement): BOQ inline edit qty/rate + BOQ PDF (Tab 1)`
3. `feat(procurement): vendor typeahead + invitation-level RFQ list (Tab 2)`
4. `feat(procurement): payment terms / delivery / notes in Compare (Tab 3)`
5. `feat(procurement): explicit Send PO flow + approval cascade to BOQ (Tab 4)`
6. `feat(procurement): derived dispatch_stage + receipt cascade (Tab 5)`
7. `docs: Purchase v2 feedback — ship notes + spec + plan`

Push to `main` last, single `git push`.

---

## Risk list

| Risk | Mitigation |
|---|---|
| `total_price` semantics on `project_boq_items` (GST inclusive? exclusive?) — the inline edit recompute depends on this. | Before writing `updateBoqItemQtyRate`, read one existing row and confirm `total_price ≈ quantity * unit_price * (1 + gst_rate/100)`. If it's `qty × unit_price` with no GST, drop the GST multiplier. |
| `fn_cascade_po_approval_to_boq` double-flips items already at `order_placed` from the legacy createPO path. | Helper uses `WHERE procurement_status = 'yet_to_place'` — only flips items currently in that state. No double-flip. |
| Manivel's Chrome session has stale JWT from the RLS fix — might mask new bugs. | Remind Vivek in the push message to have Manivel sign out / back in before testing. |
| Vendor typeahead query hits `.or(ilike, ilike)` — ensure there's no injection. The user query is shell-safe because it goes through supabase-js parameterisation, BUT `%` and `,` chars in `q` can corrupt the `.or()` syntax. | Strip `,` and `%` from `q` before building the filter string. |
| `dispatch_stage` is a generated column — Postgres doesn't allow updating it; ensure no server code tries to write to it. | It won't — the code only reads it. The SQL generator runs on insert / update of source columns. |
| Type regen skipped by accident → TS errors on `sent_to_vendor_at` references. | Phase 0 step 3 is explicit; verify before starting Phase 1. |

---

*Plan authored 2026-04-17. Sonnet executes; Opus verifies.*
