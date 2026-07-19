import { createClient } from '@repo/supabase/server';

export interface ItemCategoryOpt { value: string; label: string; is_active: boolean; sort_order: number }
export interface ItemUnitOpt { value: string; is_active: boolean; sort_order: number }

export async function listItemCategories(activeOnly = true): Promise<ItemCategoryOpt[]> {
  const op = '[listItemCategories]';
  const supabase = await createClient();
  let q = supabase.from('item_categories').select('value, label, is_active, sort_order')
    .order('sort_order', { ascending: true }).order('label', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return []; }
  return data ?? [];
}

export async function listItemUnits(activeOnly = true): Promise<ItemUnitOpt[]> {
  const op = '[listItemUnits]';
  const supabase = await createClient();
  let q = supabase.from('item_units').select('value, is_active, sort_order')
    .order('sort_order', { ascending: true }).order('value', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return []; }
  return data ?? [];
}
