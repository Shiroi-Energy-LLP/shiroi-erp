'use server';

// =============================================================================
// Purchase Flow (BOI Manager) — server mutation layer
// =============================================================================
// Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md
// Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md (Task 2)
//
// Every action returns ActionResult<T> and never throws across the RSC
// boundary (NEVER-DO #19). Every mutation re-resolves identity and re-checks
// the role server-side (NEVER-DO #22) against PURCHASE_WRITE_ROLES —
// matching the po_write / project_boq_items RLS (founder, project_manager,
// purchase_officer; finance is price-VISIBLE but cannot write). Intake
// additionally allows site_supervisor (spec §11) whose prices are resolved
// from the Price Book server-side and never sent to or accepted from the
// client (spec §1).
//
// Money: per-row totals are computed here with decimal.js (single-row math);
// multi-row aggregation happens ONLY in SQL RPCs (mig 210, NEVER-DO #12).
// total_price convention (matches project-bom-actions.ts / procurement-
// actions.ts / mig-151 CHECK): GST-INCLUSIVE = qty × rate × (1 + gst/100).
//
// PDF: createBoiPo renders the minimal spec-§6.2.4 document (shared helper in
// purchase-flow-pdf.tsx) and uploads it to Storage (project-files bucket,
// `<project_id>/purchase-orders/<po_number>.pdf` — the Files-tab convention,
// so the PO surfaces under the project's "Purchase Orders" folder). PDF
// failure NEVER fails the PO (spec §6.2.5) — the result carries pdfWarning
// and the download route regenerates from the frozen rows regardless.
// =============================================================================

import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getSessionContext, getCurrentEmployeeId } from '@/lib/auth';
import {
  BOI_EDITABLE_FIELDS,
  GST_OPTIONS,
  INTAKE_ROLES,
  PO_DEFAULTS,
  PRICE_VISIBLE_ROLES,
  PURCHASE_WRITE_ROLES,
  isBoiStatus,
  isProjectProcurementPriority,
  isProjectProcurementStatus,
  type ProjectProcurementPriority,
  type ProjectProcurementStatus,
  type BoiEditableField,
  type BoiLineInput,
  type BoiLineRow,
  type BoiPoMetaInput,
  type BoiPoRow,
  type BoiStatus,
  type BoiStatusTotalsResult,
  type BulkAddFromPriceBookInput,
  type CreateBoiPoInput,
  type CreateBoiPoResult,
  type IntakeItemInput,
  type PriceBookSearchResultForAction,
  type ProjectOption,
} from './purchase-flow-constants';
import {
  getBoiLineById,
  getBoiPoById,
  getBoiStatusTotals,
  searchPriceBookItems,
} from './purchase-flow-queries';
import { getBoiPoPdfData, renderBoiPoPdfBuffer } from './purchase-flow-pdf';
import type { BoiKpiFilters } from './purchase-flow-queries';

type AppRole = Database['public']['Enums']['app_role'];
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;
type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
type ProjectUpdate = Database['public']['Tables']['projects']['Update'];
type BoqItemInsert = Database['public']['Tables']['project_boq_items']['Insert'];
type BoqItemUpdate = Database['public']['Tables']['project_boq_items']['Update'];
type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update'];
type CreateBoiPoArgs = Database['public']['Functions']['create_boi_po']['Args'];

const PERMISSION_ERROR = 'You do not have permission to perform this action.';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Internal helpers (not exported — 'use server' files may only export actions)
// ---------------------------------------------------------------------------

/** Server-side role gate: re-resolves identity, never trusts the client. */
async function requireRoleIn(
  allowed: readonly AppRole[],
): Promise<ActionResult<{ role: AppRole; supabase: SupabaseServerClient }>> {
  const { role } = await getSessionContext();
  if (!role) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!allowed.includes(role)) return err(PERMISSION_ERROR, 'FORBIDDEN');
  const supabase = await createClient();
  return ok({ role, supabase });
}

/** GST-inclusive line total: qty × rate × (1 + gst/100), 2dp (decimal.js). */
function computeTotalPrice(quantity: number, unitPrice: number, gstRate: number): number {
  return new Decimal(quantity)
    .mul(unitPrice)
    .mul(new Decimal(gstRate).div(100).plus(1))
    .toDecimalPlaces(2)
    .toNumber();
}

/** Trim to null. */
function cleanText(value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  return t.length > 0 ? t : null;
}

function validateQuantity(quantity: number): string | null {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return 'Quantity must be a number greater than 0';
  }
  return null;
}

