'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// TODO(NEVER-DO #14): this file is 769 LOC. Most of the bulk is applyPriceBookRates
// (~140 LOC) and sendBoqToPurchase (~85 LOC). A follow-up split could pull
// price-book matching + procurement-send into their own files
// (project-boq-pricing-actions.ts, project-boq-procurement-actions.ts).

// ── BOQ Cost Variance CRUD ──
// Note: addCostVariance was removed 2026-05-30 as dead code (zero callers found
// across apps/, packages/, scripts/). The form path uses updateCostVariance.
// See docs/reviews/sections/2026-05-30-dead-code.md.

export async function updateCostVariance(input: {
  projectId: string;
  varianceId: string;
  actual_cost: number;
  notes: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCostVariance]';
  console.log(`${op} Updating variance: ${input.varianceId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get existing to recalculate variance
  const { data: existing } = await supabase
    .from('project_cost_variances')
    .select('estimated_cost')
    .eq('id', input.varianceId)
    .single();

  if (!existing) return { success: false, error: 'Cost variance record not found' };

  const varianceAmount = input.actual_cost - existing.estimated_cost;
  const variancePct = existing.estimated_cost > 0
    ? (varianceAmount / existing.estimated_cost) * 100
    : 0;

  const { error } = await supabase
    .from('project_cost_variances')
    .update({
      actual_cost: input.actual_cost,
      variance_amount: varianceAmount,
      variance_pct: Math.round(variancePct * 100) / 100,
      notes: input.notes,
    })
    .eq('id', input.varianceId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Seed from BOM ──

export async function seedBoqFromBom(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[seedBoqFromBom]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Check if BOQ items already exist
  const { count: existing } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (existing && existing > 0) {
    return { success: false, error: 'BOQ items already exist. Delete existing items first to re-seed.' };
  }

  // Get project's proposal ID
  const { data: project } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', input.projectId)
    .single();

  if (!project?.proposal_id) {
    return { success: false, error: 'No proposal linked to this project' };
  }

  // Get BOM lines
  const { data: bomLines, error: bomError } = await supabase
    .from('proposal_bom_lines')
    .select('id, line_number, item_category, item_description, brand, model, quantity, unit, unit_price, gst_rate, gst_type, total_price')
    .eq('proposal_id', project.proposal_id)
    .order('line_number', { ascending: true });

  if (bomError || !bomLines?.length) {
    return { success: false, error: 'No BOM lines found to seed from' };
  }

  // Create BOQ items from BOM
  const boqItems = bomLines.map((bom: any) => ({
    project_id: input.projectId,
    bom_line_id: bom.id,
    line_number: bom.line_number,
    item_category: bom.item_category,
    item_description: bom.item_description,
    brand: bom.brand,
    model: bom.model,
    quantity: bom.quantity,
    unit: bom.unit,
    unit_price: bom.unit_price,
    gst_rate: bom.gst_rate,
    gst_type: bom.gst_type || 'supply',
    total_price: bom.total_price,
    procurement_status: 'yet_to_finalize',
  }));

  const { error: insertError } = await supabase
    .from('project_boq_items')
    .insert(boqItems as any);

  if (insertError) {
    console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, count: bomLines.length };
}

// ── BOQ Items: Update procurement status ──

export async function updateBoqItemStatus(input: {
  projectId: string;
  itemId: string;
  status: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItemStatus]';
  console.log(`${op} Updating ${input.itemId} to ${input.status}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: input.status } as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Actuals: Update BOQ item quantity (for returned materials) ──

export async function updateBoqItemQuantity(input: {
  projectId: string;
  itemId: string;
  newQuantity: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItemQuantity]';
  console.log(`${op} Updating BOQ item ${input.itemId} qty to ${input.newQuantity}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Check project is not locked
  const { data: proj } = await supabase
    .from('projects')
    .select('actuals_locked')
    .eq('id', input.projectId)
    .single();

  if ((proj as any)?.actuals_locked) {
    return { success: false, error: 'Project actuals are locked. Unlock first to make changes.' };
  }

  // Update quantity and recalculate total_price
  const { data: item } = await supabase
    .from('project_boq_items')
    .select('unit_price, gst_rate')
    .eq('id', input.itemId)
    .single();

  const unitPrice = Number((item as any)?.unit_price ?? 0);
  const gstRate = Number((item as any)?.gst_rate ?? 0);
  const newTotal = input.newQuantity * unitPrice * (1 + gstRate / 100);

  const { error } = await supabase
    .from('project_boq_items')
    .update({
      quantity: input.newQuantity,
      total_price: newTotal,
    } as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Actuals: Lock project (make BOI/BOQ/Actuals read-only) ──

export async function lockProjectActuals(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockProjectActuals]';
  console.log(`${op} Locking actuals for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  const { error } = await supabase
    .from('projects')
    .update({
      actuals_locked: true,
      actuals_locked_at: new Date().toISOString(),
      actuals_locked_by: employee?.id || null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Lock failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Actuals: Unlock project (PM only) ──

export async function unlockProjectActuals(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockProjectActuals]';
  console.log(`${op} Unlocking actuals for project: ${input.projectId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('projects')
    .update({
      actuals_locked: false,
      actuals_locked_at: null,
      actuals_locked_by: null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Unlock failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Add new item directly (with optional boiId) ──

export async function addBoqItem(input: {
  projectId: string;
  boiId?: string;
  data: {
    item_category: string;
    item_description: string;
    brand: string | null;
    model: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addBoqItem]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get next line number
  const { data: existing } = await supabase
    .from('project_boq_items')
    .select('line_number')
    .eq('project_id', input.projectId)
    .order('line_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextLine = ((existing as any)?.line_number ?? 0) + 1;

  const gstAmount = input.data.quantity * input.data.unit_price * (input.data.gst_rate / 100);
  const totalPrice = input.data.quantity * input.data.unit_price + gstAmount;

  const insertData: Record<string, unknown> = {
    project_id: input.projectId,
    line_number: nextLine,
    item_category: input.data.item_category,
    item_description: input.data.item_description,
    brand: input.data.brand,
    model: input.data.model,
    quantity: input.data.quantity,
    unit: input.data.unit,
    unit_price: input.data.unit_price,
    gst_rate: input.data.gst_rate,
    gst_type: 'supply',
    total_price: totalPrice,
    procurement_status: 'yet_to_finalize',
  };
  if (input.boiId) insertData.boi_id = input.boiId;

  const { error } = await supabase
    .from('project_boq_items')
    .insert(insertData as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Update item details (rate, GST, status, description, etc.) ──

export async function updateBoqItem(input: {
  projectId: string;
  itemId: string;
  data: {
    item_description?: string;
    brand?: string | null;
    model?: string | null;
    quantity?: number;
    unit_price?: number;
    gst_rate?: number;
    procurement_status?: string;
    vendor_name?: string | null;
    notes?: string | null;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItem]';
  console.log(`${op} Updating item ${input.itemId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = {};
  const d = input.data;

  if (d.item_description !== undefined) updateData.item_description = d.item_description;
  if (d.brand !== undefined) updateData.brand = d.brand;
  if (d.model !== undefined) updateData.model = d.model;
  if (d.quantity !== undefined) updateData.quantity = d.quantity;
  if (d.unit_price !== undefined) updateData.unit_price = d.unit_price;
  if (d.gst_rate !== undefined) updateData.gst_rate = d.gst_rate;
  if (d.procurement_status !== undefined) updateData.procurement_status = d.procurement_status;
  if (d.vendor_name !== undefined) updateData.vendor_name = d.vendor_name;
  if (d.notes !== undefined) updateData.notes = d.notes;

  // Recalculate total if rate or qty changed
  if (d.unit_price !== undefined || d.quantity !== undefined || d.gst_rate !== undefined) {
    // Get current values for fields not being updated
    const { data: current } = await supabase
      .from('project_boq_items')
      .select('quantity, unit_price, gst_rate')
      .eq('id', input.itemId)
      .single();

    if (current) {
      const qty = d.quantity ?? Number(current.quantity);
      const rate = d.unit_price ?? Number(current.unit_price);
      const gst = d.gst_rate ?? Number(current.gst_rate);
      const gstAmount = qty * rate * (gst / 100);
      updateData.total_price = qty * rate + gstAmount;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return { success: true };
  }

  const { error } = await supabase
    .from('project_boq_items')
    .update(updateData as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Delete ──

export async function deleteBoqItem(input: {
  projectId: string;
  itemId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteBoqItem]';
  console.log(`${op} Deleting item ${input.itemId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('project_boq_items')
    .delete()
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Delete failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Mark completed ──

export async function completeBoq(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[completeBoq]';
  console.log(`${op} Completing BOQ for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({
      boq_completed: true,
      boq_completed_at: new Date().toISOString(),
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Update project manual cost (for margin calc) ──

export async function updateProjectCostManual(input: {
  projectId: string;
  projectCost: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateProjectCostManual]';
  console.log(`${op} Updating manual cost for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({ project_cost_manual: input.projectCost } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Send to Purchase Team (mark items as yet_to_place) ──

export async function sendBoqToPurchase(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[sendBoqToPurchase]';
  console.log(`${op} Sending BOQ to purchase for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID for tracking
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  // Update all "yet_to_finalize" items to "yet_to_place"
  const { data, error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: 'yet_to_place' } as any)
    .eq('project_id', input.projectId)
    .eq('procurement_status', 'yet_to_finalize')
    .select('id');

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Set project-level procurement tracking
  if (data && data.length > 0) {
    await supabase
      .from('projects')
      .update({
        procurement_status: 'yet_to_place',
        boq_sent_to_purchase_at: new Date().toISOString(),
        boq_sent_to_purchase_by: employee?.id ?? null,
      } as any)
      .eq('id', input.projectId);

    // ── Best-effort: notify all purchase_officer users ─────────────────────
    // Spec §7 event 1 — "New Purchase Request for Project {X}".
    // Wrapped in try/catch so a notification failure doesn't roll back the
    // status flip the user actually cares about.
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, customer_name')
        .eq('id', input.projectId)
        .single();

      const { data: officers } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'purchase_officer')
        .eq('is_active', true);

      if (officers && officers.length > 0 && project) {
        const { data: officerEmployees } = await supabase
          .from('employees')
          .select('id')
          .in('profile_id', officers.map((o) => o.id));

        if (officerEmployees && officerEmployees.length > 0) {
          const notifs = officerEmployees.map((emp) => ({
            recipient_employee_id: emp.id,
            notification_type: 'procurement',
            title: `New Purchase Request for ${project.project_number}`,
            body: `BOQ for ${project.customer_name ?? 'project'} is ready for procurement.`,
            entity_type: 'project',
            entity_id: input.projectId,
          }));
          await supabase.from('notifications').insert(notifs);
        }
      }
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/procurement');
  return { success: true, count: data?.length ?? 0 };
}

// ── BOQ: Apply Price Book rates to items without pricing ──
//
// Matching strategy (tries each in order, stops at first hit):
//   1. Exact normalized match on category + description (lowercase, punctuation stripped,
//      whitespace collapsed).
//   2. Substring match (either direction) — BOM desc contains price book desc or vice versa.
//   3. Token overlap (Jaccard similarity ≥ 0.3) — picks best scoring price book entry
//      in the same category.
//   4. Single-candidate fallback — if the category has exactly one active price book
//      entry, use it.
//
// The old implementation used exact `${category}::${description}` match only,
// which almost never matched because BOM descriptions are free-form user text
// while price book descriptions are Manivel's curated entries. Result: 0 rates applied.

export async function applyPriceBookRates(input: {
  projectId: string;
}): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const op = '[applyPriceBookRates]';
  console.log(`${op} Applying price book rates for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get all BOQ items
  const { data: items, error: itemsError } = await supabase
    .from('project_boq_items')
    .select('id, item_category, item_description, quantity, unit_price')
    .eq('project_id', input.projectId);

  if (itemsError || !items) {
    return { success: false, error: itemsError?.message ?? 'Failed to fetch items' };
  }

  // Get active, priced price book entries
  const { data: priceBook } = await supabase
    .from('price_book')
    .select('item_category, item_description, base_price, gst_rate')
    .eq('is_active', true)
    .gt('base_price', 0);

  if (!priceBook || priceBook.length === 0) {
    console.log(`${op} Price book empty — nothing to apply`);
    return { success: true, updatedCount: 0 };
  }

  // Normalize: lowercase, strip punctuation, collapse whitespace
  const normalize = (s: string | null | undefined): string =>
    (s ?? '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const tokenize = (s: string | null | undefined): Set<string> =>
    new Set(normalize(s).split(' ').filter((t) => t.length > 1));

  // Index price book by category
  type PbEntry = {
    descNorm: string;
    tokens: Set<string>;
    base_price: number;
    gst_rate: number;
  };
  const pbByCategory = new Map<string, PbEntry[]>();
  for (const pb of priceBook) {
    const cat = (pb.item_category as string) ?? 'other';
    const entry: PbEntry = {
      descNorm: normalize(pb.item_description as string),
      tokens: tokenize(pb.item_description as string),
      base_price: Number(pb.base_price),
      gst_rate: Number(pb.gst_rate ?? 18),
    };
    if (!pbByCategory.has(cat)) pbByCategory.set(cat, []);
    pbByCategory.get(cat)!.push(entry);
  }

  // For each unpriced BOM item, find best price book match in same category
  let updatedCount = 0;
  let skippedNoCategory = 0;
  let skippedNoMatch = 0;
  for (const item of items) {
    if (Number(item.unit_price) > 0) continue; // Already priced

    const candidates = pbByCategory.get(item.item_category as string);
    if (!candidates || candidates.length === 0) {
      skippedNoCategory++;
      continue;
    }

    const itemNorm = normalize(item.item_description as string);
    const itemTokens = tokenize(item.item_description as string);
    let match: PbEntry | null = null;

    // Strategy 1: exact normalized match
    match = candidates.find((c) => c.descNorm === itemNorm && itemNorm.length > 0) ?? null;

    // Strategy 2: substring match (either direction)
    if (!match && itemNorm.length >= 3) {
      match =
        candidates.find(
          (c) =>
            c.descNorm.length >= 3 &&
            (c.descNorm.includes(itemNorm) || itemNorm.includes(c.descNorm)),
        ) ?? null;
    }

    // Strategy 3: token overlap (Jaccard ≥ 0.3) — picks best scoring
    if (!match && itemTokens.size > 0) {
      let best: PbEntry | null = null;
      let bestScore = 0;
      for (const c of candidates) {
        if (c.tokens.size === 0) continue;
        let overlap = 0;
        for (const t of itemTokens) if (c.tokens.has(t)) overlap++;
        const union = new Set([...itemTokens, ...c.tokens]).size;
        const score = overlap / Math.max(union, 1);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best && bestScore >= 0.3) match = best;
    }

    // Strategy 4: single-candidate fallback
    if (!match && candidates.length === 1) {
      match = candidates[0] ?? null;
    }

    if (!match) {
      skippedNoMatch++;
      continue;
    }

    const qty = Number(item.quantity ?? 0);
    const gstAmount = qty * match.base_price * (match.gst_rate / 100);
    const totalPrice = qty * match.base_price + gstAmount;

    const { error: updateError } = await supabase
      .from('project_boq_items')
      .update({
        unit_price: match.base_price,
        gst_rate: match.gst_rate,
        total_price: totalPrice,
      } as any)
      .eq('id', item.id);

    if (!updateError) updatedCount++;
  }

  console.log(
    `${op} Updated ${updatedCount} items. Skipped: ${skippedNoCategory} (no category match), ${skippedNoMatch} (no description match)`,
  );
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, updatedCount };
}

// ── BOQ: Update estimated site expenses budget ──

export async function updateEstimatedSiteExpenses(input: {
  projectId: string;
  budget: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateEstimatedSiteExpenses]';
  console.log(`${op} Updating estimated site expenses for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({ estimated_site_expenses_budget: input.budget } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
