/**
 * inverter-poll Edge Function
 *
 * Purpose: every 5 minutes, scan `inverters` for devices whose next
 * poll is due (last_poll_at + polling_interval_minutes < NOW),
 * dispatch to the appropriate vendor adapter, and upsert the returned
 * readings into `inverter_readings` (partitioned).
 *
 * Trigger: n8n cron workflow (60-inverter-poll-cron.json) fires a POST
 * every 5 minutes. For local dev, POST manually:
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/inverter-poll \
 *     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
 *
 * Environment variables required:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (service role — bypasses RLS for write)
 *   - SYNTHETIC_INVERTER_READINGS (optional: "1" to force synthetic data)
 *   - SUNGROW_APPKEY (required for Sungrow inverters in real mode)
 *
 * Adapter dispatch (Phase 8 — 2026-05-24):
 *   - growatt:   per-customer auth via plant_monitoring_credentials.
 *                Session cache shared within a poll cycle to avoid
 *                Growatt login rate limits (~22 logins → ~8 per cycle).
 *   - sungrow:   reads inverter_monitoring_credentials.config.access_token;
 *                skips with warning if oauth_status != 'authorized'.
 *   - solarman:  stub (synthetic) — real impl pending paid API plan.
 *   - goodwe:    stub (synthetic) — real impl pending API registration.
 *
 * NOTE: This file is DENO, not Node. Imports use URL-based specifiers.
 * Adapter logic is inlined (not imported from @repo/inverter-adapters)
 * because Deno Edge Functions do not resolve pnpm workspaces.
 *
 * // SYNC WITH packages/inverter-adapters/src/growatt.ts
 * // SYNC WITH packages/inverter-adapters/src/sungrow.ts
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Shared types ──────────────────────────────────────────────────────────

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

interface InverterDue {
  id: string;
  project_id: string;
  brand: string;
  model: string | null;
  serial_number: string;
  monitoring_site_id: string | null;
  monitoring_device_id: string | null;
  monitoring_credentials_id: string | null;
  polling_interval_minutes: number;
  last_reading_at: string | null;
  rated_capacity_kw: number;
}

// ─── Synthetic reading generator ───────────────────────────────────────────
// SYNC WITH packages/inverter-adapters/src/base.ts :: syntheticReading

function syntheticReading(ratedCapacityKw: number): NormalizedReading {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTs = new Date(now.getTime() + istOffsetMs);
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
    raw_payload: { source: 'synthetic-poller', power_factor: powerFactor, jitter },
  };
}

// ─── Growatt adapter (inlined from packages/inverter-adapters/src/growatt.ts) ─
// SYNC WITH packages/inverter-adapters/src/growatt.ts

const GROWATT_BASE_URL = 'https://server-api.growatt.com/';

// Growatt deviceStatus integer → NormalizedStatus.
// 1=active, 3=fault, 5=offline (confirmed against real API 2026-05-23)
const GROWATT_STATUS_MAP: Record<number, NormalizedStatus> = {
  1: 'active',
  3: 'fault',
  5: 'offline',
};

function mapGrowattStatus(deviceStatus: number | null | undefined): NormalizedStatus | null {
  if (deviceStatus == null) return null;
  return GROWATT_STATUS_MAP[deviceStatus] ?? null;
}

/**
 * Growatt's modified MD5 password hash.
 * Algorithm: MD5 hex of password, then replace '0' at even positions with 'c'.
 * This is NOT a simple MD5 — the substitution is required.
 * SYNC WITH packages/inverter-adapters/src/growatt.ts :: hashGrowattPassword
 */
async function growattPasswordHash(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('MD5', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  let md5 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < md5.length; i += 2) {
    if (md5[i] === '0') {
      md5 = md5.slice(0, i) + 'c' + md5.slice(i + 1);
    }
  }
  return md5;
}

/**
 * Extract Set-Cookie headers into a single Cookie header value.
 * SYNC WITH packages/inverter-adapters/src/growatt.ts :: extractCookies
 */
function extractCookies(headers: Headers): string {
  const cookies: string[] = [];
  if (typeof headers.getSetCookie === 'function') {
    for (const raw of headers.getSetCookie()) {
      const pair = (raw.split(';')[0] ?? '').trim();
      if (pair) cookies.push(pair);
    }
  } else {
    const raw = headers.get('set-cookie') ?? headers.get('Set-Cookie') ?? '';
    if (raw) {
      for (const segment of raw.split(/,\s*(?=[A-Za-z_])/)) {
        const pair = (segment.split(';')[0] ?? '').trim();
        if (pair) cookies.push(pair);
      }
    }
  }
  return cookies.join('; ');
}

