/**
 * Deye Cloud OpenAPI (v1.0) adapter tests.
 *
 * Auth model (probed live 2026-06-19, region india-developer.deyecloud.com/v1.0):
 *   POST /account/token?appId=<id>  body {appSecret, email, password: SHA256-hex, companyId}
 *     → { success, accessToken }            (companyId "0" = personal, 2592 = Shiroi business)
 *   POST /device/latest  header Authorization: bearer <jwt>  body {deviceList:[sn,...]}
 *     → { deviceDataList:[{deviceSn, deviceType, deviceState, collectionTime, dataList:[{key,value,unit}]}] }
 *
 * The INVERTER_DEVICE fixture below is the verbatim live shape from device
 * 2406011860 (Muralidharan Chitlapakkam, 3 kW) generating 1.851 kW.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deyeAdapter,
  deyeAuthenticate,
  deyeReadingFromDeviceData,
  _deyeStatus,
  type DeyeDeviceData,
} from './deye';
import { InvalidCredentialsError, AdapterError } from './base';

const INVERTER_DEVICE: DeyeDeviceData = {
  deviceSn: '2406011860',
  deviceType: 'INVERTER',
  deviceState: 1,
  collectionTime: 1781856464,
  dataList: [
    { key: 'RatedPower', value: '3000.00', unit: 'W' },
    { key: 'DCVoltagePV1', value: '201.20', unit: 'V' },
    { key: 'DCCurrentPV1', value: '9.30', unit: 'A' },
    { key: 'DCPowerPV1', value: '1871.16', unit: 'W' },
    { key: 'DCVoltagePV2', value: '0.00', unit: 'V' },
    { key: 'DCCurrentPV2', value: '0.00', unit: 'A' },
    { key: 'DCPowerPV2', value: '0.00', unit: 'W' },
    { key: 'ACVoltageRUA', value: '240.30', unit: 'V' },
    { key: 'ACCurrentRUA', value: '7.50', unit: 'A' },
    { key: 'ACOutputFrequencyR', value: '49.96', unit: 'Hz' },
    { key: 'TotalActiveACOutputPower', value: '1851', unit: 'W' },
    { key: 'TotalActiveProduction', value: '8061.30', unit: 'kWh' },
    { key: 'DailyActiveProduction', value: '5.40', unit: 'kWh' },
  ],
};
const DEVICE_LATEST_RESPONSE = {
  code: '1000000',
  msg: 'success',
  success: true,
  deviceDataList: [INVERTER_DEVICE],
};
const RECORDED = '2026-06-19T12:00:00.000Z';
const BASE = 'https://india-developer.deyecloud.com/v1.0';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('deyeReadingFromDeviceData', () => {
  it('maps the live INVERTER payload to a normalized reading', () => {
    const { reading } = deyeReadingFromDeviceData(INVERTER_DEVICE, RECORDED);
    expect(reading.ac_power_kw).toBe(1.851); // TotalActiveACOutputPower 1851 W → kW
    expect(reading.dc_power_kw).toBe(1.871); // Σ DCPowerPVn = 1871.16 W → kW
    expect(reading.ac_voltage_v).toBe(240.3);
    expect(reading.ac_current_a).toBe(7.5);
    expect(reading.ac_frequency_hz).toBe(49.96);
    expect(reading.energy_today_kwh).toBe(5.4); // DailyActiveProduction
    expect(reading.energy_total_kwh).toBe(8061.3); // TotalActiveProduction
    expect(reading.status).toBe('active'); // deviceState 1
    expect(reading.temperature_c).toBeNull(); // no temp key for this model
    expect(reading.recorded_at).toBe(RECORDED);
    expect(reading.raw_payload['source']).toBe('deye.cloud.v1.0');
    expect(reading.raw_payload['device_sn']).toBe('2406011860');
  });

  it('emits one string reading per connected PV input (skips all-zero strings)', () => {
    const { strings } = deyeReadingFromDeviceData(INVERTER_DEVICE, RECORDED);
    expect(strings).toHaveLength(1);
    expect(strings[0]).toMatchObject({ string_number: 1, voltage_v: 201.2, current_a: 9.3, power_kw: 1.871 });
  });
});

describe('_deyeStatus', () => {
  it('state 1 → active regardless of power', () => expect(_deyeStatus(1, 0)).toBe('active'));
  it('state 0 → offline regardless of power', () => expect(_deyeStatus(0, 5)).toBe('offline'));
  it('unknown state falls back to power', () => {
    expect(_deyeStatus(9, 2)).toBe('active');
    expect(_deyeStatus(9, 0)).toBe('offline');
    expect(_deyeStatus(9, null)).toBeNull();
  });
});

describe('deyeAuthenticate', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('posts appId in query + sha256(password) + companyId, returns accessToken', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, accessToken: 'eyJhbGci.jwt.token' }));
    vi.stubGlobal('fetch', mockFetch);

    const token = await deyeAuthenticate({
      appId: 'APP123',
      appSecret: 'secret',
      email: 'u@x.com',
      password: 'test-pass',
      companyId: '2592',
      apiBase: BASE,
    });

    expect(token).toBe('eyJhbGci.jwt.token');
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/account/token?appId=APP123`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.appSecret).toBe('secret');
    expect(body.email).toBe('u@x.com');
    expect(body.companyId).toBe('2592');
    expect(body.password).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, not plaintext
    expect(body.password).not.toBe('test-pass');
  });

  it('defaults companyId to "0" (personal) when omitted', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, accessToken: 't.t.t' }));
    vi.stubGlobal('fetch', mockFetch);
    await deyeAuthenticate({ appId: 'A', appSecret: 's', email: 'e', password: 'p', apiBase: BASE });
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.companyId).toBe('0');
  });

  it('throws AdapterError when the API returns success:false on a 200 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ success: false, msg: 'auth invalid appId', code: '2101021' })),
    );
    await expect(
      deyeAuthenticate({ appId: 'bad', appSecret: 's', email: 'e', password: 'p', apiBase: BASE }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});

describe('deyeAdapter.fetchReadings — validation + synthetic', () => {
  const VALID = {
    credentials: { oauth_token: 'jwt', api_base: BASE },
    monitoring_site_id: '34832',
    monitoring_device_id: '2406011860',
    since: null,
  };
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('throws InvalidCredentialsError without oauth_token', async () => {
    await expect(deyeAdapter.fetchReadings({ ...VALID, credentials: {} })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
  it('throws InvalidCredentialsError without monitoring_device_id', async () => {
    await expect(deyeAdapter.fetchReadings({ ...VALID, monitoring_device_id: null })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
  it('synthetic mode returns 1 reading without calling fetch', async () => {
    process.env['SYNTHETIC_INVERTER_READINGS'] = '1';
    const r = await deyeAdapter.fetchReadings(VALID);
    expect(r.readings).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('deyeAdapter.fetchReadings — real flow', () => {
  beforeEach(() => {
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs /device/latest with the serial + bearer token and maps the reading', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse(DEVICE_LATEST_RESPONSE));
    vi.stubGlobal('fetch', mockFetch);

    const r = await deyeAdapter.fetchReadings({
      credentials: { oauth_token: 'jwt-abc', api_base: BASE },
      monitoring_site_id: '34832',
      monitoring_device_id: '2406011860',
      since: null,
    });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/device/latest`);
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({ Authorization: 'bearer jwt-abc' });
    expect(JSON.parse((init as RequestInit).body as string).deviceList).toEqual(['2406011860']);
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0]!.ac_power_kw).toBe(1.851);
    expect(r.string_readings).toHaveLength(1);
  });
});

describe('deyeAdapter.healthCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('ok=false when app_id missing', async () => {
    const r = await deyeAdapter.healthCheck({ api_secret: 's', username: 'u', password: 'p' });
    expect(r.ok).toBe(false);
  });
  it('ok=true when auth returns a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, accessToken: 'tok-12345678' })));
    const r = await deyeAdapter.healthCheck({ app_id: 'A', api_secret: 's', username: 'u', password: 'p' });
    expect(r.ok).toBe(true);
  });
});
