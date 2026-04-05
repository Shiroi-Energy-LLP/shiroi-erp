'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

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
): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCutLength]';
  console.log(`${op} Starting for piece: ${input.stockPieceId}, new length: ${input.newLengthM}m`);

  if (!input.stockPieceId) return { success: false, error: 'Missing stock piece ID' };
  if (input.newLengthM < 0) return { success: false, error: 'Length cannot be negative' };

  const supabase = await createClient();

  // Fetch current piece to validate
  const { data: piece, error: fetchErr } = await supabase
    .from('stock_pieces')
    .select('id, is_cut_length, current_length_m, original_length_m, minimum_usable_length_m')
    .eq('id', input.stockPieceId)
    .single();

  if (fetchErr || !piece) {
    console.error(`${op} Piece not found:`, fetchErr?.message);
    return { success: false, error: 'Stock piece not found' };
  }

  if (!piece.is_cut_length) {
    return { success: false, error: 'This piece is not a cut-length item' };
  }

  if (piece.current_length_m !== null && input.newLengthM > piece.current_length_m) {
    return { success: false, error: 'New length cannot exceed current length' };
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
    return { success: false, error: updateErr.message };
  }

  revalidatePath('/inventory');
  console.log(`${op} Updated piece ${input.stockPieceId} to ${input.newLengthM}m${willBeScrap ? ' (auto-scrapped)' : ''}`);
  return { success: true };
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
): Promise<{ success: boolean; error?: string }> {
  const op = '[allocateToProject]';
  console.log(`${op} Allocating piece ${input.stockPieceId} to project ${input.projectId}`);

  if (!input.stockPieceId || !input.projectId) {
    return { success: false, error: 'Missing required fields' };
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
    return { success: false, error: error.message };
  }

  revalidatePath('/inventory');
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
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
): Promise<{ success: boolean; error?: string }> {
  const op = '[updateStockLocation]';

  if (!input.stockPieceId || !input.location) {
    return { success: false, error: 'Missing required fields' };
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
    return { success: false, error: error.message };
  }

  revalidatePath('/inventory');
  return { success: true };
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
): Promise<{ success: boolean; error?: string }> {
  const op = '[scrapStockPiece]';
  console.log(`${op} Scrapping piece: ${input.stockPieceId}`);

  if (!input.stockPieceId || !input.reason) {
    return { success: false, error: 'Missing required fields' };
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
    return { success: false, error: error.message };
  }

  revalidatePath('/inventory');
  return { success: true };
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
): Promise<{ success: boolean; error?: string }> {
  const op = '[markAsInstalled]';

  if (!input.stockPieceId || !input.projectId) {
    return { success: false, error: 'Missing required fields' };
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
    return { success: false, error: error.message };
  }

  revalidatePath('/inventory');
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
