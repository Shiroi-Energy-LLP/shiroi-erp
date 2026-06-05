/**
 * Sungrow adapter tests — OpenAPI v2 direct-login + read flow.
 *
 * Auth model:
 *   - appkey      → body field `appkey` on every call
 *   - access_key  → header `x-access-key` (this is Sungrow's "SecretKey")
 *   - oauth_token → header `token` (session token from /openapi/login)
 *
 * Real-time endpoint shape:
 *   POST /openapi/getDeviceRealTimeData
 *     body: { appkey, token, ps_key_list | sn_list, device_type, point_id_list }
 *     resp: { result_code: '1',
 *             result_data: { device_point_list: [{ device_point: { p83022: '4.8', ... } }],
 *                            fail_ps_key_list: [] } }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sungrowAdapter, mapSungrowStatus } from './sungrow';
import { InvalidCredentialsError, AdapterError } from './base';

const VALID_CREDENTIALS = {
  appkey: 'E6C9E7CEB87580DDDBABD49F9C76EAF7',
  access_key: 'dritme6qenu9up9rentz7vzcsr8ee1yk', // Sungrow SecretKey
  oauth_token: 'test-session-token-abc123',
  api_base: 'https://gateway.isolarcloud.com.hk',
  rated_capacity_kw: '5',
  device_type: '1',
};

const VALID_INPUT = {
  credentials: VALID_CREDENTIALS,
  monitoring_site_id: '1818786',
  monitoring_device_id: '1818786_1_2_1', // ps_key form
  since: null,
};

const REALTIME_SUCCESS_BODY = {
  result_code: '1',
  result_msg: 'success',
  result_data: {
    fail_ps_key_list: [],
    device_point_list: [
      {
        device_point: {
          ps_key: '1818786_1_2_1',
          device_sn: 'I2540300247',
          device_time: '20260605173500',
          dev_status: '1',
          dev_fault_status: 0,
          p83022: '4.8',
          p83025: '22.4',
          p83033: '15230.5',
          p83020: '4.9',
          p83036: '50.01',
          p83097: '42.3',
        },
      },
    ],
  },
};

function realtimeSuccessResponse(): Response {
  return new Response(JSON.stringify(REALTIME_SUCCESS_BODY), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorEnvelopeResponse(result_code: string, result_msg: string): Response {
  return new Response(JSON.stringify({ result_code, result_msg, result_data: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mapSungrowStatus', () => {
  it('maps the four documented codes', () => {
    expect(mapSungrowStatus('1')).toBe('active');
    expect(mapSungrowStatus('2')).toBe('fault');
    expect(mapSungrowStatus('3')).toBe('offline');
    expect(mapSungrowStatus('4')).toBe('derated');
  });
  it('returns null on missing / unknown', () => {
    expect(mapSungrowStatus(null)).toBeNull();
    expect(mapSungrowStatus('')).toBeNull();
    expect(mapSungrowStatus('99')).toBeNull();
  });
});

describe('sungrowAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  describe('fetchReadings — credential validation', () => {
    it('throws InvalidCredentialsError if appkey is missing', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, appkey: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if access_key is missing', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, access_key: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if oauth_token is missing', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, oauth_token: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_site_id is null', async () => {
      await expect(
        sungrowAdapter.fetchReadings({ ...VALID_INPUT, monitoring_site_id: null }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_device_id is null', async () => {
      await expect(
        sungrowAdapter.fetchReadings({ ...VALID_INPUT, monitoring_device_id: null }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('fetchReadings — synthetic mode', () => {
    it('returns 1 reading with raw_payload.source === "synthetic" when SYNTHETIC_INVERTER_READINGS=1', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      expect(result.readings).toHaveLength(1);
      expect(result.readings[0]!.raw_payload['source']).toBe('synthetic');
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchReadings — real API flow', () => {
    it('sends x-access-key=access_key (Secretkey), not appkey', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      const headers = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers['x-access-key']).toBe(VALID_CREDENTIALS.access_key);
      expect(headers['x-access-key']).not.toBe(VALID_CREDENTIALS.appkey);
      expect(headers['token']).toBe(VALID_CREDENTIALS.oauth_token);
    });

    it('sends appkey and token in the body', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string);
      expect(body.appkey).toBe(VALID_CREDENTIALS.appkey);
      expect(body.token).toBe(VALID_CREDENTIALS.oauth_token);
    });

    it('uses ps_key_list when monitoring_device_id contains underscores', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string);
      expect(body.ps_key_list).toEqual(['1818786_1_2_1']);
      expect(body.sn_list).toBeUndefined();
    });

    it('falls back to sn_list for bare serial numbers', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings({
        ...VALID_INPUT,
        monitoring_device_id: 'I2540300247',
      });

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string);
      expect(body.sn_list).toEqual(['I2540300247']);
      expect(body.ps_key_list).toBeUndefined();
    });

    it('normalizes point values into NormalizedReading fields', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(realtimeSuccessResponse()));

      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);

      expect(result.readings).toHaveLength(1);
      const r = result.readings[0]!;
      expect(r.ac_power_kw).toBe(4.8);
      expect(r.dc_power_kw).toBe(4.9);
      expect(r.energy_today_kwh).toBe(22.4);
      expect(r.energy_total_kwh).toBe(15230.5);
      expect(r.ac_frequency_hz).toBe(50.01);
      expect(r.temperature_c).toBe(42.3);
      expect(r.status).toBe('active');
      expect(new Date(r.recorded_at).getTime()).not.toBeNaN();
    });

    it('parses device_time "20260605173500" as IST and converts to UTC', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(realtimeSuccessResponse()));
      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      // 2026-06-05 17:35:00 IST → 12:05:00 UTC
      expect(result.readings[0]!.recorded_at).toBe('2026-06-05T12:05:00.000Z');
    });

    it('returns empty readings when fail_ps_key_list is non-empty', async () => {
      const failBody = {
        result_code: '1',
        result_data: { fail_ps_key_list: ['1818786_1_2_1'], device_point_list: [] },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(failBody), { status: 200 })),
      );

      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      expect(result.readings).toHaveLength(0);
    });
  });

  describe('fetchReadings — HTTP errors', () => {
    it('throws AdapterError on HTTP 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })),
      );
      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });

    it('throws AdapterError when result_code is not 1', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(errorEnvelopeResponse('E912', 'Illegal x-access-key')),
      );
      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });
  });

  describe('healthCheck', () => {
    it('returns ok=false with message if appkey is missing', async () => {
      const result = await sungrowAdapter.healthCheck({ access_key: 'k', oauth_token: 't' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/appkey/i);
    });

    it('returns ok=false with message if access_key is missing', async () => {
      const result = await sungrowAdapter.healthCheck({ appkey: 'a', oauth_token: 't' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/access_key/i);
    });

    it('returns ok=true in synthetic mode without calling fetch', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/synthetic/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns ok=true when getPowerStationList succeeds', async () => {
      const body = { result_code: '1', result_data: { rowCount: 14, pageList: [] } };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 })),
      );
      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/14/);
    });
  });
});
