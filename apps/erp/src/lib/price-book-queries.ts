// apps/erp/src/lib/price-book-queries.ts
import { createClient } from '@repo/supabase/server';

export interface PriceBookItem {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  specification: string | null;
  unit: string;
  base_price: number;
  gst_type: string;
  gst_rate: number;
  hsn_code: string | null;
}

export interface CorrectionFactor {
  item_category: string;
  system_type: string | null;
  segment: string | null;
  correction_factor: number;
  data_points_count: number;
}

/**
 * Get all active price book items, optionally filtered by category.
 */
export async function getActivePriceBookItems(category?: string): Promise<PriceBookItem[]> {
  const op = '[getActivePriceBookItems]';
  console.log(`${op} Starting`, { category });

  const supabase = await createClient();
  let query = supabase
    .from('price_book')
    .select('id, item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code')
    .eq('is_active', true)
    .order('item_category')
    .order('base_price', { ascending: true });

  if (category) {
    query = query.eq('item_category', category);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch price book: ${error.message}`);
  }

  return (data ?? []) as PriceBookItem[];
}

/**
 * Get the default (cheapest active) price book item for a category.
 */
export async function getDefaultPriceBookItem(category: string): Promise<PriceBookItem | null> {
  const op = '[getDefaultPriceBookItem]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('price_book')
    .select('id, item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code')
    .eq('is_active', true)
    .eq('item_category', category)
    .order('base_price', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, category });
    throw new Error(`Failed to fetch default price book item: ${error.message}`);
  }

  return data as PriceBookItem | null;
}

/**
 * Get correction factors, optionally filtered by system_type and segment.
 * Returns factors most specific to the given params first.
 */
export async function getCorrectionFactors(
  systemType?: string,
  segment?: string
): Promise<CorrectionFactor[]> {
  const op = '[getCorrectionFactors]';
  console.log(`${op} Starting`, { systemType, segment });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bom_correction_factors')
    .select('item_category, system_type, segment, correction_factor, data_points_count')
    .eq('is_active', true)
    .order('item_category');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch correction factors: ${error.message}`);
  }

  // Return most-specific match per category:
  // Priority: exact system_type+segment > exact system_type > exact segment > generic (both null)
  const factors = (data ?? []) as CorrectionFactor[];
  const byCategory = new Map<string, CorrectionFactor>();

  for (const f of factors) {
    const existing = byCategory.get(f.item_category);
    const specificity = (f.system_type === systemType ? 2 : 0) + (f.segment === segment ? 1 : 0);
    const existingSpecificity = existing
      ? (existing.system_type === systemType ? 2 : 0) + (existing.segment === segment ? 1 : 0)
      : -1;
    if (specificity > existingSpecificity) {
      byCategory.set(f.item_category, f);
    }
  }

  return Array.from(byCategory.values());
}
