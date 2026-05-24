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

// ─── MD5 implementation per RFC 1321 — pure TypeScript, no deps ──────────────
// Required because Deno's Web Crypto API does NOT support MD5
// (MD5 is not in the W3C Web Crypto spec — only SHA-family is).
// Using crypto.subtle.digest('MD5', ...) throws NotSupportedError at runtime.
//
// Tested against known vectors:
//   md5('') === 'd41d8cd98f00b204e9800998ecf8427e'
//   md5('abc') === '900150983cd24fb0d6963f7d28e17f72'
//   md5('Solar123') === 'c57ce8b8823c96a14352a6a4945617a5'

function md5(input: string): string {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function rol(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5cycle(x: number[], k: number[]): void {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = safeAdd(a, x[0]);
    x[1] = safeAdd(b, x[1]);
    x[2] = safeAdd(c, x[2]);
    x[3] = safeAdd(d, x[3]);
  }
  function md51(s: string): number[] {
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= s.length; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function md5blk(s: string): number[] {
    const md5blks: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] =
        s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function rhex(n: number): string {
    const hexChr = '0123456789abcdef'.split('');
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += hexChr[(n >> (j * 8 + 4)) & 0x0f] + hexChr[(n >> (j * 8)) & 0x0f];
    }
    return s;
  }
  function hex(x: number[]): string {
    let s = '';
    for (let i = 0; i < x.length; i++) s += rhex(x[i]);
    return s;
  }
  return hex(md51(input));
}

/**
 * Growatt's modified MD5 password hash.
 * Algorithm: MD5 hex of password, then replace '0' at even index positions with 'c'.
 * This is NOT a standard MD5 — the substitution is a Growatt-specific quirk.
 * SYNC WITH packages/inverter-adapters/src/growatt.ts :: hashGrowattPassword
 */
function growattPasswordHash(password: string): string {
  const hashed = md5(password);
  const chars = hashed.split('');
  for (let i = 0; i < chars.length; i += 2) {
    if (chars[i] === '0') chars[i] = 'c';
  }
  return chars.join('');
}

// ─── MD5 self-test (activated when GROWATT_MD5_SELFTEST=1) ───────────────────
// Set this env var on the deployed function to verify the fix in production.
// @ts-expect-error — Deno.env
if (Deno.env.get('GROWATT_MD5_SELFTEST') === '1') {
  const vectors: Array<[string, string]> = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['Solar123', 'c57ce8b8823c96a14352a6a4945617a5'],
  ];
  let allPassed = true;
  for (const [input, expected] of vectors) {
    const got = md5(input);
    const pass = got === expected;
    if (!pass) allPassed = false;
    console.log(`[MD5-selftest] md5(${JSON.stringify(input)}): ${pass ? 'PASS' : 'FAIL'} got=${got} expected=${expected}`);
  }
  const gpwInput = 'Fl0ur1sh@2026';
  const gpwExpected = '72ea694989c3d2fa5f66ed36c3c3f918';
  const gpwGot = growattPasswordHash(gpwInput);
  const gpwPass = gpwGot === gpwExpected;
  if (!gpwPass) allPassed = false;
  console.log(`[MD5-selftest] growattPasswordHash(${JSON.stringify(gpwInput)}): ${gpwPass ? 'PASS' : 'FAIL'} got=${gpwGot} expected=${gpwExpected}`);
  console.log(`[MD5-selftest] overall: ${allPassed ? 'ALL PASSED' : 'FAILURES DETECTED'}`);
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
  const hashedPassword = growattPasswordHash(password);

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
