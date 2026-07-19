'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import { err, ok, type ActionResult } from '@/lib/types/actions';

const CATALOG_ROLES = new Set<string>(['founder', 'project_manager', 'purchase_officer']);

async function requireCatalogRole(): Promise<ActionResult<true>> {
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!CATALOG_ROLES.has(profile.role)) return err('Not allowed to manage catalog lists.', 'FORBIDDEN');
  return ok(true);
}

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function revalidateCatalog() {
  revalidatePath('/price-book');
  revalidatePath('/price-book/settings');
}

export async function addItemCategory(input: { label: string }): Promise<ActionResult<{ value: string }>> {
  const op = '[addItemCategory]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const label = input.label.trim();
  if (!label) return err('Category label is required');
  const value = slugify(label);
  if (!value) return err('Category label must contain letters or numbers');
  const supabase = await createClient();
  const { error } = await supabase.from('item_categories').insert({ value, label });
  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message, value });
    return err(error.code === '23505' ? `Category "${label}" already exists.` : error.message, error.code);
  }
  revalidateCatalog();
  return ok({ value });
}

export async function addItemUnit(input: { value: string }): Promise<ActionResult<{ value: string }>> {
  const op = '[addItemUnit]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const value = input.value.trim();
  if (!value) return err('Unit is required');
  const supabase = await createClient();
  const { error } = await supabase.from('item_units').insert({ value });
  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message, value });
    return err(error.code === '23505' ? `Unit "${value}" already exists.` : error.message, error.code);
  }
  revalidateCatalog();
  return ok({ value });
}

export async function toggleItemCategoryActive(input: { value: string; isActive: boolean }): Promise<ActionResult> {
  const op = '[toggleItemCategoryActive]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from('item_categories').update({ is_active: input.isActive }).eq('value', input.value);
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return err(error.message, error.code); }
  revalidateCatalog();
  return ok(undefined as void);
}

export async function toggleItemUnitActive(input: { value: string; isActive: boolean }): Promise<ActionResult> {
  const op = '[toggleItemUnitActive]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from('item_units').update({ is_active: input.isActive }).eq('value', input.value);
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return err(error.message, error.code); }
  revalidateCatalog();
  return ok(undefined as void);
}
