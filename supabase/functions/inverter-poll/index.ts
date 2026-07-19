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
 * Adapter dispatch:
 *   - growatt:   per-customer auth via plant_monitoring_credentials.
 *                Session cache shared within a poll cycle to avoid
 *                Growatt login rate limits (~22 logins → ~8 per cycle).
 *   - sungrow:   direct-login via SUNGROW_* env. One login per poll cycle.
 *   - fimer:     per-account auth via inverter_monitoring_credentials.
 *                Each row's vault_secret_ref names a Deno env var holding
 *                {api_key, username, password} JSON. 60-min token cache
 *                per credentials_id for the poll cycle. (live 2026-06-05)
 *   - solarman:  stub (synthetic) — real impl pending paid API plan.
 *   - goodwe:    stub (synthetic) — real impl pending API registration.
 *
 * NOTE: This file is DENO, not Node. Imports use URL-based specifiers.
 * Adapter logic is inlined (not imported from @repo/inverter-adapters)
 * because Deno Edge Functions do not resolve pnpm workspaces.
 *
 * // SYNC WITH packages/inverter-adapters/src/growatt.ts
 * // SYNC WITH packages/inverter-adapters/src/sungrow.ts
 * // SYNC WITH packages/inverter-adapters/src/fimer.ts
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

// ─── Time bounds ────────────────────────────────────────────────────────────
// These two constants guarantee the function ALWAYS returns before the n8n HTTP
// Request node gives up. n8n's "The connection was aborted, perhaps the server
// is offline" is what you get when the request outlives the node's timeout — the
// function keeps running and still logs a 200, but n8n has already marked the
// cron execution as failed.
//
// FETCH_TIMEOUT_MS caps any single vendor call so one hung endpoint (FIMER,
// Sungrow, Growatt) can't stall the whole sequential batch. POLL_BUDGET_MS caps
// the cumulative wall-clock: once exceeded we stop starting new inverters and
// defer them to the next cycle (they keep their old last_poll_at and sort first
// next time). Worst case ≈ POLL_BUDGET_MS + one inverter's fetches, comfortably
// under the n8n node timeout.
const FETCH_TIMEOUT_MS = 10_000;
const POLL_BUDGET_MS = 30_000;

// fetch() with an AbortController-based timeout. Deno's fetch never times out on
// its own, so a vendor endpoint that accepts the connection but never responds
// would otherwise block until the platform wall-clock limit.
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  // @ts-expect-error — AbortSignal.timeout is available in the Deno runtime
  return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

// ─── Reading-timestamp guard ────────────────────────────────────────────────
// SYNC WITH packages/inverter-adapters/src/base.ts :: clampRecordedAt
//
// A vendor datalogger with a misconfigured clock can report a recorded_at
// outside the live partition range of inverter_readings (RANGE-partitioned by
// month, NO default partition). The out-of-range row has nowhere to go, so the
// upsert hard-errors ("no partition of relation ... found for row") on every
// poll and the reading is lost (plant 10467798, 2026-06-09). The poll is
// real-time, so clamp implausible stamps to poll time; the kept range
// [now-36h, now+1h] always maps to the current or previous month. The original
// vendor value survives in raw_payload for diagnosis.
function clampRecordedAt(recordedAt: string, now: Date): string {
  const FUTURE_GRACE_MS = 60 * 60 * 1000; // 1 hour
  const PAST_GRACE_MS = 36 * 60 * 60 * 1000; // 36 hours
  const t = new Date(recordedAt).getTime();
  if (!Number.isFinite(t)) return now.toISOString();
  if (t > now.getTime() + FUTURE_GRACE_MS) return now.toISOString();
  if (t < now.getTime() - PAST_GRACE_MS) return now.toISOString();
  return new Date(t).toISOString();
}

// ─── Growatt adapter (inlined from packages/inverter-adapters/src/growatt.ts) ─
// SYNC WITH packages/inverter-adapters/src/growatt.ts

// 2026-06-05: switched from server-api.growatt.com (now 405) to
// openapi.growatt.com (same legacy endpoints, still working).
// See packages/inverter-adapters/src/growatt.ts for the full regression note.
const GROWATT_BASE_URL = 'https://openapi.growatt.com/';

