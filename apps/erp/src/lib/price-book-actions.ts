'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { AppRole } from '@/lib/roles';

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
    query = query.or(
      `item_description.ilike.%${params.search}%,brand.ilike.%${params.search}%,vendor_name.ilike.%${params.search}%`
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
}): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

  const op = '[createPriceBookItem]';
  const supabase = await createClient();

  const today = new Date().toISOString().split('T')[0] ?? new Date().toISOString();

  const { error } = await supabase.from('price_book').insert({
    ...input,
    is_active: true,
    effective_from: today,
  } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

export async function updatePriceBookItem(input: {
  id: string;
  data: Record<string, any>;
}): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

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
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

export async function deletePriceBookItem(id: string): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

  const op = '[deletePriceBookItem]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('price_book')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

/** Get distinct categories from active price book items */
export async function getPriceBookCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('item_category')
    .is('deleted_at', null)
    .eq('is_active', true);

  const cats = new Set((data ?? []).map((d: any) => d.item_category as string));
  return [...cats].sort();
}

/** Get distinct brands from active price book items */
export async function getPriceBookBrands(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('brand')
    .is('deleted_at', null)
    .eq('is_active', true)
    .not('brand', 'is', null);

  const brands = new Set(
    (data ?? []).map((d: any) => d.brand as string).filter(Boolean)
  );
  return [...brands].sort();
}

/** Get distinct vendors from active price book items */
export async function getPriceBookVendors(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('vendor_name')
    .is('deleted_at', null)
    .not('vendor_name', 'is', null);

  const vendors = new Set(
    (data ?? []).map((d: any) => d.vendor_name as string).filter(Boolean)
  );
  return [...vendors].sort();
}