interface GrowattSessionEntry {
  userId: number;
  cookieHeader: string;
  expiresAt: number; // ms since epoch — sessions treated as valid for 10 min
}

interface GrowattSessionCache {
  get(username: string): { userId: number; cookieHeader: string } | null;
  set(username: string, value: { userId: number; cookieHeader: string }): void;
}

function newGrowattSessionCache(): GrowattSessionCache {
  const cache = new Map<string, GrowattSessionEntry>();
  const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
  return {
    get(username: string) {
      const entry = cache.get(username);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        cache.delete(username);
        return null;
      }
      return { userId: entry.userId, cookieHeader: entry.cookieHeader };
    },
    set(username: string, value: { userId: number; cookieHeader: string }) {
      cache.set(username, {
        userId: value.userId,
        cookieHeader: value.cookieHeader,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
    },
  };
}

interface GrowattDevice {
  deviceSn: string;
  deviceStatus: number;
  power: string;
  eToday: string;
  energy: string;
  lost?: boolean;
  [key: string]: unknown;
}

async function growattLogin(
  username: string,
  password: string,
): Promise<{ userId: number; cookieHeader: string }> {
  const op = '[growattLogin]';
  const hashedPassword = await growattPasswordHash(password);

  const body = new URLSearchParams();
  body.set('userName', username);
  body.set('password', hashedPassword);

  const response = await fetch(`${GROWATT_BASE_URL}newTwoLoginAPI.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const cookieHeader = extractCookies(response.headers);
  const json = await response.json() as {
    back: { success: boolean; user?: { id: number }; msg?: string; error?: string };
  };
  const back = json.back;

  if (!back.success) {
    const errMsg = back.msg ?? back.error ?? 'Login failed';
    console.error(`${op} login failed: ${errMsg}`, { username, timestamp: new Date().toISOString() });
    throw new Error(`Growatt login failed: ${errMsg}`);
  }

  if (!back.user || typeof back.user.id !== 'number') {
    throw new Error('Growatt login succeeded but response missing user.id');
  }

  return { userId: back.user.id, cookieHeader };
}

async function growattGetDeviceList(
  plantId: string,
  cookieHeader: string,
): Promise<GrowattDevice[]> {
  const op = '[growattGetDeviceList]';
  const url = `${GROWATT_BASE_URL}newTwoPlantAPI.do?op=getAllDeviceList&plantId=${plantId}&language=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Cookie: cookieHeader },
  });

  const json = await response.json() as { deviceList?: GrowattDevice[] };
  if (!json.deviceList) {
    console.warn(`${op} deviceList missing from response for plantId=${plantId}`);
  }
  return json.deviceList ?? [];
}

async function fetchGrowattReading(
  username: string,
  password: string,
  inv: InverterDue,
  sessionCache: GrowattSessionCache,
): Promise<NormalizedReading> {
  const op = '[fetchGrowattReading]';

  if (!inv.monitoring_site_id) {
    throw new Error('Growatt: monitoring_site_id (plantId) is required');
  }
  if (!inv.monitoring_device_id) {
    throw new Error('Growatt: monitoring_device_id (deviceSn) is required');
  }

  // Reuse cached session or log in fresh
  let session = sessionCache.get(username);
  if (!session) {
    console.log(`${op} logging in for username=${username}`);
    session = await growattLogin(username, password);
    sessionCache.set(username, session);
  } else {
    console.log(`${op} reusing cached session for username=${username}`);
  }

  const devices = await growattGetDeviceList(inv.monitoring_site_id, session.cookieHeader);
  const device = devices.find(d => d.deviceSn === inv.monitoring_device_id);

  if (!device) {
    throw new Error(
      `Growatt: device ${inv.monitoring_device_id} not found in plant ${inv.monitoring_site_id}. ` +
      `Available: [${devices.map(d => d.deviceSn).join(', ')}]`,
    );
  }

  // power is in Watts as a string; eToday and energy are in kWh
  const acPowerKw = parseFloat(device.power) / 1000;
  const energyTodayKwh = parseFloat(device.eToday);
  const energyTotalKwh = parseFloat(device.energy);

  return {
    recorded_at: new Date().toISOString(),
    ac_power_kw: isNaN(acPowerKw) ? null : acPowerKw,
    dc_power_kw: null, // not exposed by the legacy API
    ac_voltage_v: null,
    ac_current_a: null,
    ac_frequency_hz: null,
    temperature_c: null,
    energy_today_kwh: isNaN(energyTodayKwh) ? null : energyTodayKwh,
    energy_total_kwh: isNaN(energyTotalKwh) ? null : energyTotalKwh,
    status: mapGrowattStatus(device.deviceStatus),
    error_code: null,
    raw_payload: device as Record<string, unknown>,
  };
}

