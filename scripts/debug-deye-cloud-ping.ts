/**
 * Throwaway READ-ONLY smoke for the Deye Cloud OpenAPI, exercising the REAL
 * adapter helpers (packages/inverter-adapters/src/deye) against the live API.
 * Confirms auth → business context → station/device discovery → /device/latest.
 * Writes NOTHING to Deye and NOTHING to the DB.
 *
 *   pnpm tsx scripts/debug-deye-cloud-ping.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import {
  deyeAuthenticate,
  deyeFetchCompanyId,
  deyeListStationsWithDevices,
  deyeFetchDeviceLatest,
  deyeReadingFromDeviceData,
} from '../packages/inverter-adapters/src/deye';

const BASE = process.env.DEYE_CLOUD_API_BASE ?? 'https://india-developer.deyecloud.com/v1.0';
const APP_ID = process.env.DEYE_CLOUD_APP_ID ?? '';
const APP_SECRET = process.env.DEYE_CLOUD_APP_SECRET ?? '';
const EMAIL = process.env.DEYE_CLOUD_EMAIL ?? '';
const PASSWORD = process.env.DEYE_CLOUD_PASSWORD ?? '';

async function enumerate(label: string, token: string): Promise<number> {
  console.log(`\n══════ ${label} ══════`);
  const { stations, total } = await deyeListStationsWithDevices(BASE, token, 1, 50);
  console.log(`  stations: ${total}`);
  const serials: string[] = [];
  for (const st of stations) {
    const devs = st.deviceListItems ?? [];
    console.log(
      `   • ${st.name} (${st.installedCapacity ?? '?'}kW) — ${devs.map((d) => `${d.deviceType}:${d.deviceSn}`).join(', ')}`,
    );
    serials.push(...devs.filter((d) => d.deviceType === 'INVERTER').map((d) => d.deviceSn));
  }
  if (serials.length) {
    const data = await deyeFetchDeviceLatest(BASE, token, serials.slice(0, 10));
    for (const dev of data) {
      const { reading, strings } = deyeReadingFromDeviceData(dev, new Date().toISOString());
      console.log(
        `     ↳ ${dev.deviceSn}: ${reading.ac_power_kw ?? '–'}kW · today ${reading.energy_today_kwh ?? '–'}kWh · ` +
          `total ${reading.energy_total_kwh ?? '–'}kWh · ${reading.status} · ${strings.length} string(s)`,
      );
    }
  }
  return serials.length;
}

async function main(): Promise<void> {
  if (!APP_ID || !APP_SECRET || !EMAIL || !PASSWORD) {
    throw new Error('Missing DEYE_CLOUD_APP_ID / _APP_SECRET / _EMAIL / _PASSWORD in .env.local');
  }
  console.log(`Deye Cloud smoke (READ-ONLY) — base ${BASE}, appId ${APP_ID}`);

  const personalToken = await deyeAuthenticate({
    appId: APP_ID,
    appSecret: APP_SECRET,
    email: EMAIL,
    password: PASSWORD,
    companyId: '0',
    apiBase: BASE,
  });
  console.log('[auth] personal token ✓');

  const companyId = await deyeFetchCompanyId(BASE, personalToken);
  console.log(`[account/info] companyId = ${companyId ?? 'none'}`);

  await enumerate('PERSONAL (companyId=0)', personalToken);

  if (companyId != null) {
    const bizToken = await deyeAuthenticate({
      appId: APP_ID,
      appSecret: APP_SECRET,
      email: EMAIL,
      password: PASSWORD,
      companyId: String(companyId),
      apiBase: BASE,
    });
    console.log(`\n[auth] business token ✓ (companyId ${companyId})`);
    await enumerate(`BUSINESS (companyId=${companyId})`, bizToken);
  }

  console.log('\nDONE (read-only).');
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
