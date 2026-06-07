'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// Split out of project-boq-actions.ts on 2026-06-06 (item 15b) so that the
// core BOQ CRUD module stays under the NEVER-DO #14 500-LOC ceiling.
// This file owns price-book matching only.

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