function validateUnitPrice(unitPrice: number): string | null {
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return 'Rate must be a number ≥ 0';
  }
  return null;
}

function validateGstRate(gstRate: number): string | null {
  if (!(GST_OPTIONS as readonly number[]).includes(gstRate)) {
    return `GST % must be one of ${GST_OPTIONS.join(', ')}`;
  }
  return null;
}

/** Shared validation for the full-row add/edit payload (spec §5.3). */
function validateBoiLineInput(input: BoiLineInput): string | null {
  if (!cleanText(input.projectId)) return 'Project is required';
  if (!cleanText(input.itemCategory)) return 'Category is required';
  if (!cleanText(input.itemDescription)) return 'Item is required';
  const qtyError = validateQuantity(input.quantity);
  if (qtyError) return qtyError;
  const priceError = validateUnitPrice(input.unitPrice);
  if (priceError) return priceError;
  const gstError = validateGstRate(input.gstRate);
  if (gstError) return gstError;
  if (!isBoiStatus(input.procurementStatus)) return 'Invalid status';
  return null;
}

/** Re-reads price-book rows by id server-side (client values are never the
 *  source of truth for catalog fields — spec §6.2.1 / §11). Accepts the admin
 *  client for the intake path (site_supervisor has no price_book SELECT since
 *  mig 211 — see the SYSTEM OP note in submitIntakeItems). */
async function fetchPriceBookRows(
  supabase: SupabaseServerClient | SupabaseAdminClient,
  op: string,
  ids: string[],
): Promise<
  ActionResult<
    Map<
      string,
      {
        id: string;
        item_category: string;
        item_description: string;
        brand: string | null;
        model: string | null;
        unit: string;
        vendor_name: string | null;
        base_price: number;
        gst_rate: number;
      }
    >
  >
