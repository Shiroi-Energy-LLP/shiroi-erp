import { createClient } from '@repo/supabase/server';

/**
 * Resolve the IDs of projects whose customer / number / name match a free-text
 * term, reusing the same `search_projects_lite` RPC the Projects-list search
 * box uses. Sharing the RPC means customer/project search behaves identically
 * everywhere it's offered (Tasks, Activities, Service Tickets).
 *
 * Callers OR these IDs against their own text columns so that typing a customer
 * name filters the table live — e.g. `project_id.in.(<ids>)`.
 *
 * Returns [] for blank/short (<2 char) terms or on error; the caller then falls
 * back to matching only its own text columns.
 */
export async function matchProjectIdsByText(term: string): Promise<string[]> {
  const op = '[matchProjectIdsByText]';
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const supabase = await createClient();
  // p_query is a bound RPC parameter (not string-interpolated SQL), so the raw
  // term is safe here. Cap the match set so the resulting IN-list stays a sane
  // URL length — real customer/project searches match only a handful.
  const { data, error } = await supabase.rpc('search_projects_lite', {
    p_query: trimmed,
    p_limit: 200,
  });

  if (error) {
    console.error(`${op} RPC failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  return (data ?? []).map((r: { id: string }) => r.id);
}
