'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type CategoryInsert = Database['public']['Tables']['expense_categories']['Insert'];
type CategoryUpdate = Database['public']['Tables']['expense_categories']['Update'];

export async function addCategory(input: {
  code: string;
  label: string;
  sort_order?: number;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[addCategory]';
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(code)) {
    return err('Code must be lowercase letters, numbers, underscore only');
  }
  if (!input.label.trim()) return err('Label is required');

  const supabase = await createClient();
  const payload: CategoryInsert = {
    code,
    label: input.label.trim(),
    sort_order: input.sort_order ?? 999,
    is_active: true,
  };
  const { data, error } = await supabase
    .from('expense_categories')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    console.error(`${op} failed`, { input, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok({ id: data.id });
}

export async function updateCategory(
  id: string,
  patch: { label?: string; sort_order?: number },
): Promise<ActionResult<void>> {
  const op = '[updateCategory]';
  const update: CategoryUpdate = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.sort_order !== undefined) update.sort_order = patch.sort_order;
  update.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from('expense_categories').update(update).eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, patch, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok(undefined as void);
}

export async function toggleCategoryActive(id: string, active: boolean): Promise<ActionResult<void>> {
  const op = '[toggleCategoryActive]';
  const supabase = await createClient();
  const { error } = await supabase
    .from('expense_categories')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, active, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok(undefined as void);
}
