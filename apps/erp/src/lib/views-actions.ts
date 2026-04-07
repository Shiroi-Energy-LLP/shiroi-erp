'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function getMyViews(entityType: string) {
  const op = '[getMyViews]';
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('table_views')
    .select('*')
    .or(`owner_id.eq.${user.id},visibility.eq.everyone`)
    .eq('entity_type', entityType)
    .order('position', { ascending: true });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return data ?? [];
}

export async function saveView(input: {
  id?: string;
  entityType: string;
  name: string;
  visibility?: string;
  columns: string[];
  filters: Record<string, unknown>;
  sortColumn?: string;
  sortDirection?: string;
  quickFilters?: string[];
  pageSize?: number;
  isDefault?: boolean;
}): Promise<{ success: boolean; viewId?: string; error?: string }> {
  const op = '[saveView]';
  console.log(`${op} Starting: ${input.name}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const payload = {
    owner_id: user.id,
    entity_type: input.entityType,
    name: input.name,
    visibility: input.visibility || 'private',
    columns: input.columns,
    filters: input.filters,
    sort_column: input.sortColumn || null,
    sort_direction: input.sortDirection || 'desc',
    quick_filters: input.quickFilters || [],
    page_size: input.pageSize || 50,
    is_default: input.isDefault || false,
  };

  if (input.id) {
    // Update existing view
    const { error } = await supabase
      .from('table_views')
      .update(payload as any)
      .eq('id', input.id);

    if (error) {
      console.error(`${op} Update failed:`, { code: error.code, message: error.message });
      return { success: false, error: error.message };
    }

    revalidatePath(`/${input.entityType}`);
    return { success: true, viewId: input.id };
  } else {
    // Create new view
    const { data, error } = await supabase
      .from('table_views')
      .insert(payload as any)
      .select('id')
      .single();

    if (error) {
      console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
      return { success: false, error: error.message };
    }

    revalidatePath(`/${input.entityType}`);
    return { success: true, viewId: data.id };
  }
}

export async function setViewAsDefault(input: {
  viewId: string;
  entityType: string;
  isDefault: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[setViewAsDefault]';
  console.log(`${op} Setting view ${input.viewId} default=${input.isDefault}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // If setting as default, first unset any existing default for this entity type
  if (input.isDefault) {
    const { error: unsetError } = await supabase
      .from('table_views')
      .update({ is_default: false } as any)
      .eq('owner_id', user.id)
      .eq('entity_type', input.entityType)
      .eq('is_default', true);

    if (unsetError) {
      console.error(`${op} Unset existing default failed:`, { code: unsetError.code, message: unsetError.message });
    }
  }

  // Now set/unset the target view
  const { error } = await supabase
    .from('table_views')
    .update({ is_default: input.isDefault } as any)
    .eq('id', input.viewId)
    .eq('owner_id', user.id);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/${input.entityType}`);
  return { success: true };
}

export async function deleteView(viewId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteView]';
  console.log(`${op} Deleting: ${viewId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('table_views')
    .delete()
    .eq('id', viewId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  return { success: true };
}