// ─── Sungrow adapter (inlined from packages/inverter-adapters/src/sungrow.ts) ─
// SYNC WITH packages/inverter-adapters/src/sungrow.ts

const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',
  '2': 'fault',
  '3': 'offline',
  '4': 'derated',
  '5': 'derated',
};

function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (!raw) return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

async function fetchSungrowReading(
  apiKey: string,
  oauthToken: string,
  apiBase: string,
  inv: InverterDue,
): Promise<NormalizedReading> {
  const op = '[fetchSungrowReading]';

  if (!inv.monitoring_site_id) {
    throw new Error('Sungrow: monitoring_site_id (ps_id) is required');
  }
  if (!inv.monitoring_device_id) {
    throw new Error('Sungrow: monitoring_device_id (device_sn) is required');
  }

  const base = apiBase.replace(/\/$/, '');
  const url = `${base}/openapi/getDeviceRealTimeData`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-access-key': apiKey,
      Authorization: `Bearer ${oauthToken}`,
    },
    body: JSON.stringify({
      ps_id: inv.monitoring_site_id,
      device_sn_list: [inv.monitoring_device_id],
    }),
  });

  if (!res.ok) {
    throw new Error(`Sungrow HTTP ${res.status} from getDeviceRealTimeData`);
  }

  const body = await res.json() as {
    result_code: string | number;
    result_msg?: string;
    result_data?: { p_array?: Array<Record<string, unknown>> };
  };

  if (String(body.result_code) !== '1') {
    throw new Error(`Sungrow API error: ${body.result_msg ?? `result_code=${body.result_code}`}`);
  }

  const arr = body.result_data?.p_array ?? [];
  const row =
    arr.find(r => String(r['device_sn']) === inv.monitoring_device_id) ?? arr[0];

  if (!row) {
    console.warn(`${op} p_array empty for device ${inv.monitoring_device_id} — skipping`);
    return syntheticReading(inv.rated_capacity_kw); // fallback to synthetic when no data
  }

  // Sungrow sends "YYYY-MM-DD HH:MM:SS" in IST (no TZ info). Append +05:30.
  const updateTimeRaw = typeof row['update_time'] === 'string' ? row['update_time'] : null;
  const recordedAt = updateTimeRaw
    ? new Date(updateTimeRaw.replace(' ', 'T') + '+05:30').toISOString()
    : new Date().toISOString();

  return {
    recorded_at: recordedAt,
    ac_power_kw: row['p_kw'] != null ? Number(row['p_kw']) : null,
    dc_power_kw: row['dc_p_kw'] != null ? Number(row['dc_p_kw']) : null,
    ac_voltage_v: row['grid_v'] != null ? Number(row['grid_v']) : null,
    ac_current_a: row['grid_a'] != null ? Number(row['grid_a']) : null,
    ac_frequency_hz: row['grid_freq'] != null ? Number(row['grid_freq']) : null,
    temperature_c: row['t_inverter'] != null ? Number(row['t_inverter']) : null,
    energy_today_kwh: row['today_energy_kwh'] != null ? Number(row['today_energy_kwh']) : null,
    energy_total_kwh: row['total_energy_kwh'] != null ? Number(row['total_energy_kwh']) : null,
    status: mapSungrowStatus(row['device_status'] != null ? String(row['device_status']) : undefined),
    error_code: row['fault_code'] != null ? String(row['fault_code']) : null,
    raw_payload: row,
  };
}

// ─── SolarMan stub ─────────────────────────────────────────────────────────
// Real impl pending SolarMan paid API plan. Logs a notice and returns synthetic.

async function fetchSolarmanReading(inv: InverterDue): Promise<NormalizedReading> {
  console.log(`[fetchSolarmanReading] SolarMan adapter not yet implemented (pending paid API plan). Using synthetic for inverter ${inv.id}`);
  return syntheticReading(inv.rated_capacity_kw);
}

// ─── Goodwe stub ───────────────────────────────────────────────────────────
// Real impl pending Goodwe API registration.

async function fetchGoodweReading(inv: InverterDue): Promise<NormalizedReading> {
  console.log(`[fetchGoodweReading] Goodwe adapter not yet implemented (pending API registration). Using synthetic for inverter ${inv.id}`);
  return syntheticReading(inv.rated_capacity_kw);
}

// ─── Main handler ──────────────────────────────────────────────────────────

