// scripts/sungrow-ping.ts
//
// Smoke-test the Sungrow iSolarCloud OpenAPI v2 connection.
//
// Auth: /openapi/login with username + RSA-encrypted password.
// This is the direct path for Shiroi-owned plants under Manivel's account
// (no OAuth redirect needed).
//
// Steps:
//   1. RSA-encrypt password + secret using SUNGROW_RSA_PUBLIC_KEY.
//   2. POST /openapi/login → returns token.
//   3. POST /openapi/getPowerStationList → list of plants.
//   4. POST /openapi/getDeviceList for plant #1 → list of devices.
//   5. POST /openapi/getDeviceRealTimeData for device #1 → live reading.
//
// Usage:
//   pnpm tsx scripts/sungrow-ping.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sungrowRsaEncrypt } from '../apps/erp/src/lib/sungrow-rsa';

// ─── Env loader ──────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), '.env.local');
  const text = readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────

interface SungrowEnvelope<T> {
  result_code: string | number;
  result_msg?: string;
  req_serial_num?: string;
  result_data?: T;
}

async function sungrowPost<T>(
  url: string,
  xAccessKey: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<SungrowEnvelope<T>> {
  // NOTE: Sungrow's developer dashboard labels two values:
  //   "AppKey"    → goes in the request BODY as `appkey`
  //   "SecretKey" → goes in the HEADER as `x-access-key` (NOT a body secret!)
  // Using AppKey in the header yields E912 "Illegal x-access-key".
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'x-access-key': xAccessKey,
    sys_code: '901',
  };
  if (token) headers.token = token;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: SungrowEnvelope<T>;
  try {
    json = JSON.parse(text) as SungrowEnvelope<T>;
  } catch {
    throw new Error(`Non-JSON response (status ${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const env = loadEnv();
  const appkey = env.SUNGROW_APPKEY;
  const secret = env.SUNGROW_SECRET;
  const publicKey = env.SUNGROW_RSA_PUBLIC_KEY;
  const base = (env.SUNGROW_BASE_URL ?? 'https://gateway.isolarcloud.com.hk').replace(/\/$/, '');
  const username = env.SUNGROW_USERNAME;
  const password = env.SUNGROW_PASSWORD;

  console.log('═══ Sungrow iSolarCloud connectivity test ═══');
  console.log(`  Base:       ${base}`);
  console.log(`  Appkey:     ${appkey?.slice(0, 8)}…`);
  console.log(`  Username:   ${username}`);
  console.log(`  RSA key:    ${publicKey?.slice(0, 20)}…`);
  console.log('');

  if (!appkey || !secret || !publicKey || !username || !password) {
    throw new Error('Missing Sungrow env vars — check .env.local');
  }

  // ── Step 1: RSA-encrypt password + secret ──────────────────────────────
  console.log('[1] RSA-encrypting password and secret...');
  const encryptedPassword = await sungrowRsaEncrypt(password, publicKey);
  const encryptedSecret = await sungrowRsaEncrypt(secret, publicKey);
  console.log(`    ✓ Encrypted password length: ${encryptedPassword.length}`);
  console.log(`    ✓ Encrypted secret length:   ${encryptedSecret.length}`);
  console.log('');

  // ── Step 2: POST /openapi/login ────────────────────────────────────────
  console.log('[2] POST /openapi/login...');
  const loginUrl = `${base}/openapi/login`;
  const loginBody = {
    appkey,
    user_account: username,
    user_password: encryptedPassword,
    login_type: '1',
    sys_code: '901',
  };
  const loginRes = await sungrowPost<{
    token?: string;
    user_id?: string | number;
    login_state?: string;
    expires_in?: number;
    [k: string]: unknown;
  }>(loginUrl, secret, loginBody);

  console.log(`    result_code: ${loginRes.result_code}`);
  console.log(`    result_msg:  ${loginRes.result_msg ?? '(none)'}`);
  if (String(loginRes.result_code) !== '1') {
    console.log(`    full body:   ${JSON.stringify(loginRes, null, 2)}`);
    throw new Error(`Login failed: ${loginRes.result_msg ?? `result_code=${loginRes.result_code}`}`);
  }
  const token = loginRes.result_data?.token;
  if (!token) {
    console.log(`    body: ${JSON.stringify(loginRes, null, 2)}`);
    throw new Error('Login succeeded but no token returned');
  }
  console.log(`    ✓ token: ${token.slice(0, 12)}…${token.slice(-4)}`);
  console.log(`    ✓ user_id: ${loginRes.result_data?.user_id}`);
  console.log('');

  // ── Step 3: POST /openapi/getPowerStationList ──────────────────────────
  console.log('[3] POST /openapi/getPowerStationList (page 1, size 100)...');
  const listUrl = `${base}/openapi/getPowerStationList`;
  const listRes = await sungrowPost<{
    pageList?: Array<Record<string, unknown>>;
    rowCount?: number;
    page_count?: number;
    row_count?: number;
    data?: Array<Record<string, unknown>>;
  }>(listUrl, secret, { curPage: 1, size: 100, appkey, token }, token);

  console.log(`    result_code: ${listRes.result_code}`);
  console.log(`    result_msg:  ${listRes.result_msg ?? '(none)'}`);
  if (String(listRes.result_code) !== '1') {
    console.log(`    body: ${JSON.stringify(listRes, null, 2)}`);
    throw new Error('getPowerStationList failed');
  }
  const plants = listRes.result_data?.pageList ?? listRes.result_data?.data ?? [];
  const rowCount = listRes.result_data?.rowCount ?? listRes.result_data?.row_count ?? plants.length;
  console.log(`    ✓ row_count: ${rowCount}`);
  console.log(`    ✓ plants on page: ${plants.length}`);
  console.log('');

  if (plants.length === 0) {
    console.log('No plants returned. Stopping here.');
    return;
  }

  console.log('First 5 plants:');
  for (const p of plants.slice(0, 5)) {
    const psId = p.ps_id ?? p.psId ?? '?';
    const psName = p.ps_name ?? p.psName ?? '?';
    const psCap = p.ps_capacity_kwp ?? p.psCapacity ?? p.installed_power_w ?? '?';
    const psCity = p.ps_location ?? p.psLocation ?? '?';
    console.log(`    • ps_id=${psId}  name=${psName}  cap=${psCap}  loc=${psCity}`);
  }
  console.log('');

  // ── Step 4: POST /openapi/getDeviceList for plant #1 ───────────────────
  const firstPlant = plants[0];
  if (!firstPlant) return;
  const psId = (firstPlant.ps_id ?? firstPlant.psId) as string | number | undefined;
  if (!psId) {
    console.log('First plant has no ps_id, stopping.');
    return;
  }

  console.log(`[4] POST /openapi/getDeviceList (ps_id=${psId})...`);
  const devUrl = `${base}/openapi/getDeviceList`;
  const devRes = await sungrowPost<{
    pageList?: Array<Record<string, unknown>>;
    data?: Array<Record<string, unknown>>;
  }>(devUrl, secret, { ps_id: psId, curPage: 1, size: 50, appkey, token }, token);

  console.log(`    result_code: ${devRes.result_code}`);
  console.log(`    result_msg:  ${devRes.result_msg ?? '(none)'}`);
  if (String(devRes.result_code) !== '1') {
    console.log(`    body: ${JSON.stringify(devRes, null, 2)}`);
    return;
  }
  const devices = devRes.result_data?.pageList ?? devRes.result_data?.data ?? [];
  console.log(`    ✓ devices: ${devices.length}`);
  if (devices[0]) {
    console.log(`    full device[0]: ${JSON.stringify(devices[0], null, 2)}`);
  }
  for (const d of devices.slice(0, 5)) {
    const sn = d.device_sn ?? d.deviceSn ?? '?';
    const type = d.device_type ?? d.deviceType ?? '?';
    const model = d.device_model_code ?? d.deviceModelCode ?? d.device_model_id ?? '?';
    const status = d.device_status ?? d.deviceStatus ?? '?';
    console.log(`    • sn=${sn}  type=${type}  model=${model}  status=${status}`);
  }
  console.log('');

  // ── Step 5: POST /openapi/getDeviceRealTimeData for first inverter ─────
  const firstInverter = devices.find(
    (d) =>
      String(d.device_type ?? d.deviceType ?? '') === '1' ||
      String(d.device_model_type ?? '') === '1',
  ) ?? devices[0];
  if (!firstInverter) {
    console.log('No devices to fetch realtime data for.');
    return;
  }
  const sn = (firstInverter.device_sn ?? firstInverter.deviceSn) as string | undefined;
  if (!sn) {
    console.log('First device has no device_sn.');
    return;
  }

  console.log(`[5] POST /openapi/getDeviceRealTimeData (sn=${sn})...`);
  const rtUrl = `${base}/openapi/getDeviceRealTimeData`;
  // ps_key on a device is the authoritative composite key. Fall back to sn_list if absent.
  const psKey = (firstInverter.ps_key ?? firstInverter.psKey) as string | undefined;
  const rtBody: Record<string, unknown> = {
    point_id_list: ['p83022', 'p83033', 'p83025', 'p83082'], // active_power, total_energy, today_energy, dc_power
    device_type: firstInverter.device_type ?? firstInverter.deviceType ?? 1,
    appkey,
    token,
  };
  if (psKey) rtBody.ps_key_list = [psKey];
  else rtBody.sn_list = [sn];
  const rtRes = await sungrowPost<Record<string, unknown>>(rtUrl, secret, rtBody, token);

  console.log(`    result_code: ${rtRes.result_code}`);
  console.log(`    result_msg:  ${rtRes.result_msg ?? '(none)'}`);
  console.log(`    body: ${JSON.stringify(rtRes.result_data, null, 2).slice(0, 2000)}`);
  console.log('');

  console.log('═══ DONE ═══');
}

main().catch((e) => {
  console.error('\n✗ FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
