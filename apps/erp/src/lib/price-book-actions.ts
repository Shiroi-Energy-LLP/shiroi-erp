'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { AppRole } from '@/lib/roles';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { sanitizeForIlike } from '@/lib/helpers/sanitize-or-filter';

const ALLOWED_PRICE_BOOK_EDITORS: AppRole[] = [
  'founder',
  'purchase_officer',
  'finance',
  'project_manager',
];

async function assertCanEditPriceBook(): Promise<
  { ok: true } | { ok: false; error: string; code: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (error || !profile) {
    console.error('[assertCanEditPriceBook] profile lookup failed:', error);
    return { ok: false, error: 'Profile lookup failed', code: 'PROFILE_MISSING' };
  }

  if (!ALLOWED_PRICE_BOOK_EDITORS.includes(profile.role as AppRole)) {
    return {
      ok: false,
      error: 'Only founder, purchase officer, finance, and project manager can edit Price Book',
      code: 'ROLE_DENIED',
    };
  }

  return { ok: true };
}

export async function getPriceBookItems(params: {
  search?: string;
  category?: string;
  brand?: string;
  vendor?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: any[]; total: number }> {
  const op = '[getPriceBookItems]';
  const supabase = await createClient();
  const page = params.page ?? 1;
  const perPage = params.per_page ?? 50;
  const offset = (page - 1) * perPage;

  let query = supabase
    .from('price_book')
    .select('*', { count: 'estimated' })
    .is('deleted_at', null)
    .order('item_category', { ascending: true })
    .order('item_description', { ascending: true })
    .range(offset, offset + perPage - 1);

  if (params.category) query = query.eq('item_category', params.category);
  if (params.brand) query = query.eq('brand', params.brand);
  if (params.vendor) query = query.eq('vendor_name', params.vendor);
  if (params.search) {
    const s = sanitizeForIlike(params.search);
    query = query.or(
      `item_description.ilike.${s},brand.ilike.${s},vendor_name.ilike.${s}`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { items: [], total: 0 };
  }

  return { items: data ?? [], total: count ?? 0 };
}

export async function createPriceBookItem(input: {
  item_category: string;
  item_description: string;
  brand?: string;
  model?: string;
  unit: string;
  base_price: number;
  gst_rate: number;
  gst_type?: string;
  hsn_code?: string;
  vendor_name?: string;
  default_qty?: number;
  specification?: string;
}): Promise<ActionResult<void>> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return err(guard.error, guard.code);

  const op = '[createPriceBookItem]';
  const supabase = await createClient();

  const today = new Date().toISOString().split('T')[0] ?? new Date().toISOString();

  const { error } = await supabase.from('price_book').insert({
    ...input,
    gst_type: input.gst_type ?? 'supply',
    is_active: true,
    effective_from: today,
  } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/price-book');
  return ok(undefined);
}

export async function updatePriceBookItem(input: {
  id: string;
  data: Record<string, any>;
}): Promise<ActionResult<void>> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return err(guard.error, guard.code);

  const op = '[updatePriceBookItem]';
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const updateData: Record<string, any> = { ...input.data };

  // If base_price is being changed, track the audit
  if ('base_price' in updateData) {
    updateData.rate_updated_at = new Date().toISOString();
    updateData.rate_updated_by = user?.id ?? null;
  }

  const { error } = await supabase
    .from('price_book')
    .update(updateData as any)
    .eq('id', input.id);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/price-book');
  return ok(undefined);
}

export async function deletePriceBookItem(id: string): Promise<ActionResult<void>> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return err(guard.error, guard.code);

  const op = '[deletePriceBookItem]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('price_book')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/price-book');
  return ok(undefined);
}

/**
 * Distinct category/brand/vendor lists for the /price-book filter dropdowns.
 * One `get_price_book_facets` RPC (mig 208) replaces three full-table
 * single-column fetches + JS Set dedup (2026-07-19 perf work).
 */
export async function getPriceBookFacets(): Promise<{
  categories: string[];
  brands: string[];
  vendors: string[];
}> {
  const op = '[getPriceBookFacets]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_price_book_facets');

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { categories: [], brands: [], vendors: [] };
  }
  const facets = (data ?? {}) as { categories?: string[]; brands?: string[]; vendors?: string[] };
  return {
    categories: facets.categories ?? [],
    brands: facets.brands ?? [],
    vendors: facets.vendors ?? [],
  };
}
