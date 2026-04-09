'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Types ──

export type FlagType =
  | 'wrong_data'
  | 'duplicate'
  | 'incomplete'
  | 'wrong_file'
  | 'wrong_category'
  | 'wrong_amount'
  | 'wrong_status'
  | 'other';

export type FlagEntityType =
  | 'lead'
  | 'project'
  | 'proposal'
  | 'contact'
  | 'company'
  | 'vendor'
  | 'po'
  | 'bom_item'
  | 'file'
  | 'delivery_challan'
  | 'invoice'
  | 'payment';

export interface DataFlag {
  id: string;
  entity_type: string;
  entity_id: string;
  flag_type: FlagType;
  field_name: string | null;
  notes: string | null;
  flagged_by: string;
  flagged_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

// ── Create Flag ──

export async function createDataFlag(input: {
  entityType: FlagEntityType;
  entityId: string;
  flagType: FlagType;
  fieldName?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createDataFlag]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('data_flags' as any)
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      flag_type: input.flagType,
      field_name: input.fieldName || null,
      notes: input.notes || null,
      flagged_by: user.id,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/data-quality');
  return { success: true };
}

// ── Resolve Flag ──

export async function resolveDataFlag(input: {
  flagId: string;
  resolutionNotes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[resolveDataFlag]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('data_flags' as any)
    .update({
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_notes: input.resolutionNotes || null,
    } as any)
    .eq('id', input.flagId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/data-quality');
  return { success: true };
}

// ── Get Flags for an Entity ──

export async function getEntityFlags(
  entityType: string,
  entityId: string
): Promise<DataFlag[]> {
  const op = '[getEntityFlags]';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('data_flags' as any)
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('flagged_at', { ascending: false });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as unknown as DataFlag[];
}

// ── Get Unresolved Flag Count for an Entity ──

export async function getUnresolvedFlagCount(
  entityType: string,
  entityId: string
): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('data_flags' as any)
    .select('*', { count: 'exact', head: true })
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('resolved_at', null);

  if (error) return 0;
  return count ?? 0;
}

// ── Get All Unresolved Flags (for dashboard) ──

export async function getUnresolvedFlags(input?: {
  entityType?: string;
  flagType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ flags: (DataFlag & { flagged_by_name?: string })[]; total: number }> {
  const op = '[getUnresolvedFlags]';

  const supabase = await createClient();
  let query = supabase
    .from('data_flags' as any)
    .select('*, profiles!data_flags_flagged_by_fkey(full_name)', { count: 'estimated' })
    .is('resolved_at', null)
    .order('flagged_at', { ascending: false });

  if (input?.entityType) {
    query = query.eq('entity_type', input.entityType);
  }
  if (input?.flagType) {
    query = query.eq('flag_type', input.flagType);
  }

  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { flags: [], total: 0 };
  }

  const flags = (data ?? []).map((d: any) => ({
    ...d,
    flagged_by_name: d.profiles?.full_name ?? 'Unknown',
  })) as (DataFlag & { flagged_by_name?: string })[];

  return { flags, total: count ?? 0 };
}

// ── Get Flag Summary (for dashboard cards) ──

export async function getDataFlagSummary(): Promise<{
  total: number;
  unresolved: number;
  resolvedThisWeek: number;
  byType: { entity_type: string; unresolved: number }[];
}> {
  const op = '[getDataFlagSummary]';

  const supabase = await createClient();

  // Total + unresolved counts
  const { count: total } = await supabase
    .from('data_flags' as any)
    .select('*', { count: 'exact', head: true });

  const { count: unresolved } = await supabase
    .from('data_flags' as any)
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null);

  // Resolved this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const { count: resolvedThisWeek } = await supabase
    .from('data_flags' as any)
    .select('*', { count: 'exact', head: true })
    .not('resolved_at', 'is', null)
    .gte('resolved_at', weekAgo.toISOString());

  // By entity type (use RPC — not yet in generated types)
  const { data: summary } = await (supabase as any).rpc('get_data_flag_summary');

  const byType = (summary ?? []).map((s: any) => ({
    entity_type: s.entity_type,
    unresolved: Number(s.unresolved_flags),
  }));

  return {
    total: total ?? 0,
    unresolved: unresolved ?? 0,
    resolvedThisWeek: resolvedThisWeek ?? 0,
    byType,
  };
}

// ── Verify Entity Data ──

export async function verifyEntityData(input: {
  entityType: 'lead' | 'project' | 'proposal';
  entityId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[verifyEntityData]';

  const tableMap: Record<string, string> = {
    lead: 'leads',
    project: 'projects',
    proposal: 'proposals',
  };

  const tableName = tableMap[input.entityType];
  if (!tableName) return { success: false, error: 'Invalid entity type' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from(tableName as any)
    .update({
      data_verified_by: user.id,
      data_verified_at: new Date().toISOString(),
    } as any)
    .eq('id', input.entityId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  return { success: true };
}