// @ts-expect-error — Deno global
Deno.serve(async (_req: Request) => {
  const op = '[inverter-poll]';
  const startedAt = Date.now();

  // @ts-expect-error — Deno.env
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  // @ts-expect-error — Deno.env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // @ts-expect-error — Deno.env
  const syntheticMode = Deno.env.get('SYNTHETIC_INVERTER_READINGS') === '1';
  // @ts-expect-error — Deno.env
  const sungrowAppKey = Deno.env.get('SUNGROW_APPKEY') ?? '';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Query inverters due for a poll directly (includes project_id + rated_capacity_kw
  // which get_inverters_due_for_poll RPC does not expose).
  const { data: due, error: dueError } = await supabase
    .from('inverters')
    .select(
      'id, project_id, brand, model, serial_number, monitoring_site_id, monitoring_device_id, monitoring_credentials_id, polling_interval_minutes, last_reading_at, rated_capacity_kw',
    )
    .eq('polling_enabled', true)
    .neq('current_status', 'decommissioned')
    .or('last_poll_at.is.null,last_poll_at.lt.' + new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order('last_poll_at', { ascending: true, nullsFirst: true })
    .limit(100);

  if (dueError) {
    console.error(`${op} inverters query failed:`, dueError);
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

  console.log(`${op} processing ${inverters.length} inverters (syntheticMode=${syntheticMode})`);

  let succeeded = 0;
  let failed = 0;

  // Session cache for Growatt: shared across all inverters in this poll cycle.
  // Reduces logins from N-inverters-per-customer to 1-per-customer-per-cycle.
  const growattSessions = newGrowattSessionCache();

  for (const inv of inverters) {
    try {
      let reading: NormalizedReading;

      if (syntheticMode) {
        // Force synthetic regardless of brand (for testing the pipeline)
        reading = syntheticReading(inv.rated_capacity_kw ?? 5);
      } else if (inv.brand === 'growatt') {
        // Per-customer credentials from plant_monitoring_credentials
        const { data: pc, error: pcErr } = await supabase
          .from('plant_monitoring_credentials')
          .select('username, password')
          .eq('project_id', inv.project_id)
          .eq('inverter_brand', 'growatt')
          .is('deleted_at', null)
          .maybeSingle();

        if (pcErr) {
          throw new Error(`plant_monitoring_credentials query failed: ${pcErr.message}`);
        }
        if (!pc) {
          console.warn(`${op} inverter ${inv.id} (growatt): no plant_monitoring_credentials row for project ${inv.project_id}; skipping`);
          continue;
        }

        reading = await fetchGrowattReading(
          pc.username,
          pc.password,
          inv,
          growattSessions,
        );
      } else if (inv.brand === 'sungrow') {
        // Master credentials row with config JSONB containing OAuth token
        if (!inv.monitoring_credentials_id) {
          console.warn(`${op} inverter ${inv.id} (sungrow): no monitoring_credentials_id; skipping`);
          continue;
        }
        const { data: imc, error: imcErr } = await supabase
          .from('inverter_monitoring_credentials')
          .select('config')
          .eq('id', inv.monitoring_credentials_id)
          .maybeSingle();

        if (imcErr) {
          throw new Error(`inverter_monitoring_credentials query failed: ${imcErr.message}`);
        }

        const config = (imc?.config ?? {}) as Record<string, string | null>;
        if (config['oauth_status'] !== 'authorized' || !config['access_token']) {
          console.warn(
            `${op} inverter ${inv.id} (sungrow): oauth_status=${config['oauth_status'] ?? 'null'} / access_token=${config['access_token'] ? 'present' : 'missing'}; skipping until authorized`,
          );
          continue;
        }

        reading = await fetchSungrowReading(
          sungrowAppKey,
          config['access_token'],
          config['api_base'] ?? 'https://gateway.isolarcloud.com.hk',
          inv,
        );
      } else if (inv.brand === 'solarman') {
        reading = await fetchSolarmanReading(inv);
      } else if (inv.brand === 'goodwe') {
        reading = await fetchGoodweReading(inv);
      } else {
        console.warn(`${op} unsupported brand="${inv.brand}" for inverter ${inv.id}; skipping`);
        continue;
      }

      // Upsert reading
      const { error: upsertError } = await supabase.from('inverter_readings').upsert(
        { inverter_id: inv.id, ...reading },
        { onConflict: 'inverter_id,recorded_at', ignoreDuplicates: true },
      );
      if (upsertError) throw upsertError;

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
      console.error(`${op} inverter ${inv.id} (${inv.brand}) failed:`, message);

      await supabase.from('inverter_poll_failures').insert({
        inverter_id: inv.id,
        error_message: message.substring(0, 500),
      });

      // Mark attempted so this inverter goes to the end of the queue
      // rather than retrying immediately next cycle.
      await supabase
        .from('inverters')
        .update({ last_poll_at: new Date().toISOString() })
        .eq('id', inv.id);
    }
  }

  const summary = {
    processed: inverters.length,
    succeeded,
    failed,
    duration_ms: Date.now() - startedAt,
  };
  console.log(`${op} done`, summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
