/**
 * Standard return shape for all server actions in apps/erp/src/lib/*-actions.ts.
 *
 * Server actions must NEVER throw — exceptions cross the RSC boundary badly and
 * produce opaque errors for users. Instead, they return ActionResult<T>:
 *
 *   - success: true  → data is the typed result
 *   - success: false → error is a human-readable message, code is optional
 *
 * See CLAUDE.md NEVER-DO rule #19 and the "Server action return shape" section
 * of CODING STANDARDS for the canonical pattern.
 *
 * Usage:
 *
 *   import { ok, err, type ActionResult } from '@/lib/types/actions';
 *
 *   export async function updateProject(
 *     id: string,
 *     patch: ProjectUpdate,
 *   ): Promise<ActionResult<Project>> {
 *     const op = '[updateProject]';
 *     try {
 *       const supabase = await createClient();
 *       const { data, error } = await supabase
 *         .from('projects')
 *         .update(patch)
 *         .eq('id', id)
 *         .select()
 *         .single();
 *       if (error) {
 *         console.error(`${op} failed`, { id, error });
 *         return err(error.message, error.code);
 *       }
 *       return ok(data);
 *     } catch (e) {
 *       console.error(`${op} threw`, { id, e });
 *       return err(e instanceof Error ? e.message : 'Unknown error');
 *     }
 *   }
 *
 * Call site:
 *
 *   const result = await updateProject(id, patch);
 *   if (!result.success) {
 *     toast.error(result.error);
 *     return;
 *   }
 *   // result.data is typed Project
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Construct a successful action result. `void` results can be created as `ok()`
 * or `ok(undefined as void)`.
 */
export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

/**
 * Construct a failed action result. `code` is optional — use it when passing
 * through a Postgres error code (e.g. '23505' for unique violation) so the
 * caller can branch on specific failures.
 */
export function err(error: string, code?: string): ActionResult<never> {
  return { success: false, error, code };
}

/**
 * Type guard: narrow an ActionResult to its success branch. Useful in contexts
 * where `if (result.success)` isn't ergonomic (e.g. array filters).
 */
export function isOk<T>(
  result: ActionResult<T>,
): result is { success: true; data: T } {
  return result.success === true;
}
