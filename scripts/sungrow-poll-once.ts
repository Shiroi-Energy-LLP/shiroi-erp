// scripts/sungrow-poll-once.ts
//
// Local run of the Sungrow poll path — fetch real-time data for every
// Sungrow inverter in the database and upsert into inverter_readings.
// Used to prove the end-to-end pipeline works before the Edge Function
// is wired up with secrets.
//
//   pnpm tsx scripts/sungrow-poll-once.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sungrowRsaEncrypt } from '../packages/inverter-adapters/src/sungrow-rsa';
import { createClient } from '@supabase/supabase-js';

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

interface SungrowEnvelope<T> {
  result_code: string | number;
  result_msg?: string;
  result_data?: T;
}

async function sungrowPost<T>(
  base: string, path: string, accessKey: string,
  body: Record<string, unknown>, token?: string,
): Promise<SungrowEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'x-access-key': accessKey,
    sys_code: '901',
  };
  if (token) headers.token = token;
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return (await res.json()) as SungrowEnvelope<T>;
}

const POINTS = ['p83022', 'p83025', 'p83033', 'p83020', 'p83036', 'p83097'];

const STATUS_MAP: Record<string, string> = { '1': 'active', '2': 'fault', '3': 'offline', '4': 'derated', '5': 'derated' };

function parseDeviceTime(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length !== 14) return new Date().toISOString();
  const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8);
  const h = raw.slice(8, 10), mi = raw.slice(10, 12), s = raw.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`).toISOString();
}

function toNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const env = loadEnv();
  const appkey = env.SUNGROW_APPKEY;
  const secret = env.SUNGROW_SECRET;
  const base = env.SUNGROW_BASE_URL ?? 'https://gateway.isolarcloud.com.hk';

  // 1) Login
  console.log('[1] Login...');
  const encPass = await sungrowRsaEncrypt(env.SUNGROW_PASSWORD, env.SUNGROW_RSA_PUBLIC_KEY);
  const loginRes = await sungrowPost<{ token?: string }>(base, '/openapi/login', secret, {
    appkey, user_account: env.SUNGROW_USERNAME, user_password: encPass,
    login_type: '1', sys_code: '901',
  });
  if (String(loginRes.result_code) !== '1') throw new Error(`Login failed: ${loginRes.result_msg}`);
  const token = loginRes.result_data?.token!;
  console.log(`    ✓ token=${token.slice(0, 12)}…`);

  // 2) Load Sungrow inverters from DB
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log('[2] Loading Sungrow inverters from DB...');
  const { data: inverters, error } = await supabase
    .from('inverters')
    .select('id, serial_number, monitoring_site_id, monitoring_device_id, rated_capacity_kw')
    .eq('brand', 'sungrow')
    .eq('polling_enabled', true);
  if (error || !inverters) throw new Error(`inverters query: ${error?.message}`);
  console.log(`    ✓ ${inverters.length} inverters`);

  // 3) Poll each
  console.log('[3] Polling...');
  let success = 0, fail = 0, empty = 0;
  for (const inv of inverters) {
    if (!inv.monitoring_device_id) { fail++; continue; }
    const looksLikePsKey = inv.monitoring_device_id.includes('_');
    try {
      const body = await sungrowPost<{
        device_point_list?: Array<{ device_point?: Record<string, unknown> }>;
        fail_ps_key_list?: string[];
      }>(base, '/openapi/getDeviceRealTimeData', secret, {
        appkey, token,
        ps_key_list: looksLikePsKey ? [inv.monitoring_device_id] : undefined,
        sn_list: looksLikePsKey ? undefined : [inv.monitoring_device_id],
        device_type: 1,
        point_id_list: POINTS,
      }, token);

      if (String(body.result_code) !== '1') {
        console.log(`    ✗ ${inv.serial_number}: ${body.result_msg}`);
        fail++;
        continue;
      }
      const list = body.result_data?.device_point_list ?? [];
      const fails = body.result_data?.fail_ps_key_list ?? [];
      if (list.length === 0 || fails.length > 0) {
        console.log(`    · ${inv.serial_number}: no data (fail=${JSON.stringify(fails)})`);
        empty++;
        continue;
      }

      const point = list[0]?.device_point ?? {};
      const reading = {
        inverter_id: inv.id,
        recorded_at: parseDeviceTime(point['device_time']),
        ac_power_kw: toNum(point['p83022']),
        dc_power_kw: toNum(point['p83020']),
        ac_voltage_v: null,
        ac_current_a: null,
        ac_frequency_hz: toNum(point['p83036']),
        temperature_c: toNum(point['p83097']),
        energy_today_kwh: toNum(point['p83025']),
        energy_total_kwh: toNum(point['p83033']),
        status: STATUS_MAP[String(point['dev_status'] ?? '')] ?? null,
        error_code: point['dev_fault_status'] != null ? String(point['dev_fault_status']) : null,
        raw_payload: point,
      };

      const { error: upErr } = await supabase
        .from('inverter_readings')
        .upsert(reading, { onConflict: 'inverter_id,recorded_at', ignoreDuplicates: true });

      if (upErr) {
        console.log(`    ✗ ${inv.serial_number}: upsert ${upErr.message}`);
        fail++;
        continue;
      }

      // Update health on inverter
      await supabase.from('inverters').update({
        last_poll_at: new Date().toISOString(),
        last_reading_at: reading.recorded_at,
        current_status: reading.status ?? 'unknown',
      }).eq('id', inv.id);

      console.log(`    ✓ ${inv.serial_number}: P=${reading.ac_power_kw}kW E_today=${reading.energy_today_kwh}kWh status=${reading.status}`);
      success++;
    } catch (e) {
      console.log(`    ✗ ${inv.serial_number}: ${e instanceof Error ? e.message : e}`);
      fail++;
    }
  }

  console.log(`\nDone. success=${success} empty=${empty} fail=${fail}`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
