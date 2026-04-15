// Server-side query file — imports @repo/supabase/server, so can only be called
// from server components / server actions. No 'use server' or 'server-only'
// directive needed (Next.js 14 enforces the boundary via the import).

import { cache } from 'react';
import { createClient } from '@repo/supabase/server';
import type { ItemCategory } from './boi-constants';

export interface ItemSuggestionRow {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

/**
 * Fetches ~950 deduped item suggestions for the ItemCombobox.
 *
 * Source:
 * - `price_book` (curated by Manivel, ~252 active rows)
 * - `project_boq_items` (recent user entries, ~701 rows)
 *
 * Dedup rule: `(LOWER(description), category)` — Price Book rows win on conflict.
 * Wrapped with React's `cache()` so multiple server components on the same
 * request share the result.
 */
export const getItemSuggestions = cache(async (): Promise<ItemSuggestionRow[]> => {
  const op = '[getItemSuggestions]';
  const supabase = await createClient();

  const [priceBookRes, boqRes] = await Promise.all([
    supabase
      .from('price_book')
      .select('item_description, item_category, unit, base_price')
      .is('deleted_at', null)
      .eq('is_active', true)
      .limit(500),
    supabase
      .from('project_boq_items')
      .select('item_description, item_category, unit, unit_price')
      .limit(2000),
  ]);

  if (priceBookRes.error) {
    console.error(`${op} price_book query failed:`, {
      code: priceBookRes.error.code,
      message: priceBookRes.error.message,
    });
  }
  if (boqRes.error) {
    console.error(`${op} project_boq_items query failed:`, {
      code: boqRes.error.code,
      message: boqRes.error.message,
    });
  }

  const priceBook = priceBookRes.data ?? [];
  const boq = boqRes.data ?? [];

  // Dedupe by (LOWER(description), category). Price Book wins.
  const seen = new Set<string>();
  const out: ItemSuggestionRow[] = [];

  const keyOf = (desc: string | null, cat: string | null): string =>
    `${(desc ?? '').toLowerCase().trim()}::${cat ?? ''}`;

  for (const r of priceBook) {
    if (!r.item_description || !r.item_category) continue;
    const key = keyOf(r.item_description, r.item_category);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      description: r.item_description,
      category: r.item_category as ItemCategory,
      unit: r.unit ?? 'Nos',
      base_price: Number(r.base_price ?? 0),
      source: 'price_book',
    });
  }

  for (const r of boq) {
    if (!r.item_description || !r.item_category) continue;
    const key = keyOf(r.item_description, r.item_category);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      description: r.item_description,
      category: r.item_category as ItemCategory,
      unit: r.unit ?? 'Nos',
      base_price: Number(r.unit_price ?? 0),
      source: 'boq',
    });
  }

  return out;
});
