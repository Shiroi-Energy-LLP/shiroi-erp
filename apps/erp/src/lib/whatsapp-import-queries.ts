import { createClient } from '@repo/supabase/server';

export interface QueueItem {
  id: string;
  chat_profile: string;
  message_timestamp: string;
  sender_name: string;
  raw_message_text: string | null;
  media_filenames: string[] | null;
  extraction_type: string;
  extracted_data: Record<string, unknown>;
  confidence_score: number | null;
  matched_project_id: string | null;
  matched_lead_id: string | null;
  matched_project_name: string | null;
  review_status: string;
  requires_finance_review: boolean;
  reviewed_at: string | null;
  review_notes: string | null;
  inserted_table: string | null;
  inserted_id: string | null;
  created_at: string;
}

export async function getQueueItems(filters: {
  status?: string;
  profile?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: QueueItem[]; total: number }> {
  const op = '[getQueueItems]';
  const supabase = await createClient();
  const { status = 'pending', profile, type, page = 1, pageSize = 50 } = filters;

  let query = supabase
    .from('whatsapp_import_queue')
    .select('*', { count: 'estimated' })
    .eq('review_status', status)
    .order('message_timestamp', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (profile) query = query.eq('chat_profile', profile);
  if (type) query = query.eq('extraction_type', type);

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch import queue: ${error.message}`);
  }

  return {
    items: (data ?? []) as QueueItem[],
    total: count ?? 0,
  };
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  const op = '[getQueueItem]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch queue item: ${error.message}`);
  }

  return data as QueueItem | null;
}

export interface QueueStats {
  pending: number;
  pending_finance: number;
  auto_inserted: number;
  rejected: number;
  approved: number;
  by_type: Record<string, number>;
  by_profile: Record<string, number>;
}

export async function getQueueStats(): Promise<QueueStats> {
  const op = '[getQueueStats]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .select('review_status, extraction_type, chat_profile, requires_finance_review');

  if (error) {
    console.error(`${op} Query failed:`, error.message);
    throw new Error(`Failed to fetch queue stats: ${error.message}`);
  }

  const rows = data ?? [];
  const pending = rows.filter(r => r.review_status === 'pending').length;
  const pending_finance = rows.filter(r => r.review_status === 'pending' && r.requires_finance_review).length;
  const auto_inserted = rows.filter(r => r.review_status === 'auto_inserted').length;
  const rejected = rows.filter(r => r.review_status === 'rejected').length;
  const approved = rows.filter(r => r.review_status === 'approved').length;

  const pendingRows = rows.filter(r => r.review_status === 'pending');
  const by_type: Record<string, number> = {};
  const by_profile: Record<string, number> = {};

  for (const r of pendingRows) {
    by_type[r.extraction_type] = (by_type[r.extraction_type] ?? 0) + 1;
    by_profile[r.chat_profile] = (by_profile[r.chat_profile] ?? 0) + 1;
  }

  return { pending, pending_finance, auto_inserted, rejected, approved, by_type, by_profile };
}
