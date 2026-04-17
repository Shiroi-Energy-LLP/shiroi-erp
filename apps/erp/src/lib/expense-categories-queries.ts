import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row'];

export async function listCategories(opts?: { includeInactive?: boolean }): Promise<ExpenseCategory[]> {
  const op = '[listCategories]';
  const supabase = await createClient();
  let query = supabase
    .from('expense_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} failed`, { error });
    return [];
  }
  return data ?? [];
}

export async function getActiveCategories(): Promise<ExpenseCategory[]> {
  return listCategories({ includeInactive: false });
}