// Growatt deviceStatus integer → NormalizedStatus.
// 1=active, 3=fault, 5=offline (confirmed against real API 2026-05-23)
// 2 also observed on TLX-family inverters; current data point shows producing
// (power>0, lost=false) so treating as 'active'. Refine if we see contrary cases.
const GROWATT_STATUS_MAP: Record<number, NormalizedStatus> = {
  1: 'active',
  2: 'active',
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

  const response = await fetchWithTimeout(`${GROWATT_BASE_URL}newTwoLoginAPI.do`, {
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
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Cookie: cookieHeader },
  });

  const json = await response.json() as { deviceList?: GrowattDevice[] };
  if (!json.deviceList) {
    console.warn(`${op} deviceList missing from response for plantId=${plantId}`);
  }
  return json.deviceList ?? [];
}

/**
 * Installer-token polling via Growatt V1 OpenAPI.
 *
 * 2026-06-05: Shiroi received a working installer token tied to EEVUWE. The
 * token sees every plant under the installer (23 plants confirmed end-to-end).
 *
 * The polling call is /v1/plant/data?plant_id=X — one call returns aggregate
 * plant readings (current_power, today_energy, total_energy). Most of our
 * plants have a single inverter, so the plant-level reading IS the inverter
 * reading. Multi-inverter plants will require a follow-up to split.
 *
 * Rate limit: Growatt returns error_code=10012 (error_frequently_access) when
 * called too quickly. We sleep 600ms between calls when this branch is hit.
 *
 * SYNC WITH packages/inverter-adapters/src/growatt.ts
 */
async function fetchGrowattReadingViaInstallerToken(
  token: string,
  apiBase: string,
  inv: InverterDue,
): Promise<NormalizedReading> {
  const op = '[fetchGrowattReadingViaInstallerToken]';
  if (!inv.monitoring_site_id) {
    throw new Error('Growatt installer-token: monitoring_site_id (plantId) is required');
  }

  const base = (apiBase || 'https://openapi.growatt.com').replace(/\/$/, '');
  const url = `${base}/v1/plant/data?plant_id=${encodeURIComponent(inv.monitoring_site_id)}`;
  const res = await fetchWithTimeout(url, { headers: { token } });
  if (!res.ok) {
    throw new Error(`Growatt installer-token HTTP ${res.status} for plant ${inv.monitoring_site_id}`);
  }
  const body = (await res.json()) as {
    error_code?: number;
    error_msg?: string;
    data?: {
      current_power?: number | string;
      today_energy?: string;
      total_energy?: string;
      monthly_energy?: string;
      yearly_energy?: string;
      last_update_time?: string;
      peak_power_actual?: number;
      carbon_offset?: string;
    };
  };
  if (body.error_code && body.error_code !== 0) {
    throw new Error(`Growatt installer-token error_code=${body.error_code} msg=${body.error_msg ?? '?'} plant=${inv.monitoring_site_id}`);
  }
  const d = body.data ?? {};

  // current_power is returned in kW (numeric or string)
  const acPowerKw = d.current_power != null ? Number(d.current_power) : NaN;
  // today_energy and total_energy in kWh as strings
  const todayKwh = d.today_energy != null ? parseFloat(d.today_energy) : NaN;
  const totalKwh = d.total_energy != null ? parseFloat(d.total_energy) : NaN;

  // last_update_time is "YYYY-MM-DD HH:MM:SS" in plant's local timezone (IST for us)
  // — append +05:30 so toISOString yields correct UTC. If absent, use now().
  let recordedAt = new Date().toISOString();
  if (typeof d.last_update_time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.last_update_time)) {
    recordedAt = new Date(d.last_update_time.replace(' ', 'T') + '+05:30').toISOString();
  }

  // Status: derive from current_power. Real fault/derated detection requires
  // per-device endpoint; plant-level only distinguishes producing from not.
  const status: NormalizedStatus | null = isNaN(acPowerKw)
    ? null
    : acPowerKw > 0
      ? 'active'
      : 'offline';

  console.log(`${op} plant=${inv.monitoring_site_id} ac=${acPowerKw}kW today=${todayKwh}kWh total=${totalKwh}kWh updated=${d.last_update_time ?? '?'}`);

  return {
    recorded_at: recordedAt,
    ac_power_kw: isNaN(acPowerKw) ? null : acPowerKw,
    dc_power_kw: null,
    ac_voltage_v: null,
    ac_current_a: null,
    ac_frequency_hz: null,
    temperature_c: null,
    energy_today_kwh: isNaN(todayKwh) ? null : todayKwh,
    energy_total_kwh: isNaN(totalKwh) ? null : totalKwh,
    status,
    error_code: null,
    raw_payload: d as Record<string, unknown>,
  };
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
//
// Auth model: direct login via /openapi/login (Shiroi-owned plants under
// Manivel's iSolarCloud account). Login once per poll cycle and reuse the
// token for every Sungrow inverter.
//
// Header `x-access-key` takes the SecretKey, NOT the AppKey. Using the
// AppKey here yields E912 "Illegal x-access-key". The AppKey goes in the
// request BODY as `appkey`.

