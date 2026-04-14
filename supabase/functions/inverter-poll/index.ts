/**
 * inverter-poll Edge Function
 *
 * Purpose: every 5 minutes, scan `inverters` for devices whose next
 * poll is due (last_poll_at + polling_interval_minutes < NOW),
 * dispatch to the appropriate vendor adapter, and upsert the returned
 * readings into `inverter_readings` (partitioned).
 *
 * Trigger: pg_cron calls this function via pg_net, OR an external
 * scheduler (GitHub Actions / Vercel Cron / n8n) pings the endpoint.
 * For local dev, POST manually:
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/inverter-poll \
 *     -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
 *
 * Environment variables required:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (service role — bypasses RLS for write)
 *   - SYNTHETIC_INVERTER_READINGS (optional: "1" to use synthetic data)
 *
 * Status: wired up against stub adapters. When real vendor credentials
 * land, the adapters switch from NotImplementedError to real HTTP
 * calls — no change needed here.
 *
 * NOTE: This file is DENO, not Node. Imports use URL-based specifiers.
 * The @repo/inverter-adapters package cannot be imported directly
 * because Edge Functions don't resolve pnpm workspaces — we'd need to
 * inline a build step or publish the package. For now the function
 * uses a minimal inline adapter implementation; the package is the
 * reference implementation that the real poller will import once we
 * either (a) set up the Edge Function to bundle workspace deps, or
 * (b) publish @repo/inverter-adapters to a private registry.
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Inline minimal types — in a production build we'd import these
// from @repo/inverter-adapters after setting up Deno import maps.
type InverterBrand = 'sungrow' | 'growatt' | 'sma' | 'huawei' | 'fronius';
type NormalizedStatus = 'active' | 'offline' | 'fault' | 'derated';

interface NormalizedReading {
  recorded_at: string;
  ac_power_kw: number | null;
  dc_power_kw: number | null;
  ac_voltage_v: number | null;
  ac_current_a: number | null;
  ac_frequency_hz: number | null;
  temperature_c: number | null;
  energy_today_kwh: number | null;
  energy_total_kwh: number | null;
  status: NormalizedStatus | null;
  error_code: string | null;
  raw_payload: Record<string, unknown>;
}

// Synthetic reading generator (matches the one in base.ts)
function syntheticReading(ratedCapacityKw: number): NormalizedReading {
  const now = new Date();
  const istTs = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const hour = istTs.getUTCHours() + istTs.getUTCMinutes() / 60;

  let powerFactor = 0;
  if (hour > 6 && hour < 18) {
    powerFactor = Math.sin(((hour - 6) / 12) * Math.PI);
  }
  const jitter = 0.9 + Math.random() * 0.2;
  const acPower = ratedCapacityKw * powerFactor * jitter;

  return {
    recorded_at: now.toISOString(),
    ac_power_kw: Number(acPower.toFixed(3)),
    dc_power_kw: Number((acPower * 1.02).toFixed(3)),
    ac_voltage_v: 240 + (Math.random() - 0.5) * 4,
    ac_current_a: Number((acPower * 1000 / 240).toFixed(2)),
    ac_frequency_hz: 50 + (Math.random() - 0.5) * 0.1,
    temperature_c: 35 + Math.sin(((hour - 6) / 12) * Math.PI) * 15,
    energy_today_kwh: Number((ratedCapacityKw * 4.5 * Math.max(0, (hour - 6) / 12)).toFixed(3)),
    energy_total_kwh: null,
    status: acPower > 0 ? 'active' : 'offline',
    error_code: null,
    raw_payload: { source: 'synthetic-poller' },
  };
}

interface InverterDue {
  id: string;
  brand: InverterBrand;
  model: string | null;
  serial_number: string;
  monitoring_site_id: string | null;
  monitoring_device_id: string | null;
  monitoring_credentials_id: string | null;
  polling_interval_minutes: number;
  last_reading_at: string | null;
  rated_capacity_kw?: number;
}

// @ts-expect-error — Deno global
Deno.serve(async (_req: Request) => {
  const op = '[inverter-poll]';
  const startedAt = Date.now();

  // @ts-expect-error — Deno.env
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  // @ts-expect-error — Deno.env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // @ts-expect-error — Deno.env
  const synthetic = Deno.env.get('SYNTHETIC_INVERTER_READINGS') === '1';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find inverters due for a poll (via RPC from migration 050)
  const { data: due, error: dueError } = await supabase.rpc('get_inverters_due_for_poll', {
    batch_limit: 100,
  });
  if (dueError) {
    console.error(`${op} get_inverters_due_for_poll failed:`, dueError);
    return new Response(JSON.stringify({ error: dueError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const inverters = (due ?? []) as InverterDue[];
  if (inverters.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, succeeded: 0, failed: 0, duration_ms: Date.now() - startedAt }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`${op} processing ${inverters.length} inverters (synthetic=${synthetic})`);

  let succeeded = 0;
  let failed = 0;

  for (const inv of inverters) {
    try {
      // TODO: when real adapters land, resolve credentials from
      // inverter_monitoring_credentials via vault_secret_ref and call
      // getAdapter(inv.brand).fetchReadings({credentials, ...}).
      // For now only the synthetic path is wired.
      if (!synthetic) {
        throw new Error(
          `Live adapters not yet implemented — set SYNTHETIC_INVERTER_READINGS=1 to test pipeline`,
        );
      }

      const reading = syntheticReading(inv.rated_capacity_kw ?? 5);

      const { error: upsertError } = await supabase.from('inverter_readings').upsert(
        {
          inverter_id: inv.id,
          ...reading,
        },
        { onConflict: 'inverter_id,recorded_at', ignoreDuplicates: true },
      );

      if (upsertError) {
        throw upsertError;
      }

      // Update inverter health
      await supabase
        .from('inverters')
        .update({
          last_poll_at: new Date().toISOString(),
          last_reading_at: reading.recorded_at,
          current_status: reading.status ?? 'unknown',
        })
        .eq('id', inv.id);

      succeeded++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${op} inverter ${inv.id} failed:`, message);
      await supabase.from('inverter_poll_failures').insert({
        inverter_id: inv.id,
        error_message: message.substring(0, 500),
      });

      // Mark the inverter as attempted even though it failed, so the
      // next poll cycle re-queues it at the end of the batch instead of
      // retrying immediately.
      await supabase
        .from('inverters')
        .update({ last_poll_at: new Date().toISOString() })
        .eq('id', inv.id);
    }
  }

  return new Response(
    JSON.stringify({
      processed: inverters.length,
      succeeded,
      failed,
      duration_ms: Date.now() - startedAt,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
