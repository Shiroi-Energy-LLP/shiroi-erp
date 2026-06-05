// scripts/fimer-poll-once.ts
//
// Local end-to-end smoke for the FIMER (Aurora Vision) poll path. Pulls
// every fimer-brand inverter row, authenticates per credentials_id, fetches
// power + today's energy, upserts into inverter_readings and updates
// inverters.last_poll_at / current_status — exactly what the Edge Function
// will do, but runnable locally.
//
//   pnpm tsx scripts/fimer-poll-once.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  fimerAuthenticate,
  fimerFetchAveragePowerWatts,
  fimerFetchTodayEnergyKwh,
} from '../packages/inverter-adapters/src/fimer';

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

interface FimerCreds {
  api_key: string;
  username: string;
  password: string;
}

const API_BASE = 'https://api.auroravision.net/api/rest';

async function main() {
  const env = loadEnv();
  const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL']!, env['SUPABASE_SECRET_KEY']!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('[1] Loading FIMER inverters from DB...');
  const { data: inverters, error } = await supabase
    .from('inverters')
    .select('id, serial_number, monitoring_site_id, monitoring_credentials_id, rated_capacity_kw')
    .eq('brand', 'fimer')
    .eq('polling_enabled', true);
  if (error || !inverters) throw new Error(`inverters query: ${error?.message}`);
  console.log(`    ✓ ${inverters.length} inverters`);

  // Unique credentials_ids → look up env vars → authenticate
  console.log('[2] Authenticating per account...');
  const credIds = Array.from(new Set(inverters.map((i) => i.monitoring_credentials_id).filter(Boolean))) as string[];
  const tokenByCredId = new Map<string, string>();
  const credsByCredId = new Map<string, FimerCreds>();
  for (const cid of credIds) {
    const { data: cred, error: credErr } = await supabase
      .from('inverter_monitoring_credentials')
      .select('vault_secret_ref, label')
      .eq('id', cid)
      .maybeSingle();
    if (credErr || !cred?.vault_secret_ref) {
      console.error(`    ✗ ${cid}: ${credErr?.message ?? 'no row'}`);
      continue;
    }
    const raw = env[cred.vault_secret_ref];
    if (!raw) {
      console.error(`    ✗ ${cred.label}: env var ${cred.vault_secret_ref} not set in .env.local`);
      continue;
    }
    let parsed: FimerCreds;
    try {
      parsed = JSON.parse(raw) as FimerCreds;
    } catch {
      console.error(`    ✗ ${cred.label}: env var ${cred.vault_secret_ref} not valid JSON`);
      continue;
    }
    try {
      const token = await fimerAuthenticate({
        apiKey: parsed.api_key,
        username: parsed.username,
        password: parsed.password,
      });
      tokenByCredId.set(cid, token);
      credsByCredId.set(cid, parsed);
      console.log(`    ✓ ${cred.label} → token=${token.slice(0, 8)}…`);
    } catch (e) {
      console.error(`    ✗ ${cred.label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log('[3] Polling...');
  let success = 0, fail = 0, empty = 0;
  for (const inv of inverters) {
    if (!inv.monitoring_credentials_id || !inv.monitoring_site_id) {
      console.log(`    · ${inv.serial_number}: missing credentials_id/entity_id; skipping`);
      empty++;
      continue;
    }
    const token = tokenByCredId.get(inv.monitoring_credentials_id);
    const creds = credsByCredId.get(inv.monitoring_credentials_id);
    if (!token || !creds) {
      fail++;
      continue;
    }
    try {
      const [pwrW, energyKwh] = await Promise.all([
        fimerFetchAveragePowerWatts(API_BASE, creds.api_key, token, inv.monitoring_site_id).catch((e) => {
          console.log(`    ⚠ ${inv.serial_number}: power err ${e instanceof Error ? e.message : e}`);
          return null;
        }),
        fimerFetchTodayEnergyKwh(API_BASE, creds.api_key, token, inv.monitoring_site_id).catch((e) => {
          console.log(`    ⚠ ${inv.serial_number}: energy err ${e instanceof Error ? e.message : e}`);
          return null;
        }),
      ]);
      const powerKw = pwrW != null ? Number((pwrW / 1000).toFixed(3)) : null;
      const status = powerKw == null ? null : (powerKw > 0.05 ? 'active' : 'offline');

      const reading = {
        inverter_id: inv.id,
        recorded_at: new Date().toISOString(),
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
          entity_id: inv.monitoring_site_id,
          power_watts_avg: pwrW,
          energy_today_kwh: energyKwh,
        },
      };

      const { error: upErr } = await supabase
        .from('inverter_readings')
        .upsert(reading, { onConflict: 'inverter_id,recorded_at', ignoreDuplicates: true });
      if (upErr) {
        console.log(`    ✗ ${inv.serial_number}: upsert ${upErr.message}`);
        fail++;
        continue;
      }

      await supabase
        .from('inverters')
        .update({
          last_poll_at: new Date().toISOString(),
          last_reading_at: reading.recorded_at,
          current_status: status ?? 'unknown',
        })
        .eq('id', inv.id);

      console.log(`    ✓ ${inv.serial_number} (eid=${inv.monitoring_site_id}): P=${powerKw}kW E_today=${energyKwh}kWh status=${status}`);
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
