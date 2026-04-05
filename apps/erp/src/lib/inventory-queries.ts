import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type StockPieceRow = Database['public']['Tables']['stock_pieces']['Row'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];

// ---------------------------------------------------------------------------
// List types
// ---------------------------------------------------------------------------

export interface StockPieceListItem extends StockPieceRow {
  projects: Pick<ProjectRow, 'project_number' | 'customer_name'> | null;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface InventoryFilters {
  category?: string;
  location?: string;
  condition?: string;
  projectId?: string;
  isCutLength?: boolean;
  isScrap?: boolean;
  search?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get all stock pieces with optional filters.
 */
export async function getStockPieces(filters: InventoryFilters = {}): Promise<StockPieceListItem[]> {
  const op = '[getStockPieces]';
  const supabase = await createClient();

  let query = supabase
    .from('stock_pieces')
    .select('*, projects!stock_pieces_project_id_fkey(project_number, customer_name)')
    .order('updated_at', { ascending: false });

  if (filters.category) {
    query = query.eq('item_category', filters.category);
  }
  if (filters.location) {
    query = query.eq('current_location', filters.location);
  }
  if (filters.condition) {
    query = query.eq('condition', filters.condition);
  }
  if (filters.projectId) {
    query = query.eq('project_id', filters.projectId);
  }
  if (filters.isCutLength !== undefined) {
    query = query.eq('is_cut_length', filters.isCutLength);
  }
  if (filters.isScrap !== undefined) {
    query = query.eq('is_scrap', filters.isScrap);
  }
  if (filters.search) {
    query = query.or(`item_description.ilike.%${filters.search}%,brand.ilike.%${filters.search}%,serial_number.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as StockPieceListItem[];
}

/**
 * Get a single stock piece by ID with full details.
 */
export async function getStockPiece(id: string): Promise<StockPieceListItem | null> {
  const op = '[getStockPiece]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('stock_pieces')
    .select('*, projects!stock_pieces_project_id_fkey(project_number, customer_name)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return null;
  }

  return data as StockPieceListItem;
}

/**
 * Get cut-length pieces that are running low (current < 2x minimum).
 */
export async function getLowStockCutLengths(): Promise<StockPieceListItem[]> {
  const op = '[getLowStockCutLengths]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('stock_pieces')
    .select('*, projects!stock_pieces_project_id_fkey(project_number, customer_name)')
    .eq('is_cut_length', true)
    .eq('is_scrap', false)
    .not('current_length_m', 'is', null)
    .not('minimum_usable_length_m', 'is', null)
    .order('current_length_m', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }

  // Filter client-side: current_length < 2 * minimum_usable
  return ((data ?? []) as StockPieceListItem[]).filter((p) => {
    const current = p.current_length_m ?? 0;
    const min = p.minimum_usable_length_m ?? 0;
    return current < min * 2 && current >= min;
  });
}

/**
 * Get inventory summary counts by category and location.
 */
export async function getInventorySummary(): Promise<{
  byCategory: Record<string, number>;
  byLocation: Record<string, number>;
  totalPieces: number;
  cutLengthPieces: number;
  scrapPieces: number;
}> {
  const op = '[getInventorySummary]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('stock_pieces')
    .select('item_category, current_location, is_cut_length, is_scrap');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return { byCategory: {}, byLocation: {}, totalPieces: 0, cutLengthPieces: 0, scrapPieces: 0 };
  }

  const items = data ?? [];
  const byCategory: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  let cutLengthPieces = 0;
  let scrapPieces = 0;

  for (const item of items) {
    byCategory[item.item_category] = (byCategory[item.item_category] ?? 0) + 1;
    byLocation[item.current_location] = (byLocation[item.current_location] ?? 0) + 1;
    if (item.is_cut_length) cutLengthPieces++;
    if (item.is_scrap) scrapPieces++;
  }

  return {
    byCategory,
    byLocation,
    totalPieces: items.length,
    cutLengthPieces,
    scrapPieces,
  };
}

/**
 * Get stock pieces allocated to a specific project.
 */
export async function getProjectStock(projectId: string): Promise<StockPieceListItem[]> {
  const op = '[getProjectStock]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('stock_pieces')
    .select('*, projects!stock_pieces_project_id_fkey(project_number, customer_name)')
    .eq('project_id', projectId)
    .order('item_category', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as StockPieceListItem[];
}
