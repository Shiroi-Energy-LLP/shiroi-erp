import { createClient } from '@repo/supabase/server';

export interface LiaisonSummary {
  total: number;
  awaiting_client: number;
  ceig_pending: number;
  ceig_in_process: number;
  tneb_active: number;
}

export async function getLiaisonSummary(): Promise<LiaisonSummary> {
  const op = '[getLiaisonSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_liaison_summary');

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return { total: 0, awaiting_client: 0, ceig_pending: 0, ceig_in_process: 0, tneb_active: 0 };
  }

  const row = (data as any)?.[0] ?? {};
  return {
    total:           Number(row.total           ?? 0),
    awaiting_client: Number(row.awaiting_client ?? 0),
    ceig_pending:    Number(row.ceig_pending    ?? 0),
    ceig_in_process: Number(row.ceig_in_process ?? 0),
    tneb_active:     Number(row.tneb_active     ?? 0),
  };
}
