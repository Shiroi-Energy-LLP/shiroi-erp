'use server';

// apps/erp/src/lib/zoho-sync-actions.ts
//
// Manual trigger for the zoho-sync Edge Function (/settings/zoho-sync
// "Sync now" buttons). Fire-and-forget POST, same pattern as emitErpEvent:
// 3-second AbortSignal timeout, log-don't-throw. The Edge Function replies
// 202 early and continues via EdgeRuntime.waitUntil, so a timeout here most
// likely means a cold start that is still going to run — treated as
// triggered. No background work happens inside this action (NEVER-DO #18).

import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getSessionContext } from '@/lib/auth';

export type ZohoSyncMode = 'pull' | 'push' | 'both';

const VALID_MODES: readonly ZohoSyncMode[] = ['pull', 'push', 'both'];

export async function triggerZohoSync(
  mode: ZohoSyncMode,
): Promise<ActionResult<{ triggered: true }>> {
  const op = '[triggerZohoSync]';
  try {
    // Re-resolve identity server-side — never trust client-passed role
    // (NEVER-DO #22). RLS on the sync tables is founder/finance; the manual
    // trigger is gated to the same pair.
    const { role, userId } = await getSessionContext();
    if (!userId) return err('You must be signed in', 'UNAUTHENTICATED');
    if (role !== 'founder' && role !== 'finance') {
      return err('Only founder or finance can trigger a Zoho sync', 'FORBIDDEN');
    }

    // `mode` crosses the RSC boundary from the client — validate, don't trust.
    if (!VALID_MODES.includes(mode)) {
      return err('Invalid sync mode');
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !secretKey) {
      console.error(`${op} missing env`, {
        hasUrl: Boolean(supabaseUrl),
        hasSecret: Boolean(secretKey),
        timestamp: new Date().toISOString(),
      });
      return err('Zoho sync is not configured on this environment');
    }

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/zoho-sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) {
        console.error(`${op} function non-2xx`, {
          mode,
          status: resp.status,
          timestamp: new Date().toISOString(),
        });
        return err(`Sync trigger failed (HTTP ${resp.status})`);
      }
      // 202 (early reply, work continues in background) and any other 2xx.
      return ok({ triggered: true as const });
    } catch (e) {
      // AbortSignal.timeout rejects with a DOMException named 'TimeoutError'
      // ('AbortError' on some runtimes). The function replies 202 before the
      // real work, so a timeout means a slow cold start, not a failure — the
      // run was still triggered.
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        console.warn(`${op} trigger timed out after 3s — treating as triggered`, {
          mode,
          timestamp: new Date().toISOString(),
        });
        return ok({ triggered: true as const });
      }
      console.error(`${op} fetch failed`, {
        mode,
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      });
      return err('Could not reach the sync function. Please try again.');
    }
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      mode,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return err('Something went wrong. Please try again.');
  }
}