> {
  const { data, error } = await supabase
    .from('price_book')
    .select('id, item_category, item_description, brand, model, unit, vendor_name, base_price, gst_rate')
    .in('id', ids)
    .is('deleted_at', null);

  if (error) {
    console.error(`${op} price_book read failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }
  if (!data) {
    console.error(`${op} price_book read returned null data`);
    return err('Price book lookup failed');
  }

  const byId = new Map(data.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return err(
      `${missing.length} selected price book item(s) no longer exist — refresh and try again`,
      'PB_MISSING',
    );
  }
  return ok(byId);
}

// ---------------------------------------------------------------------------
// BOI line mutations (spec §5.3 / §12)
// ---------------------------------------------------------------------------

/** Insert one BOI line from the Add Item modal. Returns the fresh row. */
export async function addBoiLine(input: BoiLineInput): Promise<ActionResult<BoiLineRow>> {
  const op = '[addBoiLine]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    const invalid = validateBoiLineInput(input);
    if (invalid) return err(invalid, 'VALIDATION');

    const insert: BoqItemInsert = {
      project_id: input.projectId,
      item_category: input.itemCategory.trim(),
      item_description: input.itemDescription.trim(),
      brand: cleanText(input.brand),
      model: cleanText(input.model),
      quantity: input.quantity,
      unit: cleanText(input.unit) ?? 'Nos',
      procurement_status: input.procurementStatus,
      unit_price: input.unitPrice,
      gst_rate: input.gstRate,
      total_price: computeTotalPrice(input.quantity, input.unitPrice, input.gstRate),
      vendor_name: cleanText(input.vendorName),
      price_book_id: cleanText(input.priceBookId),
    };

    const { data, error } = await supabase
      .from('project_boq_items')
      .insert(insert)
      .select('id')
      .single();

    if (error) {
      console.error(`${op} insert failed:`, { input: { ...input }, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('Insert returned no row');

    const fresh = await getBoiLineById(data.id);
    if (!fresh) return err('Saved, but failed to reload the row — refresh the list');

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok(fresh);
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/** Full-row update from the Edit Item modal. Returns the fresh row. */
export async function updateBoiLine(
  id: string,
  input: BoiLineInput,
): Promise<ActionResult<BoiLineRow>> {
  const op = '[updateBoiLine]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(id)) return err('Missing BOI line id', 'VALIDATION');
    const invalid = validateBoiLineInput(input);
    if (invalid) return err(invalid, 'VALIDATION');

    const update: BoqItemUpdate = {
      project_id: input.projectId,
      item_category: input.itemCategory.trim(),
      item_description: input.itemDescription.trim(),
      brand: cleanText(input.brand),
      model: cleanText(input.model),
      quantity: input.quantity,
      unit: cleanText(input.unit) ?? 'Nos',
      procurement_status: input.procurementStatus,
      unit_price: input.unitPrice,
      gst_rate: input.gstRate,
      total_price: computeTotalPrice(input.quantity, input.unitPrice, input.gstRate),
      vendor_name: cleanText(input.vendorName),
      price_book_id: cleanText(input.priceBookId),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('project_boq_items')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`${op} update failed:`, { id, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('BOI line not found (it may have been deleted)', 'NOT_FOUND');

    const fresh = await getBoiLineById(id);
    if (!fresh) return err('Saved, but failed to reload the row — refresh the list');

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok(fresh);
  } catch (e) {
    console.error(`${op} threw:`, { id, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Single-cell inline commit (spec §12). Whitelisted fields only; recomputes
 * the GST-inclusive total when a money field changes; returns the fully
 * recalculated fresh row for client cache patching.
 */
export async function updateBoiLineField(
  id: string,
  field: BoiEditableField,
  value: string | number,
): Promise<ActionResult<BoiLineRow>> {
  const op = '[updateBoiLineField]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(id)) return err('Missing BOI line id', 'VALIDATION');
    // Runtime whitelist — the TS type alone can be bypassed by a crafted call.
    if (!(BOI_EDITABLE_FIELDS as readonly string[]).includes(field)) {
      return err(`Field "${String(field)}" is not inline-editable`, 'FIELD_NOT_ALLOWED');
    }

    const { data: current, error: readError } = await supabase
      .from('project_boq_items')
      .select('id, quantity, unit_price, gst_rate')
      .eq('id', id)
      .maybeSingle();

    if (readError) {
      console.error(`${op} read failed:`, { id, code: readError.code, message: readError.message });
      return err(readError.message, readError.code);
    }
    if (!current) return err('BOI line not found (it may have been deleted)', 'NOT_FOUND');

    const update: BoqItemUpdate = { updated_at: new Date().toISOString() };

    if (field === 'quantity' || field === 'unit_price' || field === 'gst_rate') {
      const num = typeof value === 'number' ? value : Number(value);
      if (field === 'quantity') {
        const invalid = validateQuantity(num);
        if (invalid) return err(invalid, 'VALIDATION');
        update.quantity = num;
      } else if (field === 'unit_price') {
        const invalid = validateUnitPrice(num);
        if (invalid) return err(invalid, 'VALIDATION');
        update.unit_price = num;
      } else {
        const invalid = validateGstRate(num);
        if (invalid) return err(invalid, 'VALIDATION');
        update.gst_rate = num;
      }
      update.total_price = computeTotalPrice(
        update.quantity ?? current.quantity,
        update.unit_price ?? current.unit_price,
        update.gst_rate ?? current.gst_rate,
      );
    } else if (field === 'vendor_name') {
      if (typeof value !== 'string') return err('Vendor must be text', 'VALIDATION');
      update.vendor_name = cleanText(value);
    } else {
      // procurement_status — only the 5 canonical statuses are settable
      if (typeof value !== 'string' || !isBoiStatus(value)) {
        return err('Invalid status', 'VALIDATION');
      }
      update.procurement_status = value;
    }

    const { data, error } = await supabase
      .from('project_boq_items')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`${op} update failed:`, { id, field, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('BOI line not found (it may have been deleted)', 'NOT_FOUND');

    const fresh = await getBoiLineById(id);
    if (!fresh) return err('Saved, but failed to reload the row — refresh the list');

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok(fresh);
  } catch (e) {
    console.error(`${op} threw:`, { id, field, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * "Add Multiple from Price Book" (spec §5.4): catalog fields come from the
 * server-side PB re-read; qty/rate/gst come from the modal's editable
 * mini-fields (defaulting to the PB values when omitted).
 */
export async function addBoiLinesFromPriceBook(
  input: BulkAddFromPriceBookInput,
): Promise<ActionResult<{ inserted: number }>> {
  const op = '[addBoiLinesFromPriceBook]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(input.projectId)) return err('Project is required', 'VALIDATION');
    if (!isBoiStatus(input.status)) return err('Invalid status', 'VALIDATION');
    if (!input.items || input.items.length === 0) return err('Select at least one item', 'VALIDATION');
    if (input.items.length > 200) return err('Too many items in one batch (max 200)', 'VALIDATION');

    const pb = await fetchPriceBookRows(
      supabase,
      op,
      input.items.map((i) => i.priceBookId),
    );
    if (!pb.success) return pb;

    const inserts: BoqItemInsert[] = [];
    for (const item of input.items) {
      const row = pb.data.get(item.priceBookId);
      if (!row) return err('Price book item missing', 'PB_MISSING');
      const quantity = item.quantity;
      const unitPrice = item.unitPrice ?? row.base_price;
      const gstRate = item.gstRate ?? row.gst_rate;
      const qtyError = validateQuantity(quantity);
      if (qtyError) return err(`${row.item_description}: ${qtyError}`, 'VALIDATION');
      const priceError = validateUnitPrice(unitPrice);
      if (priceError) return err(`${row.item_description}: ${priceError}`, 'VALIDATION');
      if (item.gstRate !== undefined) {
        const gstError = validateGstRate(gstRate);
        if (gstError) return err(`${row.item_description}: ${gstError}`, 'VALIDATION');
      }
      inserts.push({
        project_id: input.projectId,
        price_book_id: row.id,
        item_category: row.item_category,
        item_description: row.item_description,
        brand: row.brand,
        model: row.model,
        unit: row.unit,
        vendor_name: row.vendor_name,
        quantity,
        unit_price: unitPrice,
        gst_rate: gstRate,
        total_price: computeTotalPrice(quantity, unitPrice, gstRate),
        procurement_status: input.status,
      });
    }

    const { error } = await supabase.from('project_boq_items').insert(inserts);
    if (error) {
      console.error(`${op} insert failed:`, { projectId: input.projectId, count: inserts.length, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok({ inserted: inserts.length });
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/** Bulk status change from the selection bar (spec §5.5). */
export async function bulkUpdateBoiStatus(
  ids: string[],
  status: BoiStatus,
): Promise<ActionResult<{ updated: number }>> {
  const op = '[bulkUpdateBoiStatus]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!ids || ids.length === 0) return err('No items selected', 'VALIDATION');
    if (!isBoiStatus(status)) return err('Invalid status', 'VALIDATION');

    const { data, error } = await supabase
      .from('project_boq_items')
      .update({ procurement_status: status, updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');

    if (error) {
      console.error(`${op} update failed:`, { count: ids.length, status, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/purchase');
    return ok({ updated: data?.length ?? 0 });
  } catch (e) {
    console.error(`${op} threw:`, { status, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/** Bulk delete from the selection bar (spec §5.5) or a single-row 🗑. */
export async function deleteBoiLines(ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  const op = '[deleteBoiLines]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!ids || ids.length === 0) return err('No items selected', 'VALIDATION');

    const { data, error } = await supabase
      .from('project_boq_items')
      .delete()
      .in('id', ids)
      .select('id');

    if (error) {
      console.error(`${op} delete failed:`, { count: ids.length, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      // FK from purchase_order_items.boq_item_id blocks deleting PO-frozen lines
      if (error.code === '23503') {
        return err(
          'Some items are locked into a PO — delete the PO first (or leave those lines out)',
          error.code,
        );
      }
      return err(error.message, error.code);
    }

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok({ deleted: data?.length ?? 0 });
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// PO actions (spec §6 / §7)
// ---------------------------------------------------------------------------

/**
 * Instant PO from selected BOI lines — calls the atomic create_boi_po RPC
 * (mig 210): server re-reads the lines by id, computes totals in SQL, inserts
 * the source='boi_quick' PO + frozen items, flips lines to order_placed.
 * Then renders the minimal PDF (spec §6.2.4) and uploads it to Storage;
 * PDF/upload failure does NOT fail the PO (spec §6.2.5) — the result comes
 * back success with pdfWarning set instead.
 */
export async function createBoiPo(
  input: CreateBoiPoInput,
): Promise<ActionResult<CreateBoiPoResult>> {
  const op = '[createBoiPo]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!input.itemIds || input.itemIds.length === 0) return err('No items selected', 'VALIDATION');
    if (!cleanText(input.projectId)) return err('Project is required', 'VALIDATION');
    const vendorName = cleanText(input.vendorName);
    if (!vendorName) return err('Vendor name is required', 'VALIDATION');
    const deliveryDate = cleanText(input.deliveryDate);
    if (deliveryDate && !DATE_RE.test(deliveryDate)) {
      return err('Delivery date must be YYYY-MM-DD', 'VALIDATION');
    }

    // p_prepared_by is employees.id — NEVER the profile/auth uid (FK footgun).
    const employeeId = await getCurrentEmployeeId();
    if (!employeeId) return err('Your login has no linked employee record — ask an admin', 'EMPLOYEE_MISSING');

    // The generated Args type marks every param as non-null string, but the
    // SQL params are nullable (DATE/TEXT with no default) and PostgREST passes
    // JSON null through fine — hence the narrowly-typed cast (NOT `as any`).
    const args = {
      p_item_ids: input.itemIds,
      p_project_id: input.projectId,
      p_vendor_name: vendorName,
      p_delivery_date: deliveryDate,
      p_payment_terms: cleanText(input.paymentTerms) ?? PO_DEFAULTS.paymentTerms,
      p_transport: cleanText(input.transport) ?? PO_DEFAULTS.transport,
      p_delivery_place: cleanText(input.deliveryPlace),
      p_prepared_by: employeeId,
    };
    const { data, error } = await supabase.rpc('create_boi_po', args as CreateBoiPoArgs);

    if (error) {
      console.error(`${op} RPC failed:`, { itemCount: input.itemIds.length, projectId: input.projectId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    const row = data?.[0];
    if (!row) return err('PO creation returned no result');

    // --- PDF render + Storage upload (never fails the PO — spec §6.2.5) ----
    let pdfWarning: string | undefined;
    try {
      const pdfData = await getBoiPoPdfData(supabase, row.out_po_id);
      if (!pdfData) throw new Error('PO reload for PDF returned no data');
      const pdfBuffer = await renderBoiPoPdfBuffer(pdfData);

      // Files-tab convention (mig 010): project-files/<project_id>/<folder>/<file>.
      // The 'purchase-orders' folder is a known Files-tab category, so the PDF
      // also surfaces on the project's Files page.
      const storagePath = `${input.projectId}/purchase-orders/${row.out_po_number}.pdf`;

      // SYSTEM OP: the project-files INSERT storage policy (mig 010) covers
      // founder/project_manager/site_supervisor only — purchase_officer must
      // also be able to store the PO PDF, so the upload runs on the admin
      // client. Path + content are fully server-derived (nothing client-sent).
      const admin = createAdminClient();
      const { error: uploadError } = await admin.storage
        .from('project-files')
        .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      // po_write RLS covers PURCHASE_WRITE_ROLES — user client is fine here.
      const { error: pathError } = await supabase
        .from('purchase_orders')
        .update({ pdf_storage_path: storagePath, updated_at: new Date().toISOString() })
        .eq('id', row.out_po_id);
      if (pathError) throw new Error(`pdf_storage_path save failed: ${pathError.message}`);
    } catch (pdfErr) {
      console.error(`${op} PDF render/upload failed (PO ${row.out_po_number} still created):`, {
        poId: row.out_po_id,
        error: pdfErr instanceof Error ? pdfErr.message : pdfErr,
        timestamp: new Date().toISOString(),
      });
      pdfWarning =
        'PO created, but storing the PDF failed — the Download button regenerates it anytime.';
    }

    revalidatePath('/purchase');
    revalidatePath('/purchase/orders');
    revalidatePath('/purchase/projects');
    return ok({ poId: row.out_po_id, poNumber: row.out_po_number, pdfWarning });
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Edits PO metadata ONLY (spec §7): items/amounts stay frozen and the PDF is
 * not regenerated. undefined = unchanged, null = cleared. When the vendor
 * name changes, vendor_id is best-effort re-matched (may become null).
 */
export async function updateBoiPoMeta(
  poId: string,
  meta: BoiPoMetaInput,
): Promise<ActionResult<BoiPoRow>> {
  const op = '[updateBoiPoMeta]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(poId)) return err('Missing PO id', 'VALIDATION');

    const { data: existing, error: readError } = await supabase
      .from('purchase_orders')
      .select('id, source')
      .eq('id', poId)
      .maybeSingle();
    if (readError) {
      console.error(`${op} read failed:`, { poId, code: readError.code, message: readError.message });
      return err(readError.message, readError.code);
    }
    if (!existing) return err('PO not found', 'NOT_FOUND');
    if (existing.source !== 'boi_quick') {
      return err('Only quick POs can be edited here', 'NOT_BOI_PO');
    }

    const update: PurchaseOrderUpdate = {};
    if (meta.projectId !== undefined) update.project_id = cleanText(meta.projectId);
    if (meta.deliveryDate !== undefined) {
      const d = cleanText(meta.deliveryDate);
      if (d && !DATE_RE.test(d)) return err('Delivery date must be YYYY-MM-DD', 'VALIDATION');
      update.expected_delivery_date = d;
    }
    if (meta.paymentTerms !== undefined) update.payment_terms = cleanText(meta.paymentTerms);
    if (meta.transport !== undefined) update.transport = cleanText(meta.transport);
    if (meta.deliveryPlace !== undefined) update.delivery_place = cleanText(meta.deliveryPlace);
    if (meta.vendorName !== undefined) {
      const vendorName = cleanText(meta.vendorName);
      if (!vendorName) return err('Vendor name cannot be empty', 'VALIDATION');
      update.vendor_name = vendorName;
      // Best-effort vendor re-match (case-insensitive exact, like the RPC).
      const escaped = vendorName.replace(/[%_]/g, '\\$&');
      const { data: vendor, error: vendorError } = await supabase
        .from('vendors')
        .select('id')
        .ilike('company_name', escaped)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (vendorError) {
        console.error(`${op} vendor re-match failed (non-fatal):`, { code: vendorError.code, message: vendorError.message });
      }
      update.vendor_id = vendor?.id ?? null;
    }

    if (Object.keys(update).length === 0) return err('Nothing to update', 'VALIDATION');
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', poId)
      .eq('source', 'boi_quick')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`${op} update failed:`, { poId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('PO not found (it may have been deleted)', 'NOT_FOUND');

    const fresh = await getBoiPoById(poId);
    if (!fresh) return err('Saved, but failed to reload the PO — refresh the list');

    revalidatePath('/purchase/orders');
    return ok(fresh);
  } catch (e) {
    console.error(`${op} threw:`, { poId, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Deletes a quick PO via the delete_boi_po RPC (spec §7). revertItems=true
 * also flips the PO's lines back to 'Yet to Place'; false only detaches them.
 * Guarded to source='boi_quick' — the RPC itself would delete any PO by id.
 */
export async function deleteBoiPoAction(
  poId: string,
  revertItems: boolean,
): Promise<ActionResult<void>> {
  const op = '[deleteBoiPoAction]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(poId)) return err('Missing PO id', 'VALIDATION');

    const { data: existing, error: readError } = await supabase
      .from('purchase_orders')
      .select('id, source')
      .eq('id', poId)
      .maybeSingle();
    if (readError) {
      console.error(`${op} read failed:`, { poId, code: readError.code, message: readError.message });
      return err(readError.message, readError.code);
    }
    if (!existing) return err('PO not found', 'NOT_FOUND');
    if (existing.source !== 'boi_quick') {
      return err('Only quick POs can be deleted here', 'NOT_BOI_PO');
    }

    const { error } = await supabase.rpc('delete_boi_po', {
      p_po_id: poId,
      p_revert: revertItems,
    });
    if (error) {
      console.error(`${op} RPC failed:`, { poId, revertItems, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/purchase');
    revalidatePath('/purchase/orders');
    revalidatePath('/purchase/projects');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw:`, { poId, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Quick project creation (plan delta — combobox "type a brand-new project")
// ---------------------------------------------------------------------------

/**
 * Mints a minimal real `projects` row from a typed name so the BOI combobox
 * can create projects inline (user requirement; plan delta). The row has no
 * sales origin: lead_id/proposal_id stay NULL (made nullable in mig 211) and
 * project_number comes from generate_doc_number('PROJ') — the same convention
 * createProjectFromLead uses. The mig-104 BEFORE INSERT trigger fills
 * project_manager_id with the latest active PM.
 *
 * Idempotent combobox behavior: a case-insensitive display-name match against
 * existing non-deleted projects returns the EXISTING project instead of
 * erroring (display name = COALESCE(NULLIF(project_name,''), customer_name),
 * same as getProjectOptions).
 */
export async function quickCreateProject(name: string): Promise<ActionResult<ProjectOption>> {
  const op = '[quickCreateProject]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    const trimmed = (name ?? '').trim();
    if (!trimmed) return err('Project name is required', 'VALIDATION');
    if (trimmed.length > 200) return err('Project name is too long (max 200 characters)', 'VALIDATION');

    // Case-insensitive duplicate check. Single-column .ilike is parameterized
    // (no PostgREST .or() syntax hazards), and a pattern with %/_ escaped and
    // no wildcards added is exactly case-insensitive equality.
    const exactPattern = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
    const dupSelect = 'id, project_name, customer_name, project_number';
    const [byProjectName, byCustomerName] = await Promise.all([
      supabase
        .from('projects')
        .select(dupSelect)
        .ilike('project_name', exactPattern)
        .is('deleted_at', null)
        .limit(5),
      supabase
        .from('projects')
        .select(dupSelect)
        .ilike('customer_name', exactPattern)
        .is('deleted_at', null)
        .limit(5),
    ]);
    if (byProjectName.error) {
      console.error(`${op} duplicate check (project_name) failed:`, { code: byProjectName.error.code, message: byProjectName.error.message });
      return err(byProjectName.error.message, byProjectName.error.code);
    }
    if (byCustomerName.error) {
      console.error(`${op} duplicate check (customer_name) failed:`, { code: byCustomerName.error.code, message: byCustomerName.error.message });
      return err(byCustomerName.error.message, byCustomerName.error.code);
    }

    const displayName = (row: { project_name: string | null; customer_name: string }): string =>
      row.project_name?.trim() || row.customer_name;
    const existing = [...(byProjectName.data ?? []), ...(byCustomerName.data ?? [])].find(
      (row) => displayName(row).toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      // Idempotent: hand back the project that already answers to this name.
      return ok({
        id: existing.id,
        name: displayName(existing),
        project_number: existing.project_number,
      });
    }

    const { data: docNum, error: docErr } = await supabase.rpc('generate_doc_number', {
      doc_type: 'PROJ',
    });
    if (docErr || !docNum) {
      console.error(`${op} project-number generation failed:`, { code: docErr?.code, message: docErr?.message, timestamp: new Date().toISOString() });
      return err(docErr?.message ?? 'Could not allocate a project number', docErr?.code);
    }

    // Minimal real row. NOT NULL columns without defaults (verified against
    // the live schema): project_number, customer_name, customer_phone,
    // site_address_line1, site_city, system_size_kwp, system_type,
    // panel_count, contracted_value, advance_amount, advance_received_at.
    // lead_id/proposal_id are nullable since mig 211 (no sales origin).
    const insert: ProjectInsert = {
      project_number: docNum,
      project_name: trimmed,
      customer_name: trimmed,
      customer_phone: 'NA',
      site_address_line1: 'Pending',
      site_city: 'Chennai',
      site_state: 'Tamil Nadu',
      system_type: 'on_grid',
      system_size_kwp: 0,
      panel_count: 0,
      contracted_value: 0,
      advance_amount: 0,
      advance_received_at: new Date().toISOString().slice(0, 10),
      status: 'order_received',
    };

    const { data, error } = await supabase
      .from('projects')
      .insert(insert)
      .select('id, project_name, customer_name, project_number')
      .single();

    if (error) {
      console.error(`${op} insert failed:`, { name: trimmed, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('Project insert returned no row');

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    revalidatePath('/projects');
    return ok({ id: data.id, name: displayName(data), project_number: data.project_number });
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Site-engineer intake (spec §11) + role-aware Price Book search (spec §1)
// ---------------------------------------------------------------------------

/**
 * Intake submission: the client sends ONLY {priceBookId, quantity} pairs.
 * Category/Item/Make/Unit/Rate/GST/Vendor are all resolved from the Price
 * Book server-side; lines land as 'yet_to_finalize'. No prices are accepted
 * from — or returned to — the client.
 */
export async function submitIntakeItems(
  projectId: string,
  items: IntakeItemInput[],
): Promise<ActionResult<{ inserted: number }>> {
  const op = '[submitIntakeItems]';
  try {
    const gate = await requireRoleIn(INTAKE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(projectId)) return err('Project is required', 'VALIDATION');
    if (!items || items.length === 0) return err('Select at least one item', 'VALIDATION');
    if (items.length > 100) return err('Too many items in one submission (max 100)', 'VALIDATION');
    for (const item of items) {
      const invalid = validateQuantity(item.quantity);
      if (invalid) return err(invalid, 'VALIDATION');
    }

    // SYSTEM OP: price_book read on behalf of site engineer — prices stripped
    // server-side (spec §1). Mig 211 removed site_supervisor from the
    // price_book_read policy, so the PB-row resolution (which DOES need
    // base_price/gst_rate to stamp the new BOI lines) runs on the admin
    // client. The resolved prices only ever land in the INSERT below — the
    // response to the client is a bare count, never price data.
    const pb = await fetchPriceBookRows(
      createAdminClient(),
      op,
      items.map((i) => i.priceBookId),
    );
    if (!pb.success) return pb;

    const inserts: BoqItemInsert[] = [];
    for (const item of items) {
      const row = pb.data.get(item.priceBookId);
      if (!row) return err('Price book item missing', 'PB_MISSING');
      inserts.push({
        project_id: projectId,
        price_book_id: row.id,
        item_category: row.item_category,
        item_description: row.item_description,
        brand: row.brand,
        model: row.model,
        unit: row.unit,
        vendor_name: row.vendor_name,
        quantity: item.quantity,
        unit_price: row.base_price,
        gst_rate: row.gst_rate,
        total_price: computeTotalPrice(item.quantity, row.base_price, row.gst_rate),
        procurement_status: 'yet_to_finalize',
      });
    }

    // Plain insert, no select-back: site_supervisor must never receive price
    // fields, and the intake UI only needs the count.
    const { error } = await supabase.from('project_boq_items').insert(inserts);
    if (error) {
      console.error(`${op} insert failed:`, { projectId, count: inserts.length, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/purchase');
    revalidatePath('/purchase/projects');
    return ok({ inserted: inserts.length });
  } catch (e) {
    console.error(`${op} threw:`, { projectId, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Client-callable KPI refresh for the BOI workspace (spec §5.2): the status
 * cards must track every non-status filter without a full page reload. Read
 * only — but gated to price-visible roles since the result is money.
 */
export async function getBoiStatusTotalsAction(
  filters: BoiKpiFilters,
): Promise<ActionResult<BoiStatusTotalsResult>> {
  const op = '[getBoiStatusTotalsAction]';
  try {
    const gate = await requireRoleIn(PRICE_VISIBLE_ROLES);
    if (!gate.success) return gate;
    return ok(await getBoiStatusTotals(filters));
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Project procurement badges (spec §3 — /purchase/projects rollup)
// ---------------------------------------------------------------------------

/**
 * Updates the projects table's procurement_status / procurement_priority
 * badge columns (mig 041 CHECKs) from the rollup's badge-selects. Status may
 * be cleared back to NULL (the column is nullable); priority is high|medium
 * only. The heavier v2 flow reads the same columns, so both screens stay in
 * sync. (Deliberately NOT reusing procurement-actions.updateProcurementPriority
 * — that legacy action has no role gate and an `as any` cast.)
 */
export async function updateProjectProcurement(
  projectId: string,
  patch: {
    status?: ProjectProcurementStatus | null;
    priority?: ProjectProcurementPriority;
  },
): Promise<ActionResult<void>> {
  const op = '[updateProjectProcurement]';
  try {
    const gate = await requireRoleIn(PURCHASE_WRITE_ROLES);
    if (!gate.success) return gate;
    const { supabase } = gate.data;

    if (!cleanText(projectId)) return err('Missing project id', 'VALIDATION');

    const update: ProjectUpdate = {};
    if (patch.status !== undefined) {
      // Runtime whitelist — the TS type alone can be bypassed by a crafted call.
      if (patch.status !== null && !isProjectProcurementStatus(patch.status)) {
        return err('Invalid procurement status', 'VALIDATION');
      }
      update.procurement_status = patch.status;
    }
    if (patch.priority !== undefined) {
      if (!isProjectProcurementPriority(patch.priority)) {
        return err('Invalid procurement priority', 'VALIDATION');
      }
      update.procurement_priority = patch.priority;
    }
    if (Object.keys(update).length === 0) return err('Nothing to update', 'VALIDATION');
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('projects')
      .update(update)
      .eq('id', projectId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`${op} update failed:`, { projectId, patch, code: error.code, message: error.message, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    if (!data) return err('Project not found', 'NOT_FOUND');

    revalidatePath('/purchase/projects');
    revalidatePath('/procurement'); // v2 board renders the same badge columns
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw:`, { projectId, error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Client-callable Price Book search whose price visibility is derived from
 * the VIEWER'S ROLE server-side — the client cannot request prices (spec §1).
 * Price-visible roles get base_price/gst_rate; site_supervisor gets rows with
 * those columns never selected.
 */
export async function searchPriceBookAction(
  term: string,
): Promise<ActionResult<PriceBookSearchResultForAction>> {
  const op = '[searchPriceBookAction]';
  try {
    const { role } = await getSessionContext();
    if (!role) return err('Not authenticated', 'UNAUTHENTICATED');
    const canSearch =
      (INTAKE_ROLES as readonly AppRole[]).includes(role) ||
      (PRICE_VISIBLE_ROLES as readonly AppRole[]).includes(role);
    if (!canSearch) return err(PERMISSION_ERROR, 'FORBIDDEN');

    const includePrices = (PRICE_VISIBLE_ROLES as readonly AppRole[]).includes(role);
    const { rows, total } = await searchPriceBookItems(term, { includePrices });
    return ok({ rows, total, pricesIncluded: includePrices });
  } catch (e) {
    console.error(`${op} threw:`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
