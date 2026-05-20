import { createClient } from '@repo/supabase/server';

/**
 * Reshaped system_settings singleton row — Supabase returns updated_by as a
 * UUID, we resolve the human name via an FK join to employees.
 */
export interface SystemSettingsRow {
  proposal_gate_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
}

/**
 * Reads the system_settings singleton row and resolves updated_by_name via
 * a join against employees. Returns null on any error so callers (e.g. the
 * proposal-gate banner) can degrade gracefully rather than crashing.
 */
export async function getSystemSettings(): Promise<SystemSettingsRow | null> {
  const op = '[getSystemSettings]';
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('system_settings')
      .select(
        'proposal_gate_enabled, updated_at, updated_by, employees!system_settings_updated_by_fkey(full_name)',
      )
      .eq('id', true)
      .maybeSingle();

    if (error) {
      console.error(`${op} query failed`, {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (!data) {
      console.warn(`${op} no system_settings row found`, {
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    return {
      proposal_gate_enabled: data.proposal_gate_enabled,
      updated_at: data.updated_at,
      updated_by: data.updated_by,
      updated_by_name: data.employees?.full_name ?? null,
    };
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}
