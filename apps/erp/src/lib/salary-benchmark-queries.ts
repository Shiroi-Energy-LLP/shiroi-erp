import { createClient } from '@repo/supabase/server';

export type BenchmarkRow = {
  employee_id: string;
  employee_name: string;
  role: string;
  gross_monthly: number;
  market_median: number | null;
  market_p25: number | null;
  market_p75: number | null;
  delta_pct: number | null;
  recommendation: string | null;
  source: string | null;
};

export async function getSalaryBenchmarkReport(): Promise<BenchmarkRow[]> {
  const op = '[getSalaryBenchmarkReport]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_salary_benchmark_report' as never);
  if (error) {
    console.error(`${op} failed`, { error, timestamp: new Date().toISOString() });
    return [];
  }
  return (data ?? []) as BenchmarkRow[];
}

export async function getCallerRole(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return profile?.role ?? null;
}