const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',
  '2': 'fault',
  '3': 'offline',
  '4': 'derated',
  '5': 'derated',
};

function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (raw == null || raw === '') return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

// Point IDs (verified against live SG3.3RS-L 2026-06-05).
const SUNGROW_POINTS = ['p83022', 'p83025', 'p83033', 'p83020', 'p83036', 'p83097'];

// RSA-OAEP encryption of plaintext using SPKI base64 public key.
// Same impl as packages/inverter-adapters/src/sungrow-rsa.ts.
async function sungrowRsaEncrypt(plaintext: string, publicKeyBase64: string): Promise<string> {
  const standard = publicKeyBase64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(standard);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const publicKey = await crypto.subtle.importKey(
    'spki', bytes.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, publicKey, new TextEncoder().encode(plaintext),
  );
  const cipherBytes = new Uint8Array(cipher);
  let s = '';
  for (let i = 0; i < cipherBytes.length; i++) {
    const b = cipherBytes[i];
    if (b !== undefined) s += String.fromCharCode(b);
  }
  return btoa(s);
}

interface SungrowEnvelope<T> {
  result_code: string | number;
  result_msg?: string;
  result_data?: T;
}

async function sungrowPost<T>(
  base: string,
  path: string,
  accessKey: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<SungrowEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'x-access-key': accessKey,
    sys_code: '901',
  };
  if (token) headers.token = token;
  const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sungrow HTTP ${res.status} from ${path}`);
  return await res.json() as SungrowEnvelope<T>;
}

interface SungrowEnv {
  appkey: string;
  secret: string;       // SecretKey — x-access-key value
  username: string;
  password: string;
  rsaPublicKey: string;
  apiBase: string;
}

async function sungrowLogin(env: SungrowEnv): Promise<string> {
  const op = '[sungrowLogin]';
  const encryptedPassword = await sungrowRsaEncrypt(env.password, env.rsaPublicKey);
  const body = await sungrowPost<{ token?: string; user_id?: string | number }>(
    env.apiBase, '/openapi/login', env.secret,
    {
      appkey: env.appkey,
      user_account: env.username,
      user_password: encryptedPassword,
      login_type: '1',
      sys_code: '901',
    },
  );
  if (String(body.result_code) !== '1') {
    throw new Error(`${op} ${body.result_msg ?? `result_code=${body.result_code}`}`);
  }
  const token = body.result_data?.token;
  if (!token) throw new Error(`${op} no token in response`);
  return token;
}

function parseSungrowDeviceTime(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length !== 14) return new Date().toISOString();
  const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8);
  const h = raw.slice(8, 10), mi = raw.slice(10, 12), s = raw.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`).toISOString();
}

function sungrowToNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchSungrowReading(
  env: SungrowEnv,
  token: string,
  inv: InverterDue,
): Promise<NormalizedReading> {
  const op = '[fetchSungrowReading]';
  if (!inv.monitoring_site_id) throw new Error('Sungrow: monitoring_site_id required');
  if (!inv.monitoring_device_id) throw new Error('Sungrow: monitoring_device_id required');

  // monitoring_device_id stores the ps_key (`{ps_id}_{type}_{code}_{chnnl}`).
  // Fall back to sn_list for bare serials.
  const looksLikePsKey = inv.monitoring_device_id.includes('_');
  const body = await sungrowPost<{
    device_point_list?: Array<{ device_point?: Record<string, unknown> }>;
    fail_ps_key_list?: string[];
  }>(
    env.apiBase, '/openapi/getDeviceRealTimeData', env.secret,
    {
      appkey: env.appkey,
      token,
      ps_key_list: looksLikePsKey ? [inv.monitoring_device_id] : undefined,
      sn_list: looksLikePsKey ? undefined : [inv.monitoring_device_id],
      device_type: 1,
      point_id_list: SUNGROW_POINTS,
    },
    token,
  );

  if (String(body.result_code) !== '1') {
    throw new Error(`Sungrow API error: ${body.result_msg ?? `result_code=${body.result_code}`}`);
  }
  const list = body.result_data?.device_point_list ?? [];
  const fail = body.result_data?.fail_ps_key_list ?? [];
  if (list.length === 0 || fail.length > 0) {
    console.warn(`${op} no data for ${inv.monitoring_device_id}; fail=${JSON.stringify(fail)}`);
    return syntheticReading(inv.rated_capacity_kw);
  }

  const point = list[0]?.device_point ?? {};
  return {
    recorded_at: parseSungrowDeviceTime(point['device_time']),
    ac_power_kw: sungrowToNum(point['p83022']),
    dc_power_kw: sungrowToNum(point['p83020']),
    ac_voltage_v: null,
    ac_current_a: null,
    ac_frequency_hz: sungrowToNum(point['p83036']),
    temperature_c: sungrowToNum(point['p83097']),
    energy_today_kwh: sungrowToNum(point['p83025']),
    energy_total_kwh: sungrowToNum(point['p83033']),
    status: mapSungrowStatus(point['dev_status'] != null ? String(point['dev_status']) : undefined),
    error_code: point['dev_fault_status'] != null ? String(point['dev_fault_status']) : null,
    raw_payload: point,
  };
}

// ─── FIMER (Aurora Vision) adapter (inlined from packages/inverter-adapters/src/fimer.ts) ─
// SYNC WITH packages/inverter-adapters/src/fimer.ts
//
// Auth model: per-account API key + portal username/password → /authenticate
// returns a 60-min session token. The Edge Function caches tokens per
// credentials_id for the poll cycle (same lifetime pattern as Sungrow).
//
// Telemetry shape (plant-level, not per-device):
//   GET /v1/stats/power/aggregated/{eid}/GenerationPower/average?startDate=&endDate=&timeZone=
//     → { result: { units: "watts", value: 7164.9 } }
//   GET /v1/plant/{eid}/dailyProduction?startDate=&endDate=
//     → { result: { dailyValues: [{ date: "YYYYMMDD", value: "95.952" }, ...] } }
//
// monitoring_site_id holds the plant entityID; monitoring_device_id is unused.

const FIMER_API_BASE = 'https://api.auroravision.net/api/rest';
const FIMER_TIMEZONE = 'Asia/Kolkata';

interface FimerCreds {
  api_key: string;
  username: string;
  password: string;
}

