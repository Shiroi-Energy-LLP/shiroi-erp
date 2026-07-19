'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';

type CutRecordInsert = Database['public']['Tables']['inventory_cut_records']['Insert'];
type MaterialType = Database['public']['Tables']['inventory_cut_records']['Row']['material_type'];

// ---------------------------------------------------------------------------
// C8: Record cable / wire cut-length consumed on a project
// ---------------------------------------------------------------------------

interface RecordCutLengthInput {
  projectId: string;
  materialType: MaterialType;
  specification: string;
  lengthMeters: number;
  quantityRolls?: number;
  cutDate: string; // 'YYYY-MM-DD'
  projectStage?: string;
  notes?: string;
}

export async function recordCutLength(
  input: RecordCutLengthInput,
): Promise<ActionResult<{ id: string }>> {
  const op = '[recordCutLength]';
  console.log(`${op} Starting`, { projectId: input.projectId, materialType: input.materialType, lengthMeters: input.lengthMeters });

  if (!input.projectId) return err('Missing project ID');
  if (!input.specification.trim()) return err('Specification is required');
  if (input.lengthMeters <= 0) return err('Length must be greater than zero');

  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { user, supabase } = authed.data;

  // Resolve profile.id → cut_by
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  const insertRow: CutRecordInsert = {
    project_id: input.projectId,
    material_type: input.materialType,
    specification: input.specification.trim(),
    length_meters: input.lengthMeters,
    quantity_rolls: input.quantityRolls ?? null,
    cut_date: input.cutDate,
    cut_by: profile?.id ?? null,
    project_stage: input.projectStage ?? null,
    notes: input.notes?.trim() ?? null,
  };

  const { data, error } = await supabase
    .from('inventory_cut_records')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed`, { code: error.code, message: error.message, projectId: input.projectId, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/inventory');
  return ok({ id: data.id });
}

export async function deleteCutRecord(recordId: string): Promise<ActionResult<void>> {
  const op = '[deleteCutRecord]';
  console.log(`${op} Starting`, { recordId });

  if (!recordId) return err('Missing record ID');

  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { user, supabase } = authed.data;

  // Verify caller role (founder or project_manager)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager'].includes(profile.role)) {
    return err('Only founders and project managers can delete cut records');
  }

  // Fetch the record to get project_id for revalidation
  const { data: record } = await supabase
    .from('inventory_cut_records')
    .select('project_id')
    .eq('id', recordId)
    .maybeSingle();

  const { error } = await supabase
    .from('inventory_cut_records')
    .delete()
    .eq('id', recordId);

  if (error) {
    console.error(`${op} Failed`, { code: error.code, message: error.message, recordId, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  if (record?.project_id) revalidatePath(`/projects/${record.project_id}`);
  revalidatePath('/inventory');
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Update cut-length for a stock piece
// ---------------------------------------------------------------------------

interface UpdateCutLengthInput {
  stockPieceId: string;
  newLengthM: number;
  notes?: string;
}

export async function updateCutLength(
  input: UpdateCutLengthInput
): Promise<ActionResult<void>> {
  const op = '[updateCutLength]';
  console.log(`${op} Starting for piece: ${input.stockPieceId}, new length: ${input.newLengthM}m`);

  if (!input.stockPieceId) return err('Missing stock piece ID', 'MISSING_PIECE_ID');
  if (input.newLengthM < 0) return err('Length cannot be negative', 'NEGATIVE_LENGTH');

  const supabase = await createClient();

  // Fetch current piece to validate
  const { data: piece, error: fetchErr } = await supabase
    .from('stock_pieces')
    .select('id, is_cut_length, current_length_m, original_length_m, minimum_usable_length_m')
    .eq('id', input.stockPieceId)
    .single();

  if (fetchErr || !piece) {
    console.error(`${op} Piece not found:`, fetchErr?.message);
    return err('Stock piece not found', fetchErr?.code);
  }

  if (!piece.is_cut_length) {
    return err('This piece is not a cut-length item', 'NOT_CUT_LENGTH');
  }

  if (piece.current_length_m !== null && input.newLengthM > piece.current_length_m) {
    return err('New length cannot exceed current length', 'LENGTH_EXCEEDS_CURRENT');
  }

  // Check if below minimum usable → auto-scrap will be handled by DB trigger
  const willBeScrap = piece.minimum_usable_length_m !== null && input.newLengthM < piece.minimum_usable_length_m;

  const updateData: Record<string, unknown> = {
    current_length_m: input.newLengthM,
  };

  if (input.notes) {
    updateData.notes = input.notes;
  }

  // If below minimum, mark as scrap
  if (willBeScrap) {
    updateData.is_scrap = true;
    updateData.scrapped_at = new Date().toISOString();
    updateData.scrap_reason = `Cut below minimum usable length (${piece.minimum_usable_length_m}m)`;
    updateData.condition = 'scrapped';
  }

  const { error: updateErr } = await supabase
    .from('stock_pieces')
    .update(updateData)
    .eq('id', input.stockPieceId);

  if (updateErr) {
    console.error(`${op} Update failed:`, updateErr.message);
    return err(updateErr.message, updateErr.code);
  }

  revalidatePath('/inventory');
  console.log(`${op} Updated piece ${input.stockPieceId} to ${input.newLengthM}m${willBeScrap ? ' (auto-scrapped)' : ''}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Allocate stock piece to a project
// ---------------------------------------------------------------------------

interface AllocateStockInput {
  stockPieceId: string;
  projectId: string;
}

export async function allocateToProject(
  input: AllocateStockInput
): Promise<ActionResult<void>> {
  const op = '[allocateToProject]';
  console.log(`${op} Allocating piece ${input.stockPieceId} to project ${input.projectId}`);

  if (!input.stockPieceId || !input.projectId) {
    return err('Missing required fields', 'MISSING_FIELDS');
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('stock_pieces')
    .update({
      project_id: input.projectId,
      current_location: 'on_site',
    })
    .eq('id', input.stockPieceId);

  if (error) {
    console.error(`${op} Allocation failed:`, error.message);
    return err(error.message, error.code);
  }

  revalidatePath('/inventory');
  revalidatePath(`/projects/${input.projectId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Update stock piece location
// ---------------------------------------------------------------------------

interface UpdateLocationInput {
  stockPieceId: string;
  location: string;
  warehouseLocation?: string;
}

export async function updateStockLocation(
  input: UpdateLocationInput
): Promise<ActionResult<void>> {
  const op = '[updateStockLocation]';

  if (!input.stockPieceId || !input.location) {
    return err('Missing required fields', 'MISSING_FIELDS');
  }

  const supabase = await createClient();

  const updateData: Record<string, unknown> = {
    current_location: input.location,
  };

  if (input.warehouseLocation !== undefined) {
    updateData.warehouse_location = input.warehouseLocation;
  }

  const { error } = await supabase
    .from('stock_pieces')
    .update(updateData)
    .eq('id', input.stockPieceId);

  if (error) {
    console.error(`${op} Update failed:`, error.message);
    return err(error.message, error.code);
  }

  revalidatePath('/inventory');
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Mark stock piece as scrapped
// ---------------------------------------------------------------------------

interface ScrapStockInput {
  stockPieceId: string;
  reason: string;
}

export async function scrapStockPiece(
  input: ScrapStockInput
): Promise<ActionResult<void>> {
  const op = '[scrapStockPiece]';
  console.log(`${op} Scrapping piece: ${input.stockPieceId}`);

  if (!input.stockPieceId || !input.reason) {
    return err('Missing required fields', 'MISSING_FIELDS');
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('stock_pieces')
    .update({
      is_scrap: true,
      scrapped_at: new Date().toISOString(),
      scrap_reason: input.reason,
      condition: 'scrapped',
      current_location: 'scrapped',
    })
    .eq('id', input.stockPieceId);

  if (error) {
    console.error(`${op} Scrap failed:`, error.message);
    return err(error.message, error.code);
  }

  revalidatePath('/inventory');
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Mark stock piece as installed
// ---------------------------------------------------------------------------

interface InstallStockInput {
  stockPieceId: string;
  projectId: string;
  installedBy?: string;
}

export async function markAsInstalled(
  input: InstallStockInput
): Promise<ActionResult<void>> {
  const op = '[markAsInstalled]';

  if (!input.stockPieceId || !input.projectId) {
    return err('Missing required fields', 'MISSING_FIELDS');
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('stock_pieces')
    .update({
      current_location: 'installed',
      installed_at_project_id: input.projectId,
      installed_at: new Date().toISOString(),
      installed_by: input.installedBy ?? null,
    })
    .eq('id', input.stockPieceId);

  if (error) {
    console.error(`${op} Install update failed:`, error.message);
    return err(error.message, error.code);
  }

  revalidatePath('/inventory');
  revalidatePath(`/projects/${input.projectId}`);
  return ok(undefined);
}
