'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

// ═══════════════════════════════════════════════════════════════════════
// Public-facing types (used by UI components)
// ═══════════════════════════════════════════════════════════════════════

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

// Row types from the generated schema — keeps us honest if columns change
type DataFlagRow = Database['public']['Tables']['data_flags']['Row'];
type DataFlagInsert = Database['public']['Tables']['data_flags']['Insert'];
type DataFlagUpdate = Database['public']['Tables']['data_flags']['Update'];

// Public shape returned to the UI — narrows the generated Row into what
// callers actually use.
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

function toPublicFlag(row: DataFlagRow): DataFlag {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    flag_type: row.flag_type as FlagType,
    field_name: row.field_name ?? null,
    notes: row.notes ?? null,
    flagged_by: row.flagged_by,
    flagged_at: row.flagged_at,
    resolved_by: row.resolved_by ?? null,
    resolved_at: row.resolved_at ?? null,
    resolution_notes: row.resolution_notes ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Create Flag
// ═══════════════════════════════════════════════════════════════════════

export async function createDataFlag(input: {
  entityType: FlagEntityType;
  entityId: string;
  flagType: FlagType;
  fieldName?: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  const op = '[createDataFlag]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const insert: DataFlagInsert = {
    entity_type: input.entityType,
    entity_id: input.entityId,
    flag_type: input.flagType,
    field_name: input.fieldName || null,
    notes: input.notes || null,
    flagged_by: user.id,
  };

  const { error } = await supabase.from('data_flags').insert(insert);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/data-quality');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Resolve Flag
// ═══════════════════════════════════════════════════════════════════════

export async function resolveDataFlag(input: {
  flagId: string;
  resolutionNotes?: string;
}): Promise<ActionResult<void>> {
  const op = '[resolveDataFlag]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: DataFlagUpdate = {
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
    resolution_notes: input.resolutionNotes || null,
  };

  const { error } = await supabase
    .from('data_flags')
    .update(update)
    .eq('id', input.flagId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/data-quality');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Get Flags for an Entity
// ═══════════════════════════════════════════════════════════════════════

export async function getEntityFlags(
  entityType: string,
  entityId: string,
): Promise<DataFlag[]> {
  const op = '[getEntityFlags]';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('data_flags')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('flagged_at', { ascending: false });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []).map(toPublicFlag);
}

// ═══════════════════════════════════════════════════════════════════════
// Get Unresolved Flag Count for an Entity
// ═══════════════════════════════════════════════════════════════════════

export async function getUnresolvedFlagCount(
  entityType: string,
  entityId: string,
): Promise<number> {
  const supabase = await createClient();
  // data_flags is a small table (~0 rows currently, unbounded growth but
  // never expected to exceed a few thousand) — exact count is fine here.
  // Rule 13 allows exact on small tables; we're reading per (entity, id)
  // pair, so the filter limits the scan anyway.
  const { count, error } = await supabase
    .from('data_flags')
    .select('*', { count: 'estimated', head: true })
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('resolved_at', null);

  if (error) return 0;
  return count ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Get All Unresolved Flags (for dashboard)
// ═══════════════════════════════════════════════════════════════════════

export interface UnresolvedFlagWithName extends DataFlag {
  flagged_by_name: string;
}

type FlagWithProfile = DataFlagRow & {
  profiles: { full_name: string | null } | null;
};

export async function getUnresolvedFlags(input?: {
  entityType?: string;
  flagType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ flags: UnresolvedFlagWithName[]; total: number }> {
  const op = '[getUnresolvedFlags]';

  const supabase = await createClient();
  let query = supabase
    .from('data_flags')
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

  const { data, count, error } = await query.returns<FlagWithProfile[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { flags: [], total: 0 };
  }

  const flags: UnresolvedFlagWithName[] = (data ?? []).map((d) => ({
    ...toPublicFlag(d),
    flagged_by_name: d.profiles?.full_name ?? 'Unknown',
  }));

  return { flags, total: count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// Get Flag Summary (for dashboard cards)
// ═══════════════════════════════════════════════════════════════════════

export interface DataFlagSummary {
  total: number;
  unresolved: number;
  resolvedThisWeek: number;
  byType: { entity_type: string; unresolved: number }[];
}

export async function getDataFlagSummary(): Promise<DataFlagSummary> {
  const op = '[getDataFlagSummary]';

  const supabase = await createClient();

  // Totals — `count: 'estimated'` is correct here per rule 13 (small table,
  // unbounded growth, estimated is accurate enough for a dashboard card)
  const { count: total } = await supabase
    .from('data_flags')
    .select('*', { count: 'estimated', head: true });

  const { count: unresolved } = await supabase
    .from('data_flags')
    .select('*', { count: 'estimated', head: true })
    .is('resolved_at', null);

  // Resolved this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const { count: resolvedThisWeek } = await supabase
    .from('data_flags')
    .select('*', { count: 'estimated', head: true })
    .not('resolved_at', 'is', null)
    .gte('resolved_at', weekAgo.toISOString());

  // By entity type via RPC from migration 029
  type FlagSummaryRow = { entity_type: string; unresolved_flags: number };
  const { data: summary } = await supabase.rpc('get_data_flag_summary').returns<FlagSummaryRow[]>();

  const byType = (summary ?? []).map((s) => ({
    entity_type: s.entity_type,
    unresolved: Number(s.unresolved_flags),
  }));

  if (total === null && unresolved === null && resolvedThisWeek === null) {
    console.error(`${op} All count queries returned null`);
  }

  return {
    total: total ?? 0,
    unresolved: unresolved ?? 0,
    resolvedThisWeek: resolvedThisWeek ?? 0,
    byType,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Verify Entity Data
// ═══════════════════════════════════════════════════════════════════════

type VerifiableEntity = 'lead' | 'project' | 'proposal';

export async function verifyEntityData(input: {
  entityType: VerifiableEntity;
  entityId: string;
}): Promise<ActionResult<void>> {
  const op = '[verifyEntityData]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const verifiedPayload = {
    data_verified_by: user.id,
    data_verified_at: new Date().toISOString(),
  };

  // Per-table update to preserve type safety — no dynamic `.from(string)`
  let result: { error: { code?: string; message: string } | null };
  switch (input.entityType) {
    case 'lead':
      result = await supabase
        .from('leads')
        .update(verifiedPayload)
        .eq('id', input.entityId);
      break;
    case 'project':
      result = await supabase
        .from('projects')
        .update(verifiedPayload)
        .eq('id', input.entityId);
      break;
    case 'proposal':
      result = await supabase
        .from('proposals')
        .update(verifiedPayload)
        .eq('id', input.entityId);
      break;
    default: {
      const exhaustive: never = input.entityType;
      return err(`Invalid entity type: ${String(exhaustive)}`);
    }
  }

  if (result.error) {
    console.error(`${op} Failed:`, { code: result.error.code, message: result.error.message });
    return err(result.error.message, result.error.code);
  }

  revalidatePath(`/${input.entityType}s`);
  return ok(undefined);
}