async function fimerAuthenticate(creds: FimerCreds): Promise<string> {
  const basic = 'Basic ' + btoa(`${creds.username}:${creds.password}`);
  const res = await fetchWithTimeout(`${FIMER_API_BASE}/authenticate`, {
    method: 'GET',
    headers: {
      Authorization: basic,
      'X-AuroraVision-ApiKey': creds.api_key,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`FIMER authenticate failed: HTTP ${res.status}`);
  const body = await res.json() as { result?: string };
  if (typeof body.result !== 'string' || body.result.length < 10) {
    throw new Error('FIMER authenticate: no token in response');
  }
  return body.result;
}

function fimerYyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fimerGet<T>(path: string, apiKey: string, token: string): Promise<{ result?: T }> {
  const res = await fetchWithTimeout(`${FIMER_API_BASE}${path}`, {
    headers: {
      'X-AuroraVision-ApiKey': apiKey,
      'X-AuroraVision-Token': token,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`FIMER HTTP ${res.status} on ${path}: ${text.slice(0, 120)}`);
  if (!text) return {};
  return JSON.parse(text);
}

async function fetchFimerReading(
  creds: FimerCreds,
  token: string,
  inv: InverterDue,
): Promise<NormalizedReading> {
  const op = '[fetchFimerReading]';
  if (!inv.monitoring_site_id) throw new Error('FIMER: monitoring_site_id (entity_id) required');
  const eid = inv.monitoring_site_id;

  // Use a 3-day window for both endpoints: a 1-day window returns no value
  // for today (aggregate not yet finalized). The energy endpoint picks the
  // most recent day with a numeric value, since today's row is usually empty.
  const now = new Date();
  const today = fimerYyyymmdd(now);
  const start = fimerYyyymmdd(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));

  const [pwrResult, energyResult] = await Promise.allSettled([
    fimerGet<{ units?: string; value?: number }>(
      `/v1/stats/power/aggregated/${encodeURIComponent(eid)}/GenerationPower/average?startDate=${start}&endDate=${today}&timeZone=${encodeURIComponent(FIMER_TIMEZONE)}`,
      creds.api_key, token,
    ),
    fimerGet<{ dailyValues?: Array<{ date: string; value?: string }> }>(
      `/v1/plant/${encodeURIComponent(eid)}/dailyProduction?startDate=${start}&endDate=${today}`,
      creds.api_key, token,
    ),
  ]);

  let pwrW: number | null = null;
  if (pwrResult.status === 'fulfilled') {
    const v = pwrResult.value.result?.value;
    if (typeof v === 'number' && Number.isFinite(v)) pwrW = v;
  } else {
    console.warn(`${op} power fetch failed for eid=${eid}:`, pwrResult.reason instanceof Error ? pwrResult.reason.message : pwrResult.reason);
  }

  let energyKwh: number | null = null;
  if (energyResult.status === 'fulfilled') {
    const rows = (energyResult.value.result?.dailyValues ?? [])
      .filter((r) => typeof r.value === 'string' && r.value !== '')
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    for (const row of rows) {
      const n = Number(row.value);
      if (Number.isFinite(n)) { energyKwh = n; break; }
    }
  } else {
    console.warn(`${op} energy fetch failed for eid=${eid}:`, energyResult.reason instanceof Error ? energyResult.reason.message : energyResult.reason);
  }

  const powerKw = pwrW != null ? Number((pwrW / 1000).toFixed(3)) : null;
  let status: NormalizedStatus | null = null;
  if (powerKw != null) status = powerKw > 0.05 ? 'active' : 'offline';

  return {
    recorded_at: now.toISOString(),
    ac_power_kw: powerKw,
    dc_power_kw: null,
    ac_voltage_v: null,
    ac_current_a: null,
    ac_frequency_hz: null,
    temperature_c: null,
    energy_today_kwh: energyKwh,
    energy_total_kwh: null,
    status,
    error_code: null,
    raw_payload: {
      source: 'fimer.auroravision.v1',
      entity_id: eid,
      power_watts_avg: pwrW,
      energy_today_kwh: energyKwh,
    },
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

// ─── Error message normalizer ───────────────────────────────────────────────
// Supabase/PostgREST throws plain objects ({ message, details, code }); String()
// on those yields a useless "[object Object]" in inverter_poll_failures. Prefer
// .message, fall back to JSON so failures are legible.
function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === 'string' && m.length > 0) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

// ─── Main handler ──────────────────────────────────────────────────────────

// @ts-expect-error — Deno global
Deno.serve(async (req: Request) => {
  const op = '[inverter-poll]';
  const startedAt = Date.now();

  // @ts-expect-error — Deno.env
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  // @ts-expect-error — Deno.env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Internal auth: this function is deployed with verify_jwt=false because the
  // sb_secret_* keys (new Supabase auth) aren't valid JWTs. Instead, require
  // the caller's Authorization header to match the service role key directly.
  // Same pattern as process-document Edge Function (CHANGELOG 2026-05-31).
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${serviceKey}`) {
    console.warn(`${op} unauthorized call — Authorization header missing or mismatched`);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // @ts-expect-error — Deno.env
  const syntheticMode = Deno.env.get('SYNTHETIC_INVERTER_READINGS') === '1';
  const sungrowEnv: SungrowEnv = {
    // @ts-expect-error — Deno.env
    appkey: Deno.env.get('SUNGROW_APPKEY') ?? '',
    // @ts-expect-error — Deno.env
    secret: Deno.env.get('SUNGROW_SECRET') ?? '',
    // @ts-expect-error — Deno.env
    username: Deno.env.get('SUNGROW_USERNAME') ?? '',
    // @ts-expect-error — Deno.env
    password: Deno.env.get('SUNGROW_PASSWORD') ?? '',
    // @ts-expect-error — Deno.env
    rsaPublicKey: Deno.env.get('SUNGROW_RSA_PUBLIC_KEY') ?? '',
    // @ts-expect-error — Deno.env
    apiBase: Deno.env.get('SUNGROW_BASE_URL') ?? 'https://gateway.isolarcloud.com.hk',
  };
  // Lazy-fetched Sungrow session token — populated on first Sungrow inverter
  // in this poll cycle, reused for all subsequent Sungrow inverters.
  let sungrowToken: string | null = null;
  // FIMER tokens are per-credentials-row (one per Aurora Vision account).
  // Same lifetime model as Sungrow (60-min idle) — cache for the poll cycle.
  const fimerTokenCache = new Map<string, string>();

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
  let processed = 0;

  // Session cache for Growatt: shared across all inverters in this poll cycle.
  // Reduces logins from N-inverters-per-customer to 1-per-customer-per-cycle.
  const growattSessions = newGrowattSessionCache();

  for (const inv of inverters) {
    // Stop starting new inverters once the wall-clock budget is spent so the
    // function always returns before the n8n HTTP node times out. Deferred
    // inverters keep their old last_poll_at and sort first next cycle, so the
    // fleet is still covered — just spread across cycles instead of overrunning
    // the node timeout in one shot.
    if (Date.now() - startedAt > POLL_BUDGET_MS) {
      console.warn(`${op} time budget ${POLL_BUDGET_MS}ms reached after ${processed} inverter(s); deferring ${inverters.length - processed} to next cycle`);
      break;
    }
    processed++;
    try {
      let reading: NormalizedReading;

      if (syntheticMode) {
        // Force synthetic regardless of brand (for testing the pipeline)
        reading = syntheticReading(inv.rated_capacity_kw ?? 5);
      } else if (inv.brand === 'growatt') {
        // 2026-06-05: Growatt has two parallel modes. We prefer the V1 OpenAPI
        // installer-token mode when monitoring_credentials_id points at a master
        // row carrying an installer_token; that covers 16 of 19 current rows
        // (all EEVUWE-tagged plants). The remaining 3 outliers (Cee bros + AL
        // Sekhar) fall back to per-customer login against the legacy endpoints.
        let usedInstallerToken = false;
        if (inv.monitoring_credentials_id) {
          const { data: imc, error: imcErr } = await supabase
            .from('inverter_monitoring_credentials')
            .select('config')
            .eq('id', inv.monitoring_credentials_id)
            .maybeSingle();
          if (imcErr) {
            throw new Error(`inverter_monitoring_credentials query failed: ${imcErr.message}`);
          }
          const config = (imc?.config ?? {}) as Record<string, string | null>;
          if (config['auth_mode'] === 'installer_token' && config['installer_token']) {
            reading = await fetchGrowattReadingViaInstallerToken(
              config['installer_token'],
              config['api_base'] ?? 'https://openapi.growatt.com',
              inv,
            );
            usedInstallerToken = true;
            // Polite gap between installer-token calls to stay below the
            // V1 OpenAPI rate cap (error_code 10012 — error_frequently_access).
            await new Promise((r) => setTimeout(r, 600));
          }
        }

        if (!usedInstallerToken) {
          // Per-customer credentials from plant_monitoring_credentials.
          // Migration 158 encrypted the password column; we go through
          // the SECURITY DEFINER RPC get_growatt_creds_for_project which
          // returns the decrypted (username, password) pair. service_role
          // is the only caller authorized via GRANT.
          const { data: pcRows, error: pcErr } = await supabase
            .rpc('get_growatt_creds_for_project', { p_project_id: inv.project_id });
          if (pcErr) {
            throw new Error(`get_growatt_creds_for_project failed: ${pcErr.message}`);
          }
          const pc = Array.isArray(pcRows) ? pcRows[0] : pcRows;
          if (!pc || !pc.username || !pc.password) {
            console.warn(`${op} inverter ${inv.id} (growatt): no installer-token cred AND no plant_monitoring_credentials row; skipping`);
            continue;
          }
          reading = await fetchGrowattReading(pc.username, pc.password, inv, growattSessions);
        }
      } else if (inv.brand === 'sungrow') {
        // Direct-login: all 14 Shiroi-owned Sungrow plants live under
        // Manivel's iSolarCloud account. One /openapi/login per poll cycle
        // gives us a session token good for hours; cache it in-process and
        // reuse for every Sungrow inverter in the batch.
        if (!sungrowEnv.appkey || !sungrowEnv.secret || !sungrowEnv.username) {
          console.warn(`${op} inverter ${inv.id} (sungrow): SUNGROW_* env vars not configured; skipping`);
          continue;
        }
        if (!sungrowToken) {
          sungrowToken = await sungrowLogin(sungrowEnv);
          console.log(`${op} sungrow logged in: token=${sungrowToken.slice(0, 12)}…`);
        }
        reading = await fetchSungrowReading(sungrowEnv, sungrowToken, inv);
      } else if (inv.brand === 'fimer') {
        // Per-account credentials: each FIMER inverter row carries a
        // monitoring_credentials_id pointing at one of 7 Aurora Vision accounts
        // (Shiroienergy master + 6 sub-accounts as of 2026-06-05). The credential
        // row's vault_secret_ref names a Deno env var holding the JSON blob
        // {api_key, username, password}. Tokens (60-min idle) cached per
        // credentials_id for the poll cycle.
        if (!inv.monitoring_credentials_id) {
          console.warn(`${op} inverter ${inv.id} (fimer): no monitoring_credentials_id; skipping`);
          continue;
        }
        const { data: cred, error: credErr } = await supabase
          .from('inverter_monitoring_credentials')
          .select('vault_secret_ref')
          .eq('id', inv.monitoring_credentials_id)
          .maybeSingle();
        if (credErr) throw new Error(`fimer creds query failed: ${credErr.message}`);
        if (!cred?.vault_secret_ref) {
          console.warn(`${op} inverter ${inv.id} (fimer): credentials row ${inv.monitoring_credentials_id} has no vault_secret_ref; skipping`);
          continue;
        }
        // @ts-expect-error — Deno.env
        const rawSecret = Deno.env.get(cred.vault_secret_ref) ?? '';
        if (!rawSecret) {
          console.warn(`${op} inverter ${inv.id} (fimer): env var ${cred.vault_secret_ref} not set; skipping`);
          continue;
        }
        let fimerCreds: FimerCreds;
        try {
          fimerCreds = JSON.parse(rawSecret) as FimerCreds;
        } catch {
          console.error(`${op} inverter ${inv.id} (fimer): env var ${cred.vault_secret_ref} is not valid JSON`);
          continue;
        }
        if (!fimerCreds.api_key || !fimerCreds.username || !fimerCreds.password) {
          console.error(`${op} inverter ${inv.id} (fimer): env var ${cred.vault_secret_ref} missing required fields`);
          continue;
        }
        let token = fimerTokenCache.get(inv.monitoring_credentials_id);
        if (!token) {
          token = await fimerAuthenticate(fimerCreds);
          fimerTokenCache.set(inv.monitoring_credentials_id, token);
          console.log(`${op} fimer authenticated for cred ${inv.monitoring_credentials_id}: token=${token.slice(0, 8)}…`);
        }
        reading = await fetchFimerReading(fimerCreds, token, inv);
      } else if (inv.brand === 'solarman') {
        reading = await fetchSolarmanReading(inv);
      } else if (inv.brand === 'goodwe') {
        reading = await fetchGoodweReading(inv);
      } else {
        console.warn(`${op} unsupported brand="${inv.brand}" for inverter ${inv.id}; skipping`);
        continue;
      }

      // Guard against datalogger clock errors: a future/garbage recorded_at has
      // no partition and would hard-error the upsert every cycle (2026-06-09).
      const polledAt = new Date();
      const safeRecordedAt = clampRecordedAt(reading.recorded_at, polledAt);
      if (safeRecordedAt !== reading.recorded_at) {
        console.warn(
          `${op} inverter ${inv.id} (${inv.brand}): implausible recorded_at=${reading.recorded_at} → clamped to ${safeRecordedAt}`,
        );
      }
      reading.recorded_at = safeRecordedAt;

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
      const message = toErrorMessage(e);
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
    due: inverters.length,
    processed,
    succeeded,
    failed,
    deferred: inverters.length - processed,
    duration_ms: Date.now() - startedAt,
  };
  console.log(`${op} done`, summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
